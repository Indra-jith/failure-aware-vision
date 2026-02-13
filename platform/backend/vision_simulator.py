"""
Vision state simulator — maps user controls to vision status.

Mirrors rule-based checks from image_subscriber.py (lines 73-88):
  - Frame freeze detection (diff < 1.0) → VISION_FROZEN
  - Blank frame detection (mean < 5)   → VISION_BLANK
  - Corruption detection (shape mismatch) → VISION_CORRUPTED
  - Otherwise → VISION_OK
"""


class VisionSimulator:
    """Simulates vision input states based on user controls."""

    VALID_MODES = {'normal', 'frozen', 'blank', 'corrupted'}

    def __init__(self):
        self.reset()

    def reset(self):
        self.mode: str = 'normal'
        self.noise_level: float = 0.0     # 0.0 to 1.0
        self.brightness: float = 0.5      # 0.0 to 1.0

    def set_mode(self, mode: str):
        """Set explicit failure mode."""
        if mode in self.VALID_MODES:
            self.mode = mode

    def set_noise(self, level: float):
        """Set Gaussian noise level (0-1)."""
        self.noise_level = max(0.0, min(1.0, level))

    def set_brightness(self, level: float):
        """Set brightness level (0-1)."""
        self.brightness = max(0.0, min(1.0, level))

    def get_vision_status(self) -> str:
        """Return current vision status string.

        Explicit failures always dominate over noise/brightness.
        Mirror of image_subscriber.py rule-based logic.
        """
        if self.mode == 'frozen':
            return 'VISION_FROZEN'
        elif self.mode == 'blank':
            return 'VISION_BLANK'
        elif self.mode == 'corrupted':
            return 'VISION_CORRUPTED'
        else:
            return 'VISION_OK'

    def get_frame_descriptor(self) -> dict:
        """Return a descriptor of the simulated frame for frontend rendering."""
        return {
            'mode': self.mode,
            'noise_level': self.noise_level,
            'brightness': self.brightness,
            'vision_status': self.get_vision_status(),
        }
