1. Project Motivation

Most vision systems answer the question:

“What does the camera see?”

This project answers a different, more fundamental question:

“Can the camera be trusted right now?”

In real robotic systems, acting on unreliable perception can be more dangerous than acting with no perception at all. This project explores failure awareness, temporal trust, and conservative ML integration for vision-based systems.

The goal is not accuracy, not SOTA, and not autonomy, but defensible system behavior under uncertainty.

2. Core Design Principles

The system is built around the following principles:

Failure awareness over accuracy

Systems thinking over model obsession

Temporal reasoning over instant reactions

Interpretability over complexity

ML as a bounded signal, not authority

Reproducibility and logging over demos

Every design decision follows these constraints.

3. High-Level Architecture
Image Source (File / Video / Gazebo Camera)
        ↓
ROS Topic: /image_raw
        ↓
Image Subscriber (Vision Inspection + ML)
        ├─ Rule-based checks → /vision_status
        └─ ML anomaly score  → /vision_anomaly
        ↓
Vision Supervisor (Core Logic)
        ├─ Temporal reasoning
        ├─ Reliability estimation (0–1)
        ├─ Policy gating
        ├─ ML-influenced trust decay (bounded)
        └─ CSV logging


The system is source-agnostic: any camera publishing /image_raw can be used (file, webcam, simulation, or robot).

4. Implemented ROS Nodes
4.1 Image Subscriber (image_subscriber.py)

Responsibilities

Subscribes to /image_raw

Converts ROS images to OpenCV

Performs interpretable rule-based failure checks:

VISION_OK

VISION_FROZEN

VISION_BLANK

VISION_CORRUPTED

Runs unsupervised ML inference (autoencoder)

Publishes:

/vision_status (categorical)

/vision_anomaly (continuous scalar)

Important Notes

Rule-based checks are allowed to be noisy

ML anomaly score has no thresholds

The node makes no decisions

4.2 Vision Supervisor (vision_supervisor.py) — Core Artifact

This is the core contribution of the project.

Responsibilities

Subscribes to:

/vision_status

/vision_anomaly

Maintains a continuous reliability score in [0, 1]

Applies time-scaled trust dynamics

Converts reliability into policy states

Logs all state transitions and signals to CSV

Published Output

/vision_reliability (Float32)

Logged CSV evidence

5. Reliability and Policy Model
5.1 Reliability

Continuous scalar in range [0.0, 1.0]

Updated based on:

Vision status

Time duration

ML anomaly (only under specific conditions)

Key Property

Reliability changes gradually — never instantaneously.

This prevents reactions to single-frame glitches.

5.2 Policy States
Reliability Range	Policy State
≥ 0.7	VISION_ALLOWED
0.3 – 0.7	VISION_DEGRADED
< 0.3	VISION_BLOCKED

Policy changes are:

edge-triggered

logged only on change

conservative by design

6. ML Integration Strategy (Critical Section)
6.1 ML Model

Unsupervised convolutional autoencoder

Trained only on normal vision data

Learns a compact representation of nominal visual input

Produces a reconstruction error used as an anomaly signal

6.2 ML Is Treated as a Sensor

The ML output:

is continuous

has no thresholds

does not make decisions

does not override rules

It is observed, logged, and interpreted temporally.

6.3 ML Influence (Phase 3 Design)

ML is allowed to influence trust only under this condition:

Vision status must be VISION_OK

Rationale:

Explicit failures (frozen, blank, corrupted) are better detected by rules

ML is useful only for subtle degradation and distribution shifts

Effect of ML

ML can accelerate trust decay

ML can never restore trust

ML influence leaks away over time

This prevents:

false authority

permanent punishment

unsafe overrides

7. Verified Behavior (Experimentally Confirmed)
7.1 Normal Vision

Rule-based status: VISION_OK

Reliability remains high

Policy remains VISION_ALLOWED

ML anomaly remains low and stable

7.2 Explicit Failures (Frozen / Blank)

Rules trigger immediately

Reliability decays to zero

Policy transitions to VISION_BLOCKED

ML anomaly remains low (expected and correct)

7.3 Subtle Degradation

Rules may remain VISION_OK

ML anomaly accumulates over time

Trust decays faster than baseline

System becomes more cautious earlier

8. Data Logging and Evidence

All system behavior is logged to:

~/vision_logs/vision_reliability_log.csv


Logged Fields

timestamp

reliability

policy_state

anomaly

anomaly_integral

This enables:

offline analysis

plotting

reproducibility

defensible claims

9. Simulation Integration (Gazebo)

The system has been validated using Gazebo Classic as a camera source.

Gazebo camera publishes /image_raw

No changes required to vision or supervisor logic

Simulation pause, lighting changes, and scene manipulation induce failures

This confirms:

The system is hardware-agnostic and deployment-ready.

10. Scope Deliberately Excluded

The following are intentionally not included:

Autonomous navigation

SLAM

Object detection

Reinforcement learning

End-to-end ML control

Black-box decision-making

This project focuses on trust, not autonomy.

11. Key Takeaway

This project demonstrates that:

Safe intelligent systems are built by combining simple rules, temporal reasoning, and carefully bounded ML — not by maximizing model complexity.

The system favors:

conservative behavior

explainability

evidence-backed decisions

12. Future Extensions (Optional)

Interactive web dashboard (ROS ↔ WebSocket)

User-controlled environment degradation

Visualization of trust dynamics

Deployment on real robotic hardware

These extensions do not change the core logic.

13. Final Status

System State: Frozen
Behavior: Verified
ML Role: Bounded and justified
Evidence: Logged and reproducible

This project is considered complete and defensible long-term.