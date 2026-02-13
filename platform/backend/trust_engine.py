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

        # Tracking
        self._session_start = time.time()
        self._tick_count: int = 0

    @staticmethod
    def _clamp(x: float) -> float:
        return max(0.0, min(1.0, x))

    def _update_policy(self) -> str:
        """Derive policy state from reliability only.

        Mirrors vision_supervisor.py lines 101-113.
        """
        if self.reliability >= 0.7:
            new_state = 'VISION_ALLOWED'
        elif self.reliability >= 0.3:
            new_state = 'VISION_DEGRADED'
        else:
            new_state = 'VISION_BLOCKED'

        changed = new_state != self.policy_state
        self.policy_state = new_state
        return new_state

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
            self.current_status = vision_status
            self.status_start_time = now
            self.last_update_time = now
            self.anomaly_integral = 0.0
            self._update_policy()
            return self.get_state()

        self.last_update_time = now

        # ── Trust dynamics (mirrors lines 160-183) ──
        ml_penalty = 0.0
        ml_active = False

        if vision_status == 'VISION_OK':
            # Base recovery
            self.reliability += 0.10 * dt

            # ML-influenced decay (ONLY when rules say OK)
            if anomaly_score is not None:
                ml_active = True
                self.anomaly_integral += anomaly_score * dt
                self.anomaly_integral -= self.ANOMALY_LEAK * self.anomaly_integral * dt
                self.anomaly_integral = max(0.0, self.anomaly_integral)

                ml_penalty = self.ANOMALY_DECAY_GAIN * self.anomaly_integral
                self.reliability -= ml_penalty * dt

        elif vision_status == 'VISION_FROZEN':
            self.reliability -= 0.30 * dt
            self.anomaly_integral = 0.0

        elif vision_status == 'VISION_BLANK':
            self.reliability -= 0.60 * dt
            self.anomaly_integral = 0.0

        elif vision_status == 'VISION_CORRUPTED':
            self.reliability -= 1.00 * dt
            self.anomaly_integral = 0.0

        # Clamp
        self.reliability = self._clamp(self.reliability)

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
            'ml_influence_active': self.current_status == 'VISION_OK',
            'decay_coefficient': self.DECAY_RATES.get(self.current_status or 'VISION_OK', 0),
            'recovery_coefficient': 0.10,
            'tick_count': self._tick_count,
        }
