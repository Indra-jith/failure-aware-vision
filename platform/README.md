# Failure-Aware Vision Trust Platform

> Interactive research visualization platform for temporal trust dynamics with bounded ML influence.

## Quick Start

```bash
# Install dependencies
cd platform/backend
pip install -r requirements.txt

# Start the server
python3 main.py
# → Server runs at http://localhost:8000
```

## Pages

| Page | URL | Description |
|------|-----|-------------|
| **Trust Simulator** | `/` | Real-time trust engine simulation with vision controls, animated gauge, and charts |
| **Architecture** | `/architecture` | Interactive pipeline diagram with ROS2 source mapping |
| **ML Playground** | `/playground` | Sequence simulation, frame comparison, and trust evolution |

## Architecture

```
backend/
├── main.py               # FastAPI + WebSocket server
├── trust_engine.py        # Pure-Python trust engine (mirrors vision_supervisor.py)
├── vision_simulator.py    # Rule-based vision state mapping
├── anomaly_simulator.py   # ML anomaly score proxy (no PyTorch)
└── session_logger.py      # CSV session logging

frontend/
├── index.html             # Trust Simulator
├── architecture.html      # Pipeline visualization
├── playground.html        # ML Playground
├── css/style.css          # Design system (dark + glass + neon)
└── js/                    # app.js, gauge.js, charts.js, ws.js, architecture.js, playground.js
```

## Trust Engine Math

Mirrors `ros2_ws/src/failure_aware_ros/failure_aware_ros/vision_supervisor.py`:

| Vision Status | Reliability Update | ML Active |
|---|---|---|
| `VISION_OK` | `+0.10 * dt` − ML penalty | Yes |
| `VISION_FROZEN` | `−0.30 * dt` | No |
| `VISION_BLANK` | `−0.60 * dt` | No |
| `VISION_CORRUPTED` | `−1.00 * dt` | No |

**ML Influence (bounded):** `penalty = 0.15 * anomaly_integral * dt`, integral leaks at rate 0.5.

**Policy Gating:** `≥0.7 → ALLOWED`, `≥0.3 → DEGRADED`, `<0.3 → BLOCKED`

## Key Invariants

1. **Explicit failures dominate** — ML disabled on FROZEN/BLANK/CORRUPTED
2. **Bounded ML influence** — penalty only, never restores trust
3. **Temporal trust memory** — anomaly integral with leak, time-aware (dt-based)
4. **Deterministic policy** — derived from reliability thresholds only
