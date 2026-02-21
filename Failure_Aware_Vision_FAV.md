# 👁️ Failure-Aware Vision (FAV)

## 📌 The Core Problem

Modern autonomous systems (self-driving cars, drones, delivery robots)
rely heavily on computer vision to navigate.\
The fatal flaw? They blindly trust their cameras.

If a camera lens is covered in mud, blinded by glaring sunlight, or
freezes due to a hardware glitch, the AI often does not detect the
failure. It may hallucinate a clear path --- leading to catastrophic
crashes.

------------------------------------------------------------------------

## 💡 The Solution

**Failure-Aware Vision (FAV)** introduces a real-time **Trust
Framework**.

Instead of only asking: \> "What does the camera see?"

The system continuously asks: \> "How reliable is the camera itself?"

The system analyzes incoming video frame-by-frame for anomalies: -
Blur - Blackout - Digital corruption - Frame freezes

When image quality degrades, the system instantly reduces a **Trust
Reliability Percentage**, triggering a safety stop before a crash
occurs.

------------------------------------------------------------------------

# 🏗️ System Architecture

The project is built as a highly decoupled, real-time web application.

-   **Backend:** Python + FastAPI (Data Processing & Trust Engine)
-   **Frontend:** HTML5 + Vanilla JS + CSS (Glassmorphism UI)
-   **Communication:** WebSockets streaming at 30Hz

------------------------------------------------------------------------

# 🧠 The Backend (The Brain)

The backend acts like an embedded robot operating system, running a
continuous 30Hz simulation loop inside a WebSocket connection.

------------------------------------------------------------------------

## 1️⃣ signal_analyzer.py (Real-Time Image Quality)

Using OpenCV, each frame is scored across four anomaly vectors:

### • Laplacian Variance (Blur)

Measures edge sharpness. Drops near zero if lens is defocused or
smeared.

### • Mean Brightness

Detects overexposure (blinding light) or blackout (dark obstruction).

### • Pixel Entropy

Measures statistical randomness. Detects digital corruption or static
noise.

### • Frame Differencing

Compares current frame to previous frame.\
If difference remains zero for 5 frames → camera freeze detected.

These four vectors are fused into a single:

**Anomaly Score (0.0 -- 1.0)**

------------------------------------------------------------------------

## 2️⃣ trust_engine.py (Safety State Machine)

Acts as the robot's prefrontal cortex.\
It does not process images --- only the anomaly trend over time.

### • Reliability %

Maps anomaly damage into a percentage: - 100% = Perfect vision - \<30% =
Critical failure

### • Trust Velocity

Measures how fast trust is dropping.\
A sudden blackout is penalized harder than gradual degradation.

### • Recovery Debt

Prevents instant acceleration after recovery.\
The robot must "pay off" cooldown debt before resuming motion.

------------------------------------------------------------------------

## 3️⃣ main.py & video_source.py (Server Layer)

The FastAPI server manages dual modes:

### Simulation Mode

Synthetic math-based sliders simulate camera degradation.

### Live Mode

-   Captures real frames via cv2.VideoCapture
-   Processes through SignalAnalyzer
-   Compresses frames
-   Streams JSON state via WebSockets

------------------------------------------------------------------------

# 💻 The Frontend (The Dashboard)

A custom-built Glassmorphism HUD using: - Vanilla JS - HTML5 Canvas -
CSS Grid

Designed to visualize the internal AI decision-making process.

------------------------------------------------------------------------

## Real-Time Visualizers (app.js)

### Robot World (Left Canvas)

-   Side-scrolling landscape
-   Parallax trees
-   Spinning robot wheel
-   Instantly halts when Reliability \< 30%

### Camera Vision (Right Canvas)

**Simulation Mode:** - Synthetic 3D road rendering - Blur filters -
Noise simulation - Brightness adjustments

**Live Mode:** - Displays real webcam/video feed - Overlays metrics: -
Blur - Brightness - Freeze - Entropy

------------------------------------------------------------------------

## Live Telemetry (Chart.js)

### Reliability Gauge

-   Speedometer-style gauge
-   Cyan = Safe
-   Yellow = Warning
-   Red = Critical

### Time-Series Chart

-   Rolling 150-point history
-   Shows anomaly spikes
-   Visualizes reliability drops
-   Makes Trust Debt visible

------------------------------------------------------------------------

# 🎨 UI/UX Design

Built without external CSS frameworks.

Features: - backdrop-filter: blur() - Multi-layer gradients - Glowing
shadows - Custom CSS variables - High-performance futuristic aesthetic

------------------------------------------------------------------------

# ☁️ Cloud Infrastructure (100% Free Production Stack)

## Render.com Hosting

-   Backend + frontend bundled in one service
-   Uses opencv-python-headless
-   Dynamic ws:// to wss:// WebSocket switching

## Anti-Sleep Strategy (UptimeRobot)

-   Pings /health endpoint every 5 minutes
-   Prevents cold starts
-   Ensures 24/7 uptime

## Ephemeral Storage

-   Uploaded MP4s stored temporarily
-   Auto-wiped during redeploy
-   Acts as free garbage collector

------------------------------------------------------------------------

# 🚀 Why This Project Matters

AI should not only be intelligent about what it sees ---\
it must also understand how reliably it sees.

Failure-Aware Vision decouples perception hardware from driving logic
through a mathematical Trust Engine.

This represents a foundational safety upgrade for: - Autonomous
vehicles - Robotics - Drones - Delivery systems

------------------------------------------------------------------------

**Failure-Aware Vision (FAV)**\
Making AI not just intelligent --- but self-aware of its own perception
failures.
