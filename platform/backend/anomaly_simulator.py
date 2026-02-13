"""
ML anomaly score simulator — proxy for autoencoder reconstruction error.

Mirrors: ml_phase1/run_inference.py autoencoder MSE output.
Real baseline from vision_reliability_log.csv: ~0.019 for normal frames.

No PyTorch dependency. Uses heuristic proxy functions that produce
continuous anomaly scores matching real-world distributions.
"""

import math
import random


class AnomalySimulator:
    """Simulates ML anomaly scores without requiring PyTorch inference.

    Produces continuous scores that match the real autoencoder output
    distribution observed in vision_reliability_log.csv.
    """

    # Baseline from real data (normal frames ≈ 0.019)
    BASELINE_NORMAL = 0.019
    BASELINE_JITTER = 0.0005

    def __init__(self, seed: int = None):
        self._rng = random.Random(seed)
        self._t = 0.0

    def reset(self, seed: int = None):
        self._rng = random.Random(seed)
        self._t = 0.0

    def compute_anomaly(self, noise_level: float, brightness: float,
                        vision_status: str) -> float:
        """Compute simulated anomaly score.

        Args:
            noise_level: 0.0 (clean) to 1.0 (heavy noise)
            brightness: 0.0 (dark) to 1.0 (bright)
            vision_status: Current vision status string

        Returns:
            Continuous anomaly score (float). Higher = more anomalous.
        """
        self._t += 1

        # Base reconstruction error (normal frames)
        base = self.BASELINE_NORMAL + self._rng.gauss(0, self.BASELINE_JITTER)

        # Noise contribution (Gaussian noise increases reconstruction error)
        noise_contribution = 0.015 * (noise_level ** 1.5)

        # Brightness deviation (both too dark and too bright increase error)
        brightness_deviation = abs(brightness - 0.5)
        brightness_contribution = 0.008 * (brightness_deviation ** 2)

        # Temporal drift (subtle, simulates model uncertainty over time)
        temporal_drift = 0.001 * math.sin(self._t * 0.05)

        # Failure modes produce characteristic anomaly patterns
        if vision_status == 'VISION_FROZEN':
            # Frozen frames: error drops as reconstruction converges
            return max(0.001, base * 0.5 + temporal_drift)
        elif vision_status == 'VISION_BLANK':
            # Blank frames: very low reconstruction error (blank ≈ blank)
            return max(0.001, 0.005 + self._rng.gauss(0, 0.001))
        elif vision_status == 'VISION_CORRUPTED':
            # Corrupted: high reconstruction error
            return base * 3.0 + noise_contribution + self._rng.gauss(0, 0.005)

        # VISION_OK: base + noise + brightness contributions
        score = base + noise_contribution + brightness_contribution + temporal_drift
        return max(0.001, score)
