"""
Pure-Python Trust Engine — mirrors ROS2 vision_supervisor.py exactly.

Mathematical invariants preserved:
  - Explicit failures dominate (ML disabled on FROZEN/BLANK/CORRUPTED)
  - Bounded ML influence (penalty only, never restores trust)
  - Temporal trust memory (anomaly integral with leak)
  - Policy gating derived solely from reliability thresholds
"""

import time


class TrustEngine:
    """Temporal trust engine with bounded ML influence.

    Mirrors: ros2_ws/src/failure_aware_ros/failure_aware_ros/vision_supervisor.py
    """

    # Decay rates per vision status (lines 160-183 of vision_supervisor.py)
    DECAY_RATES = {
        'VISION_OK': -0.10,       # recovery (positive direction)
        'VISION_FROZEN': 0.30,    # moderate decay
        'VISION_BLANK': 0.60,     # fast decay
        'VISION_CORRUPTED': 1.00, # maximum decay
    }

    # Asymmetric recovery constants
    RECOVERY_DEBT_MAX   = 10.0   # cap on accumulated debt
    RECOVERY_DEBT_GAIN  = 0.008  # how much each unit of debt slows recovery
    RECOVERY_MIN_COEFF  = 0.03   # floor on recovery rate
    RECOVERY_DEBT_DRAIN = 0.10   # debt drains at this rate during VISION_OK

    def __init__(self):
        self.reset()

    def reset(self):
        """Reset engine to initial state."""
        self.reliability: float = 1.0
        self.policy_state: str = 'VISION_ALLOWED'
        self.anomaly_integral: float = 0.0
        self.current_status: str = None
        self.status_start_time: float = None
        self.last_update_time: float = None

        # ML influence parameters (system constants, not ML magic)
        self.ANOMALY_DECAY_GAIN: float = 0.15
        self.ANOMALY_LEAK: float = 0.5

        # Trust velocity (d(reliability)/dt, EMA-smoothed)
        self.trust_velocity: float = 0.0
        self._prev_reliability: float = 1.0
        self._velocity_ema_alpha: float = 0.12  # EMA smoothing factor

        # Asymmetric recovery debt
        self.recovery_debt: float = 0.0    # integral of (0.7 - reliability) during failures
        self.recovery_coeff: float = 0.10  # current effective recovery rate

        # Contradiction detector
        self._anomaly_buffer = []           # rolling (status, score) tuples
        self._anomaly_buffer_size = 60      # 2 s at 30 Hz
        self.contradiction_detected = False
        self.contradiction_count = 0

        # Tracking
        self._session_start = time.time()
        self._tick_count: int = 0

    @staticmethod
    def _clamp(x: float) -> float:
        return max(0.0, min(1.0, x))

    def _update_policy(self) -> str:
        """Derive policy state from reliability and trust velocity.

        VISION_DECLINING fires when reliability is still high but trust_velocity
        is sufficiently negative — an early warning before VISION_DEGRADED.
        """
        if self.reliability >= 0.7 and self.trust_velocity < -0.15:
            new_state = 'VISION_DECLINING'
        elif self.reliability >= 0.7:
            new_state = 'VISION_ALLOWED'
        elif self.reliability >= 0.3:
            new_state = 'VISION_DEGRADED'
        else:
            new_state = 'VISION_BLOCKED'

        changed = new_state != self.policy_state
        self.policy_state = new_state
        return new_state

    def _update_contradiction_detector(self, vision_status: str, anomaly_score) -> None:
        """Flag when ML anomaly score is a strong outlier vs the rule-based status.

        Uses a rolling 60-sample buffer (≈2 s at 30 Hz) to build a per-status
        distribution, then z-scores the current reading. A z-score > 3.0 while
        VISION_OK means the ML is calling an anomaly the rules ignored.
        """
        import statistics as _stats

        if anomaly_score is None:
            self.contradiction_detected = False
            return

        # Maintain rolling buffer
        self._anomaly_buffer.append((vision_status, anomaly_score))
        if len(self._anomaly_buffer) > self._anomaly_buffer_size:
            self._anomaly_buffer.pop(0)

        # Need at least 30 samples to establish a baseline
        if len(self._anomaly_buffer) < 30:
            self.contradiction_detected = False
            return

        scores_for_status = [
            s for st, s in self._anomaly_buffer if st == vision_status
        ]
        if len(scores_for_status) < 10:
            self.contradiction_detected = False
            return

        mean_score = _stats.mean(scores_for_status)
        try:
            std_score = _stats.stdev(scores_for_status)
        except _stats.StatisticsError:
            std_score = 0.001
        std_score = max(std_score, 0.001)  # floor — avoid division by zero

        z_score = (anomaly_score - mean_score) / std_score

        # Contradiction: rules say OK but ML anomaly score is a strong outlier
        if vision_status == 'VISION_OK' and z_score > 3.0:
            if not self.contradiction_detected:
                self.contradiction_count += 1
            self.contradiction_detected = True
        else:
            self.contradiction_detected = False

    def update(self, vision_status: str, anomaly_score: float | None, dt: float) -> dict:
        """Update trust state. Mirrors vision_supervisor.py on_status().

        Args:
            vision_status: One of VISION_OK, VISION_FROZEN, VISION_BLANK, VISION_CORRUPTED
            anomaly_score: Continuous ML anomaly score (or None if unavailable)
            dt: Time delta in seconds since last update

        Returns:
            Full state snapshot dict.
        """
        now = time.time()
        self._tick_count += 1

        # First call initialization (mirrors lines 137-143)
        if self.current_status is None:
            self.current_status = vision_status
            self.status_start_time = now
            self.last_update_time = now
            self._update_policy()
            return self.get_state()

        # Status change: reset timing (mirrors lines 145-152)
        if vision_status != self.current_status:
            prev = self.current_status
            self.current_status = vision_status
            self.status_start_time = now
            self.last_update_time = now
            # Only reset integral when entering a failure state from VISION_OK
            if vision_status != 'VISION_OK' and prev == 'VISION_OK':
                self.anomaly_integral = 0.0
            self._update_policy()
            return self.get_state()

        self.last_update_time = now

        # ── Trust dynamics (mirrors lines 160-183) ──
        ml_penalty = 0.0
        ml_active = False

        if vision_status == 'VISION_OK':
            # Drain recovery debt passively
            self.recovery_debt = max(
                0.0, self.recovery_debt - self.RECOVERY_DEBT_DRAIN * dt
            )

            # Scale recovery rate by accumulated debt (slows after severe failures)
            self.recovery_coeff = max(
                self.RECOVERY_MIN_COEFF,
                0.10 - self.RECOVERY_DEBT_GAIN * self.recovery_debt
            )
            self.reliability += self.recovery_coeff * dt

            # ML-influenced decay (ONLY when rules say OK)
            if anomaly_score is not None:
                ml_active = True
                self.anomaly_integral += anomaly_score * dt
                self.anomaly_integral -= self.ANOMALY_LEAK * self.anomaly_integral * dt
                self.anomaly_integral = max(0.0, self.anomaly_integral)

                ml_penalty = self.ANOMALY_DECAY_GAIN * self.anomaly_integral
                self.reliability -= ml_penalty * dt

        elif vision_status == 'VISION_FROZEN':
            debt_rate = max(0.0, 0.7 - self.reliability)
            self.recovery_debt = min(
                self.RECOVERY_DEBT_MAX, self.recovery_debt + debt_rate * dt
            )
            self.reliability -= 0.30 * dt
            self.anomaly_integral = 0.0

        elif vision_status == 'VISION_BLANK':
            debt_rate = max(0.0, 0.7 - self.reliability)
            self.recovery_debt = min(
                self.RECOVERY_DEBT_MAX, self.recovery_debt + debt_rate * dt
            )
            self.reliability -= 0.60 * dt
            self.anomaly_integral = 0.0

        elif vision_status == 'VISION_CORRUPTED':
            debt_rate = max(0.0, 0.7 - self.reliability)
            self.recovery_debt = min(
                self.RECOVERY_DEBT_MAX, self.recovery_debt + debt_rate * dt
            )
            self.reliability -= 1.00 * dt
            self.anomaly_integral = 0.0

        # Clamp
        self.reliability = self._clamp(self.reliability)

        # Trust velocity — EMA-smoothed derivative of reliability
        raw_velocity = (self.reliability - self._prev_reliability) / max(dt, 0.001)
        self.trust_velocity = (
            self._velocity_ema_alpha * raw_velocity
            + (1 - self._velocity_ema_alpha) * self.trust_velocity
        )
        self._prev_reliability = self.reliability

        # Contradiction detector
        self._update_contradiction_detector(vision_status, anomaly_score)

        # Policy update
        self._update_policy()

        return self.get_state()

    def get_state(self) -> dict:
        """Return current state snapshot without mutation."""
        return {
            'timestamp': time.time(),
            'reliability': round(self.reliability, 6),
            'policy_state': self.policy_state,
            'vision_status': self.current_status or 'UNKNOWN',
            'anomaly_score': 0.0,
            'anomaly_integral': round(self.anomaly_integral, 6),
            'trust_velocity': round(self.trust_velocity, 6),
            'recovery_debt': round(self.recovery_debt, 4),
            'recovery_coeff': round(self.recovery_coeff, 4),
            'contradiction_detected': self.contradiction_detected,
            'contradiction_count': self.contradiction_count,
            'ml_influence_active': self.current_status == 'VISION_OK',
            'decay_coefficient': self.DECAY_RATES.get(self.current_status or 'VISION_OK', 0),
            'recovery_coefficient': round(self.recovery_coeff, 4),
            'tick_count': self._tick_count,
        }
