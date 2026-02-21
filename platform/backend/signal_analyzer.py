"""
Real-time signal analyzer — computes anomaly scores from actual video frames.

Replaces the slider-driven AnomalySimulator with genuine image quality metrics:
  - Laplacian variance  → blur / defocus detection
  - Mean brightness     → darkness or overexposure
  - Frame difference    → freeze detection
  - Pixel entropy       → corruption / noise detection

Each metric is normalized to [0, 1] and fused into a single anomaly_score float
that plugs directly into TrustEngine.update() with zero changes needed.
"""

import numpy as np
import cv2


class SignalAnalyzer:
    """Analyzes video frames and produces real anomaly scores."""

    # ── Fusion weights (sum to 1.0) ──
    W_BLUR = 0.35
    W_BRIGHTNESS = 0.25
    W_FREEZE = 0.15       # reduced — freeze is easy to false-positive
    W_ENTROPY = 0.25

    # ── Thresholds for vision status derivation ──
    FREEZE_DIFF_THRESHOLD = 1.0   # mean frame diff below this = truly frozen
    FREEZE_CONSEC_NEEDED = 5      # need N consecutive frozen frames to declare FROZEN
    BLANK_BRIGHTNESS_LO = 15      # mean pixel below this → BLANK
    BLANK_BRIGHTNESS_HI = 245     # mean pixel above this → BLANK (overexposed)
    CORRUPT_ENTROPY_LO = 2.0      # entropy below this → suspicious
    CORRUPT_ENTROPY_HI = 7.5      # entropy above this → noisy/corrupted
    BLUR_BASELINE = 500.0         # Laplacian variance for a sharp frame

    def __init__(self):
        self._prev_gray: np.ndarray | None = None
        self._frame_count: int = 0
        self._consecutive_frozen: int = 0

    def reset(self):
        """Clear internal state (previous frame buffer)."""
        self._prev_gray = None
        self._frame_count = 0
        self._consecutive_frozen = 0

    def analyze_frame(self, frame: np.ndarray) -> dict:
        """Analyze a single BGR video frame.

        Args:
            frame: BGR image as numpy array (H, W, 3)

        Returns:
            dict with keys:
                anomaly_score:  float [0, 1] — fused anomaly score
                vision_status:  str — derived status string
                metrics: dict with individual scores
        """
        self._frame_count += 1

        # Convert to grayscale once
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # ── 1. Blur detection (Laplacian variance) ──
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        # Lower variance = blurrier. Normalize: sharp frames ≈ 500+, blurry ≈ <50
        blur_score = max(0.0, min(1.0, 1.0 - laplacian_var / self.BLUR_BASELINE))

        # ── 2. Brightness deviation ──
        mean_brightness = float(np.mean(gray))
        # Deviation from midpoint (128). Both very dark and very bright are anomalous.
        brightness_deviation = abs(mean_brightness - 128.0) / 128.0
        brightness_score = max(0.0, min(1.0, brightness_deviation))

        # ── 3. Freeze detection (frame difference) ──
        if self._prev_gray is not None:
            diff = cv2.absdiff(self._prev_gray, gray)
            mean_diff = float(np.mean(diff))

            # Only consider truly frozen if diff is extremely low
            if mean_diff < self.FREEZE_DIFF_THRESHOLD:
                self._consecutive_frozen += 1
            else:
                self._consecutive_frozen = 0

            # Freeze score: ramp up only when truly frozen for multiple frames
            if self._consecutive_frozen >= self.FREEZE_CONSEC_NEEDED:
                freeze_score = 1.0
            elif self._consecutive_frozen > 0:
                freeze_score = 0.3 * (self._consecutive_frozen / self.FREEZE_CONSEC_NEEDED)
            else:
                freeze_score = 0.0
        else:
            # First frame — can't compute diff, assume not frozen
            freeze_score = 0.0
            mean_diff = 10.0  # placeholder

        self._prev_gray = gray.copy()

        # ── 4. Pixel entropy ──
        histogram = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten()
        histogram = histogram / (histogram.sum() + 1e-10)  # normalize to probabilities
        # Remove zeros for log calculation
        histogram = histogram[histogram > 0]
        entropy = float(-np.sum(histogram * np.log2(histogram)))
        # Normal images: entropy ≈ 5-7. Very low or very high = anomalous.
        if entropy < 4.0:
            entropy_score = max(0.0, min(1.0, (4.0 - entropy) / 4.0))
        elif entropy > 7.0:
            entropy_score = max(0.0, min(1.0, (entropy - 7.0) / 1.5))
        else:
            entropy_score = 0.0  # healthy range

        # ── Fused anomaly score ──
        anomaly_score = (
            self.W_BLUR * blur_score
            + self.W_BRIGHTNESS * brightness_score
            + self.W_FREEZE * freeze_score
            + self.W_ENTROPY * entropy_score
        )
        anomaly_score = max(0.0, min(1.0, anomaly_score))

        # ── Derive vision status from metrics ──
        vision_status = self._derive_status(
            mean_brightness, mean_diff, entropy
        )

        return {
            'anomaly_score': round(anomaly_score, 6),
            'vision_status': vision_status,
            'metrics': {
                'blur': round(blur_score, 4),
                'brightness': round(brightness_score, 4),
                'freeze': round(freeze_score, 4),
                'entropy': round(entropy_score, 4),
                'raw': {
                    'laplacian_var': round(laplacian_var, 2),
                    'mean_brightness': round(mean_brightness, 1),
                    'frame_diff': round(mean_diff, 2),
                    'entropy': round(entropy, 3),
                }
            }
        }

    def _derive_status(
        self,
        mean_brightness: float,
        mean_diff: float,
        entropy: float,
    ) -> str:
        """Derive vision status string from raw metrics.

        Priority order (most severe first):
          1. BLANK  — brightness collapse (very dark or very bright)
          2. FROZEN — zero frame difference for multiple consecutive frames
          3. CORRUPTED — extreme entropy anomaly
          4. OK — everything within normal range
        """
        # Blank: extreme brightness collapse
        if mean_brightness < self.BLANK_BRIGHTNESS_LO or mean_brightness > self.BLANK_BRIGHTNESS_HI:
            return 'VISION_BLANK'

        # Frozen: need N consecutive frozen frames to avoid false positives
        if self._consecutive_frozen >= self.FREEZE_CONSEC_NEEDED:
            return 'VISION_FROZEN'

        # Corrupted: extreme entropy (very low = uniform, very high = noise)
        if entropy < self.CORRUPT_ENTROPY_LO or entropy > self.CORRUPT_ENTROPY_HI:
            return 'VISION_CORRUPTED'

        return 'VISION_OK'
