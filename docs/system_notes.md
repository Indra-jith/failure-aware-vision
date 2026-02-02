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
