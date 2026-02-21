"""
Threaded video source manager — provides non-blocking frame capture
from webcam or video file for the async FastAPI server.

Runs cv2.VideoCapture in a daemon thread so frame grabs don't block
the asyncio event loop. Frames are resized to a standard processing
resolution (320×240) to keep CPU usage low.
"""

import threading
import time
from typing import Optional

import cv2
import numpy as np


class VideoSource:
    """Manages a video capture source in a background thread.

    Usage:
        vs = VideoSource()
        vs.start(0)           # webcam
        vs.start("path.mp4")  # video file
        frame = vs.get_frame()
        vs.stop()
    """

    PROCESS_WIDTH = 320
    PROCESS_HEIGHT = 240

    def __init__(self):
        self._cap: Optional[cv2.VideoCapture] = None
        self._frame: Optional[np.ndarray] = None
        self._frame_id: int = 0       # monotonically increasing, new value per capture
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._source = None
        self._fps: float = 30.0
        self._frame_count: int = 0
        self._is_file: bool = False
        self._new_frame_event = threading.Event()

    @property
    def is_active(self) -> bool:
        return self._running and self._cap is not None

    @property
    def fps(self) -> float:
        return self._fps

    @property
    def frame_count(self) -> int:
        return self._frame_count

    @property
    def is_file_source(self) -> bool:
        return self._is_file

    def start(self, source) -> bool:
        """Start capturing from a source.

        Args:
            source: 0 for webcam, or a file path string for video file.

        Returns:
            True if capture opened successfully.
        """
        self.stop()  # stop any existing capture

        self._source = source
        self._is_file = isinstance(source, str)
        self._cap = cv2.VideoCapture(source)

        if not self._cap.isOpened():
            self._cap = None
            return False

        # Set webcam buffer size to 1 to always get the latest frame
        if not self._is_file:
            self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        self._fps = self._cap.get(cv2.CAP_PROP_FPS) or 30.0
        self._frame_count = 0
        self._running = True
        self._new_frame_event.clear()
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        return True

    def stop(self):
        """Stop capture and release resources."""
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        with self._lock:
            self._frame = None
        self._frame_count = 0

    def get_frame(self):
        """Get the latest captured frame (non-blocking).

        Returns:
            Tuple of (frame, frame_id) where frame is a BGR numpy array
            (PROCESS_HEIGHT, PROCESS_WIDTH, 3) or None, and frame_id is
            a monotonically increasing int (0 if no frame yet).
            Callers should compare frame_id to detect duplicate frames.
        """
        with self._lock:
            if self._frame is not None:
                return self._frame.copy(), self._frame_id
            return None, 0

    def _capture_loop(self):
        """Background thread: continuously grabs frames as fast as possible.

        For webcams: cv2.read() naturally blocks until the next frame arrives,
        so no sleep is needed — the driver controls the framerate.
        For files: a small sleep paces playback at the file's native FPS.
        """
        file_delay = (1.0 / max(self._fps, 1.0)) if self._is_file else 0

        while self._running:
            if self._cap is None or not self._cap.isOpened():
                break

            ret, raw_frame = self._cap.read()

            if not ret:
                if self._is_file:
                    # End of video file — loop back to start
                    self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                else:
                    # Webcam failure
                    break

            # Resize to processing resolution
            resized = cv2.resize(
                raw_frame,
                (self.PROCESS_WIDTH, self.PROCESS_HEIGHT),
                interpolation=cv2.INTER_AREA
            )

            with self._lock:
                self._frame = resized
                self._frame_id += 1

            self._frame_count += 1
            self._new_frame_event.set()

            # For video files, pace at native FPS
            if self._is_file and file_delay > 0:
                time.sleep(file_delay)
            # For webcam: no sleep — read() already blocks until next frame

        self._running = False
