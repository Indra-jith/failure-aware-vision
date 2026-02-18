"""
FastAPI backend — WebSocket-driven trust simulation server.

Serves the frontend statically and provides a WebSocket endpoint
for real-time trust state streaming.
"""

import asyncio
import json
import os
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from trust_engine import TrustEngine
from vision_simulator import VisionSimulator
from anomaly_simulator import AnomalySimulator
from session_logger import SessionLogger

app = FastAPI(title="Vision Trust Platform", version="1.0.0")

# Frontend path: always relative to this script, so it works no matter where the server is started from
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIR = os.path.normpath(os.path.join(_BASE_DIR, "..", "frontend"))

# Serve frontend static files
app.mount("/css", StaticFiles(directory=os.path.join(_FRONTEND_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(_FRONTEND_DIR, "js")), name="js")
app.mount("/assets", StaticFiles(directory=os.path.join(_FRONTEND_DIR, "assets")), name="assets")


# ── Static page routes ──

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    r = FileResponse(os.path.join(_FRONTEND_DIR, "index.html"))
    r.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    r.headers["Pragma"] = "no-cache"
    return r


@app.get("/architecture", response_class=HTMLResponse)
async def serve_architecture():
    return FileResponse(os.path.join(_FRONTEND_DIR, "architecture.html"))


@app.get("/playground", response_class=HTMLResponse)
async def serve_playground():
    return FileResponse(os.path.join(_FRONTEND_DIR, "playground.html"))


# ── Health check ──

@app.get("/health")
async def health():
    return {"status": "ok", "engine": "trust_v1"}


# ── WebSocket endpoint ──

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    # Per-connection instances
    engine = TrustEngine()
    vision = VisionSimulator()
    anomaly = AnomalySimulator(seed=42)
    logger = SessionLogger()

    tick_rate = 30  # Hz
    running = True
    last_time = time.time()

    async def simulation_loop():
        nonlocal last_time, running
        while running:
            now = time.time()
            dt = now - last_time
            last_time = now

            # Get current simulation state
            vision_status = vision.get_vision_status()
            frame_info = vision.get_frame_descriptor()
            anomaly_score = anomaly.compute_anomaly(
                vision.noise_level, vision.brightness, vision_status
            )

            # Update trust engine
            state = engine.update(vision_status, anomaly_score, dt)
            state['anomaly_score'] = round(anomaly_score, 6)
            state['dt'] = round(dt, 6)
            state['frame'] = frame_info

            # Log
            logger.log(state, anomaly_score)

            # Send to client
            try:
                await ws.send_json(state)
            except Exception:
                running = False
                break

            await asyncio.sleep(1.0 / tick_rate)

    # Start simulation loop as background task
    loop_task = asyncio.create_task(simulation_loop())

    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            action = msg.get('action', '')

            if action == 'set_vision':
                mode = msg.get('mode', 'normal')
                vision.set_mode(mode)

            elif action == 'set_noise':
                level = float(msg.get('level', 0))
                vision.set_noise(level)

            elif action == 'set_brightness':
                level = float(msg.get('level', 0.5))
                vision.set_brightness(level)

            elif action == 'reset':
                engine.reset()
                vision.reset()
                anomaly.reset(seed=42)
                logger.reset()
                last_time = time.time()

            elif action == 'set_tick_rate':
                tick_rate = max(1, min(60, int(msg.get('hz', 30))))

            elif action == 'get_log':
                csv_data = logger.get_csv()
                await ws.send_json({
                    'type': 'log_data',
                    'csv': csv_data,
                    'entries': logger.entry_count,
                })

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        running = False
        loop_task.cancel()
        try:
            await loop_task
        except asyncio.CancelledError:
            pass


# ── Playground endpoint (event injection) ──

@app.websocket("/ws/playground")
async def playground_ws(ws: WebSocket):
    await ws.accept()

    engine = TrustEngine()
    anomaly = AnomalySimulator(seed=99)

    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)

            if msg.get('action') == 'simulate_sequence':
                events = msg.get('events', [])
                results = []
                t = 0.0
                dt = 1.0 / 30.0

                for ev in events:
                    status = ev.get('status', 'VISION_OK')
                    noise = ev.get('noise', 0.0)
                    brightness = ev.get('brightness', 0.5)
                    frames = ev.get('frames', 30)

                    for _ in range(frames):
                        score = anomaly.compute_anomaly(noise, brightness, status)
                        state = engine.update(status, score, dt)
                        state['anomaly_score'] = round(score, 6)
                        t += dt
                        state['sim_time'] = round(t, 4)
                        results.append(state)

                await ws.send_json({
                    'type': 'sequence_result',
                    'data': results,
                })

            elif msg.get('action') == 'reset':
                engine.reset()
                anomaly.reset(seed=99)

    except WebSocketDisconnect:
        pass
    except Exception:
        pass


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
