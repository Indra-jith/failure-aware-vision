"""
FastAPI backend — WebSocket-driven trust simulation server.

Serves the frontend statically and provides a WebSocket endpoint
for real-time trust state streaming.

Supports two operating modes per connection:
  - "simulation" (default): slider-driven anomaly via AnomalySimulator
  - "live": real video analysis via SignalAnalyzer + VideoSource
"""

import asyncio
import base64
import json
import os
import tempfile
import time

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.responses import HTMLResponse, PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from trust_engine import TrustEngine
from vision_simulator import VisionSimulator
from anomaly_simulator import AnomalySimulator
from session_logger import SessionLogger
from failure_attributor import FailureAttributor
from signal_analyzer import SignalAnalyzer
from video_source import VideoSource

app = FastAPI(title="Vision Trust Platform", version="2.0.0")

# Frontend path: always relative to this script, so it works no matter where the server is started from
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIR = os.path.normpath(os.path.join(_BASE_DIR, "..", "frontend"))
_UPLOAD_DIR = os.path.join(_BASE_DIR, "uploads")
os.makedirs(_UPLOAD_DIR, exist_ok=True)

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
    return {"status": "ok", "engine": "trust_v2", "modes": ["simulation", "webcam", "video"]}


# ── Video file upload endpoint ──

@app.post("/api/upload-video")
async def upload_video(file: UploadFile = File(...)):
    """Accept a video file upload. Returns a server-side path for WS playback."""
    if not file.filename:
        return JSONResponse({"error": "No file provided"}, status_code=400)

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ('.mp4', '.avi', '.mov', '.mkv', '.webm'):
        return JSONResponse({"error": f"Unsupported format: {ext}"}, status_code=400)

    # Save to uploads dir
    safe_name = f"upload_{int(time.time())}{ext}"
    filepath = os.path.join(_UPLOAD_DIR, safe_name)
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    return {"path": filepath, "filename": safe_name, "size": len(content)}


def _frame_to_base64_jpeg(frame: np.ndarray, quality: int = 40) -> str:
    """Encode a BGR frame as a base64 JPEG string."""
    _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode('ascii')


# ── WebSocket endpoint ──

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()

    # Per-connection instances
    engine = TrustEngine()
    vision = VisionSimulator()
    anomaly = AnomalySimulator(seed=42)
    logger = SessionLogger()
    attributor = FailureAttributor()

    # Live mode instances
    analyzer = SignalAnalyzer()
    video_src = VideoSource()

    # Connection state
    source_mode = "simulation"  # "simulation" | "webcam" | "video"
    tick_rate = 30  # Hz
    running = True
    last_time = time.time()
    last_processed_frame_id = 0  # track the last frame we analyzed
    last_analysis = None         # cache the last analysis result

    async def simulation_loop():
        nonlocal last_time, running, last_processed_frame_id, last_analysis
        while running:
            now = time.time()
            dt = now - last_time
            last_time = now

            state = None

            if source_mode == "simulation":
                # ── Original simulation mode (slider-driven) ──
                vision_status = vision.get_vision_status()
                frame_info = vision.get_frame_descriptor()
                anomaly_score = anomaly.compute_anomaly(
                    vision.noise_level, vision.brightness, vision_status
                )

                state = engine.update(vision_status, anomaly_score, dt)
                state['anomaly_score'] = round(anomaly_score, 6)
                state['dt'] = round(dt, 6)
                state['frame'] = frame_info
                state['source_mode'] = 'simulation'

            else:
                # ── Live mode (webcam or video file) ──
                frame, frame_id = video_src.get_frame()

                if frame is not None:
                    is_new_frame = (frame_id != last_processed_frame_id)

                    if is_new_frame:
                        # Genuinely new frame — run analysis
                        last_analysis = analyzer.analyze_frame(frame)
                        last_processed_frame_id = frame_id

                    if last_analysis is not None:
                        analysis = last_analysis
                        anomaly_score = analysis['anomaly_score']
                        vision_status = analysis['vision_status']

                        state = engine.update(vision_status, anomaly_score, dt)
                        state['anomaly_score'] = round(anomaly_score, 6)
                        state['dt'] = round(dt, 6)
                        state['frame'] = {
                            'mode': source_mode,
                            'noise_level': analysis['metrics']['blur'],
                            'brightness': 1.0 - analysis['metrics']['brightness'],
                            'vision_status': vision_status,
                        }
                        state['source_mode'] = source_mode
                        state['signal_metrics'] = analysis['metrics']

                        # Encode frame as base64 JPEG — only on new frames
                        if is_new_frame:
                            state['video_frame'] = _frame_to_base64_jpeg(frame)
                else:
                    # No frame available yet — send heartbeat
                    state = engine.get_state()
                    state['dt'] = round(dt, 6)
                    state['source_mode'] = source_mode
                    state['waiting_for_frame'] = True

            if state:
                # Failure attribution
                attributor.update(state, state['timestamp'])
                state['failure_events'] = attributor.get_summary()

                # Log
                logger.log(state, state.get('anomaly_score', 0))

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

            # ── Source mode switching ──
            if action == 'set_source_mode':
                new_mode = msg.get('mode', 'simulation')

                if new_mode == 'simulation':
                    video_src.stop()
                    analyzer.reset()
                    source_mode = 'simulation'

                elif new_mode == 'webcam':
                    video_src.stop()
                    analyzer.reset()
                    success = video_src.start(0)
                    if success:
                        source_mode = 'webcam'
                    else:
                        source_mode = 'simulation'
                        await ws.send_json({
                            'type': 'error',
                            'message': 'Could not open webcam. Falling back to simulation mode.'
                        })

                elif new_mode == 'video':
                    filepath = msg.get('filepath', '')
                    if filepath and os.path.isfile(filepath):
                        video_src.stop()
                        analyzer.reset()
                        success = video_src.start(filepath)
                        if success:
                            source_mode = 'video'
                        else:
                            source_mode = 'simulation'
                            await ws.send_json({
                                'type': 'error',
                                'message': 'Could not open video file.'
                            })
                    else:
                        await ws.send_json({
                            'type': 'error',
                            'message': 'Video file path not provided or not found.'
                        })

                # Reset engine on mode switch for clean state
                engine.reset()
                attributor.reset()
                last_time = time.time()

                await ws.send_json({
                    'type': 'mode_changed',
                    'source_mode': source_mode,
                })

            # ── Simulation-mode controls (only active in sim mode) ──
            elif action == 'set_vision':
                if source_mode == 'simulation':
                    mode = msg.get('mode', 'normal')
                    vision.set_mode(mode)

            elif action == 'set_noise':
                if source_mode == 'simulation':
                    level = float(msg.get('level', 0))
                    vision.set_noise(level)

            elif action == 'set_brightness':
                if source_mode == 'simulation':
                    level = float(msg.get('level', 0.5))
                    vision.set_brightness(level)

            elif action == 'reset':
                engine.reset()
                vision.reset()
                anomaly.reset(seed=42)
                analyzer.reset()
                logger.reset()
                attributor.reset()
                last_time = time.time()

            elif action == 'set_tick_rate':
                tick_rate = max(1, min(60, int(msg.get('hz', 30))))

            elif action == 'get_log':
                csv_data = logger.get_csv()
                await ws.send_json({
                    'type': 'log_data',
                    'csv': csv_data,
                    'failure_csv': attributor.get_events_csv(),
                    'entries': logger.entry_count,
                    'failure_summary': attributor.get_summary(),
                })

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        running = False
        video_src.stop()
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
