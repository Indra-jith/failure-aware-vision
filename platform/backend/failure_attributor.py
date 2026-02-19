"""
Failure Attributor — tracks trust excursions and attributes them to causes.

An "excursion" is any contiguous period where reliability < 0.7.
Each completed excursion is stored with its duration, minimum reliability,
and the dominant cause (highest-priority status seen during the excursion).
"""

import csv
import io


class FailureAttributor:
    # Higher number = higher priority (dominates cause attribution)
    CAUSE_PRIORITY = {
        'CORRUPTED':  4,
        'BLANK':      3,
        'FROZEN':     2,
        'ML_ANOMALY': 1,
        'NONE':       0,
    }

    def __init__(self):
        self.reset()

    def reset(self):
        self._events = []               # completed excursion event dicts
        self._in_excursion = False      # currently below 0.7?
        self._excursion_start = None
        self._excursion_min = 1.0
        self._excursion_cause = None
        self._excursion_entry_time = None
        self._recovery_start = None

    # ── Per-tick update ──

    def update(self, state: dict, timestamp: float):
        """Call every tick with the trust engine state snapshot."""
        reliability    = state['reliability']
        vision_status  = state['vision_status']
        ml_active      = state['ml_influence_active']

        # Determine primary cause of this tick's degradation
        if vision_status == 'VISION_FROZEN':
            cause = 'FROZEN'
        elif vision_status == 'VISION_BLANK':
            cause = 'BLANK'
        elif vision_status == 'VISION_CORRUPTED':
            cause = 'CORRUPTED'
        elif ml_active and state.get('anomaly_integral', 0) > 0.5:
            cause = 'ML_ANOMALY'
        else:
            cause = 'NONE'

        if reliability < 0.7 and not self._in_excursion:
            # Excursion starts
            self._in_excursion = True
            self._excursion_start = timestamp
            self._excursion_min = reliability
            self._excursion_cause = cause

        elif reliability < 0.7 and self._in_excursion:
            # Track minimum and dominant cause
            self._excursion_min = min(self._excursion_min, reliability)
            if (self.CAUSE_PRIORITY.get(cause, 0)
                    > self.CAUSE_PRIORITY.get(self._excursion_cause, 0)):
                self._excursion_cause = cause

        elif reliability >= 0.7 and self._in_excursion:
            # Excursion ends — record it
            duration      = timestamp - self._excursion_start
            recovery_time = timestamp - self._excursion_start

            event = {
                'start_time':      round(self._excursion_start, 3),
                'duration_s':      round(duration, 3),
                'min_reliability': round(self._excursion_min, 4),
                'cause':           self._excursion_cause,
                'recovery_time_s': round(recovery_time, 3),
            }
            self._events.append(event)

            # Reset tracking state
            self._in_excursion = False
            self._excursion_min = 1.0

    # ── Accessors ──

    def get_events(self) -> list:
        """Return a copy of all completed excursion events."""
        return list(self._events)

    def get_summary(self) -> dict:
        """Return a compact summary suitable for streaming to the frontend."""
        if not self._events:
            return {'total_excursions': 0}

        causes = [e['cause'] for e in self._events]
        return {
            'total_excursions': len(self._events),
            'by_cause': {c: causes.count(c) for c in set(causes)},
            'mean_recovery_s': round(
                sum(e['recovery_time_s'] for e in self._events) / len(self._events), 3
            ),
            'worst_reliability': round(
                min(e['min_reliability'] for e in self._events), 4
            ),
        }

    def get_events_csv(self) -> str:
        """Return all excursion events as a CSV string."""
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(['start_time', 'duration_s', 'min_reliability',
                    'cause', 'recovery_time_s'])
        for e in self._events:
            w.writerow([
                e['start_time'], e['duration_s'],
                e['min_reliability'], e['cause'], e['recovery_time_s'],
            ])
        return buf.getvalue()
