"""
Session logger — CSV logging matching vision_reliability_log.csv format.

Mirrors: vision_supervisor.py CSV writer (lines 62-78, 119-128).
"""

import csv
import io
import time


class SessionLogger:
    """In-memory CSV session logger for reproducible experiments."""

    HEADER = [
        'timestamp', 'reliability', 'policy_state',
        'anomaly', 'anomaly_integral', 'vision_status',
    ]

    def __init__(self):
        self.reset()

    def reset(self):
        self._buffer = io.StringIO()
        self._writer = csv.writer(self._buffer)
        self._writer.writerow(self.HEADER)
        self._count = 0
        self._start_time = time.time()

    def log(self, state: dict, anomaly_score: float):
        """Log a single state snapshot."""
        self._writer.writerow([
            f"{state.get('timestamp', time.time()):.6f}",
            f"{state.get('reliability', 0):.6f}",
            state.get('policy_state', ''),
            f"{anomaly_score:.6f}",
            f"{state.get('anomaly_integral', 0):.6f}",
            state.get('vision_status', ''),
        ])
        self._count += 1

    def get_csv(self) -> str:
        """Return full CSV content as string."""
        return self._buffer.getvalue()

    @property
    def entry_count(self) -> int:
        return self._count
