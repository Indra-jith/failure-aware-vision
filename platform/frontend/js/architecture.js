/**
 * Architecture page — interactive pipeline node details.
 */

const nodeDetails = {
    input: {
        title: 'User Input — Sensor Source',
        concept: `In the real ROS2 system, visual data arrives from a Gazebo-simulated camera via the <code>/image_raw</code> topic. Each frame is a raw sensor message (sensor_msgs/Image) published at approximately 30 Hz.

In the web simulation, the user controls the input mode directly — selecting between normal operation, frame freeze, blank frame, or corruption. This mirrors the real failure scenarios encountered by the camera sensor in a deployed robotics system.`,
        logic: `# ROS2: Camera publishes to /image_raw
# Web: User selects mode via control panel

Input modes:
  normal     →  Continuous frame stream
  frozen     →  Repeated identical frame
  blank      →  Near-zero intensity frame
  corrupted  →  Mismatched frame dimensions`,
        rosFile: 'gazebo_camera_demo/launch/camera_world.launch.py',
        mlNote: 'No ML involvement at input stage. Raw sensor data only.',
    },

    vision: {
        title: 'Vision Simulation — Frame Generation',
        concept: `The vision simulation layer generates synthetic camera frames that mimic real sensor behavior. In the web platform, this uses Canvas-based rendering with configurable parameters:

• <strong>Noise injection</strong>: Gaussian noise at configurable intensity
• <strong>Brightness control</strong>: Simulates lighting conditions
• <strong>Frame freeze</strong>: Mimics sensor lockup
• <strong>Blank frame</strong>: Simulates complete signal loss
• <strong>Corruption</strong>: Random pixel artifacts

Each configuration maps deterministically to a vision status classification.`,
        logic: `# Frame state classification rules:
if frame == previous_frame:       # diff < 1.0
    status = VISION_FROZEN
elif mean(frame) < 5:
    status = VISION_BLANK
elif frame.shape != expected:
    status = VISION_CORRUPTED
else:
    status = VISION_OK`,
        rosFile: 'failure_aware_ros/image_subscriber.py (lines 67-89)',
        mlNote: 'No ML involvement. Frame states are classified by deterministic rules only.',
    },

    rule: {
        title: 'Rule-Based Detector — Failure Classification',
        concept: `The rule-based detector is the first line of defense. It classifies each incoming frame into exactly one of four states using simple, deterministic checks:

<strong>VISION_OK</strong>: Frame is valid, changes between captures
<strong>VISION_FROZEN</strong>: Frame identical to previous (diff < 1.0)
<strong>VISION_BLANK</strong>: Mean pixel intensity below 5
<strong>VISION_CORRUPTED</strong>: Frame shape mismatch

These rules are <em>non-negotiable</em>. When any failure state is detected, ML influence is immediately disabled. This is the core invariant of the bounded ML philosophy: <strong>explicit failures always dominate</strong>.`,
        logic: `def on_image(self, msg):
    frame = self.bridge.imgmsg_to_cv2(msg, 'bgr8')
    status = 'VISION_OK'

    if self.prev_frame is not None:
        if frame.shape != self.prev_frame.shape:
            status = 'VISION_CORRUPTED'
        else:
            diff = np.mean(np.abs(
                frame.astype(np.float32) -
                self.prev_frame.astype(np.float32)
            ))
            if diff < 1.0:
                status = 'VISION_FROZEN'

    if np.mean(frame) < 5:
        status = 'VISION_BLANK'

    self.prev_frame = frame.copy()`,
        rosFile: 'failure_aware_ros/image_subscriber.py (lines 73-89)',
        mlNote: 'Rule-based only. ML cannot override these classifications.',
    },

    ml: {
        title: 'ML Anomaly Model — Autoencoder',
        concept: `A convolutional autoencoder is trained on "normal" camera frames from the deployment environment. At inference time, each frame is:

1. Resized to 128×128
2. Normalized to [0, 1]
3. Passed through the encoder-decoder
4. Compared to the original via MSE

The <strong>reconstruction error</strong> is the anomaly score — a continuous value, not a binary classification. Higher error indicates the frame deviates from what the model considers "normal".

<strong>Key design constraint</strong>: The anomaly score is a <em>penalty signal</em>, not a decision signal. It can accelerate trust decay but <strong>cannot restore trust</strong> and <strong>cannot override rule-based failures</strong>.

In the web simulation, this is approximated with a heuristic proxy that produces scores matching the real distribution (~0.019 baseline for normal frames).`,
        logic: `# Autoencoder architecture (Conv2d → ReLU → ConvTranspose2d)
# Trained on normal frames from Gazebo camera
# MSE reconstruction error = anomaly score

class AutoEncoder(nn.Module):
    encoder: Conv2d(3→16) → ReLU → Conv2d(16→32) → ReLU
    decoder: ConvTranspose2d(32→16) → ReLU → ConvTranspose2d(16→3) → Sigmoid

# Inference:
img = resize(frame, 128x128) / 255.0
tensor = torch.tensor(img).permute(2,0,1).unsqueeze(0)
recon = model(tensor)
anomaly_score = MSE(recon, tensor)  # ≈ 0.019 for normal`,
        rosFile: 'ml_phase1/train_autoencoder.py, ml_phase1/run_inference.py, failure_aware_ros/image_subscriber.py (lines 99-108)',
        mlNote: 'ML produces continuous score only. No thresholding. No override capability. Score feeds into trust engine as a bounded penalty term.',
    },

    trust: {
        title: 'Temporal Trust Engine — Core Mathematics',
        concept: `The trust engine is the heart of the system. It maintains a single <strong>reliability</strong> value ∈ [0, 1] that evolves over time based on:

1. <strong>Base decay/recovery</strong>: Determined entirely by the vision status
2. <strong>ML penalty</strong>: Applied only during VISION_OK, bounded by the anomaly integral
3. <strong>Temporal memory</strong>: Anomaly integral accumulates over time with leak

The update is <strong>time-aware</strong> (uses dt), not frame-count-based. This ensures consistent behavior regardless of processing rate.

<strong>Critical invariant</strong>: On any explicit failure (FROZEN, BLANK, CORRUPTED), ML influence is disabled and the anomaly integral is reset to zero. ML influence is never allowed to counteract deterministic failures.`,
        logic: `def update(vision_status, anomaly_score, dt):
    if status == VISION_OK:
        reliability += 0.10 * dt           # base recovery

        # ML-influenced decay (bounded)
        anomaly_integral += anomaly_score * dt
        anomaly_integral -= 0.5 * anomaly_integral * dt  # leak
        anomaly_integral = max(0.0, anomaly_integral)
        ml_penalty = 0.15 * anomaly_integral
        reliability -= ml_penalty * dt

    elif status == VISION_FROZEN:
        reliability -= 0.30 * dt
        anomaly_integral = 0.0             # ML disabled

    elif status == VISION_BLANK:
        reliability -= 0.60 * dt
        anomaly_integral = 0.0             # ML disabled

    elif status == VISION_CORRUPTED:
        reliability -= 1.00 * dt
        anomaly_integral = 0.0             # ML disabled

    reliability = clamp(reliability, 0, 1)`,
        rosFile: 'failure_aware_ros/vision_supervisor.py (lines 160-188)',
        mlNote: 'ML penalty is bounded: ANOMALY_DECAY_GAIN=0.15, ANOMALY_LEAK=0.5. The penalty can only decrease reliability — it cannot add trust. On failure states, anomaly_integral is zeroed.',
    },

    policy: {
        title: 'Policy Gating — Action Derivation',
        concept: `Policy state is derived <strong>solely from the reliability value</strong>, using fixed thresholds. There is no shortcut logic, no override mechanism, and no hysteresis.

<strong>VISION_ALLOWED</strong> (reliability ≥ 0.7): Full vision usage permitted
<strong>VISION_DEGRADED</strong> (0.3 ≤ reliability < 0.7): Limited vision, reduced authority
<strong>VISION_BLOCKED</strong> (reliability < 0.3): Vision system disabled

The control guard translates these policy states into action commands:
• ALLOWED → USE_VISION
• DEGRADED → LIMIT_VISION
• BLOCKED → DISABLE_VISION

Policy changes are edge-triggered — only published when the state actually changes.`,
        logic: `def update_policy(reliability):
    if reliability >= 0.7:
        return 'VISION_ALLOWED'   →  'USE_VISION'
    elif reliability >= 0.3:
        return 'VISION_DEGRADED'  →  'LIMIT_VISION'
    else:
        return 'VISION_BLOCKED'   →  'DISABLE_VISION'

# Thresholds: 0.7 (allowed), 0.3 (blocked)
# No hysteresis band — clean, deterministic transitions`,
        rosFile: 'failure_aware_ros/vision_supervisor.py (lines 101-113), failure_aware_ros/vision_control_guard.py',
        mlNote: 'Policy is derived from reliability only. ML has indirect influence through the trust engine — never direct influence on policy.',
    },

    logger: {
        title: 'Session Logger — Data Recording',
        concept: `Every trust state update is logged to CSV with the following fields:

• <strong>timestamp</strong>: Unix epoch time
• <strong>reliability</strong>: Current trust value
• <strong>policy_state</strong>: ALLOWED / DEGRADED / BLOCKED
• <strong>anomaly</strong>: ML anomaly score for this tick
• <strong>anomaly_integral</strong>: Accumulated anomaly with leak

This enables:
• Post-hoc analysis of trust evolution
• Reproducible experiments
• Comparison between sessions
• Validation against ROS2 log format

The web platform allows CSV download of any session for external analysis with matplotlib or similar tools.`,
        logic: `# CSV format (matches ROS2 output):
timestamp, reliability, policy_state, anomaly, anomaly_integral

# Example row:
1770743832.435, 1.000, VISION_ALLOWED, 0.019437, 0.000342

# Log is flushed after every write for reliability`,
        rosFile: 'failure_aware_ros/vision_supervisor.py (lines 62-78, 119-128), vision_logs/vision_reliability_log.csv',
        mlNote: 'Logger records all state including ML scores — enables full audit trail of bounded ML influence.',
    },
};

let activeNode = null;

function showDetail(nodeId) {
    const detail = nodeDetails[nodeId];
    if (!detail) return;

    // Update active state
    document.querySelectorAll('.pipeline-node').forEach(n => n.classList.remove('active'));
    const activeEl = document.querySelector(`.pipeline-node[data-node="${nodeId}"]`);
    if (activeEl) activeEl.classList.add('active');
    activeNode = nodeId;

    // Show detail panel
    const panel = document.getElementById('detailPanel');
    panel.classList.add('visible');

    const content = document.getElementById('detailContent');
    content.innerHTML = `
    <h2 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 1.25rem; color: var(--text-primary);">${detail.title}</h2>

    <div class="detail-section">
      <h3>Concept</h3>
      <p>${detail.concept}</p>
    </div>

    <div class="detail-section">
      <h3>Logic</h3>
      <pre>${detail.logic}</pre>
    </div>

    <div class="detail-section">
      <h3>ROS2 Source Mapping</h3>
      <p><span class="file-ref">📁 ${detail.rosFile}</span></p>
    </div>

    <div class="detail-section">
      <h3>Bounded ML Influence</h3>
      <p style="padding: 0.75rem 1rem; background: rgba(255, 0, 170, 0.06); border: 1px solid rgba(255, 0, 170, 0.12); border-radius: 8px; font-size: 0.82rem;">
        ${detail.mlNote}
      </p>
    </div>
  `;
}
