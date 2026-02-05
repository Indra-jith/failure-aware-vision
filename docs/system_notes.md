# Failure-Aware Vision System — System Notes

## Purpose
This system is designed to explicitly detect and reason about **vision input failures**
before any ML model or robot control logic is involved.

The goal is not accuracy, but **knowing when vision should not be trusted**.

---

## High-Level Architecture

Image Source (external)
    ↓
ROS Image Topic (/image_raw)
    ↓
Image Subscriber (Vision Inspection)
    ↓
Vision Status Topic (/vision_status)
    ↓
Vision Supervisor (Temporal Decision Logic)

---

## Node Responsibilities

### 1. Image Publisher (external)
- Publishes images as `sensor_msgs/Image`
- Acts as a camera stand-in
- Performs **no validation**
- Not part of this project’s logic

---

### 2. Image Subscriber (vision node)
Responsibilities:
- Convert ROS Image → OpenCV
- Inspect image quality
- Detect basic failure modes:
  - frozen frames
  - blank frames
  - corrupted shapes
- Publish explicit vision status

Published statuses:
- VISION_OK
- VISION_FROZEN
- VISION_BLANK
- VISION_CORRUPTED

This node is allowed to be **noisy** and frame-based.

---

### 3. Vision Supervisor
Responsibilities:
- Subscribe to `/vision_status`
- Track how long a status persists
- Make **edge-triggered decisions**
- Avoid reacting to transient glitches

Design choices:
- No access to images
- No OpenCV
- No ML
- Decisions are time-based and explicit

---

## Key Design Principles

- Separation of sensing and decision-making
- Explicit system state via topics
- Temporal reasoning handled centrally
- Failure awareness before ML

---

## Current Status

Implemented:
- Image input pipeline
- Failure detection
- Vision status publishing
- Temporal supervision

Not yet implemented:
- ML models
- Confidence estimation
- Robot control actions

These are intentionally postponed.

## Temporal Reasoning

The supervisor applies **persistence thresholds** before acting:

| Vision Status      | Required Persistence |
|-------------------|----------------------|
| `VISION_OK`        | Immediate            |
| `VISION_FROZEN`    | ≥ 2 seconds          |
| `VISION_BLANK`     | ≥ 1 second           |
| `VISION_CORRUPTED` | Immediate            |

This prevents:
- reacting to single bad frames
- unstable or oscillatory behavior

Decisions are **edge-triggered**:
- A decision is logged **once**
- No repeated actions until status changes

---

## Vision Reliability Score

In addition to categorical status, the supervisor maintains a
continuous reliability value:

vision_reliability ∈ [0.0, 1.0]


Interpretation:
- `1.0` → vision fully reliable
- `0.0` → vision untrustworthy

### Update behavior (leaky integrator)

| Status             | Effect on Reliability |
|-------------------|----------------------|
| `VISION_OK`        | Slowly increases     |
| `VISION_FROZEN`    | Gradually decreases  |
| `VISION_BLANK`     | Decreases faster     |
| `VISION_CORRUPTED` | Sharp decrease       |

Properties:
- Reliability depends on **history**
- Degrades under sustained failure
- Recovers gradually after stability
- Clamped to `[0.0, 1.0]`

This provides a **continuous confidence signal** without ML.

## Policy Layer (What the System Allows)

The supervisor converts reliability into **clear policy states**:

| Reliability Range | Policy State        | Meaning |
|------------------|---------------------|--------|
| `≥ 0.7`          | `VISION_ALLOWED`    | Vision can be used |
| `0.3 – 0.7`      | `VISION_DEGRADED`   | Use with caution |
| `< 0.3`          | `VISION_BLOCKED`    | Do not use vision |

Policy changes are:
- logged explicitly
- rare
- explainable

## Data Logging (Evidence Generation)

The system records its internal state to disk for analysis.

Logged fields:
- timestamp
- vision reliability
- policy state

Format:
- CSV file
- Written by the supervisor
- One row per update

Purpose:
- enables plotting
- enables experiment comparison
- provides hard evidence of system behavior

---

## Verified Behavior (Observed in Experiments)

Experiments confirm that the system:

- Gradually loses trust under sustained vision failure
- Enters a degraded warning state before blocking vision
- Fully blocks vision when reliability is too low
- Does not recover unless vision actually improves
- Recovers slowly and cautiously when input stabilizes

These behaviors were validated using logged data.

---

## Current Project Status

### Implemented
- Vision failure detection
- Temporal supervision
- Continuous reliability estimation
- Policy gating
- Reliability publishing as ROS topic
- CSV data logging

### Intentionally Not Implemented (Yet)
- Machine learning models
- Learned uncertainty
- Robot control actions
- Dataset replay or training

These are postponed to preserve clarity and correctness.

---

## Design Principles (Non-Negotiable)

- Failure awareness before accuracy
- Systems thinking before ML
- Explicit state over implicit behavior
- Time-based reasoning
- Honest confidence signals

---

## Summary (Non-Technical)

> The system watches the camera, slowly loses trust if the image becomes unreliable, warns early, blocks vision when necessary, and records everything so the decisions can be explained later.