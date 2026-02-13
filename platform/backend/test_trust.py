"""Quick trust engine verification."""
import sys
sys.path.insert(0, '/home/indra/failure-aware-vision/platform/backend')
from trust_engine import TrustEngine

e = TrustEngine()
dt = 0.033

# Test VISION_OK recovery
s = e.update('VISION_OK', 0.019, dt)
print(f'OK: r={s["reliability"]:.6f} policy={s["policy_state"]}')

# Test VISION_FROZEN decay
for i in range(50):
    s = e.update('VISION_FROZEN', 0.019, dt)
print(f'FROZEN x50: r={s["reliability"]:.6f} policy={s["policy_state"]} integral={s["anomaly_integral"]}')

# Test VISION_BLANK
for i in range(30):
    s = e.update('VISION_BLANK', None, dt)
print(f'BLANK x30: r={s["reliability"]:.6f} policy={s["policy_state"]}')

# Test clamp at 0
for i in range(100):
    s = e.update('VISION_CORRUPTED', None, dt)
print(f'CORRUPT x100: r={s["reliability"]:.6f} policy={s["policy_state"]}')

# Test recovery from 0
for i in range(200):
    s = e.update('VISION_OK', 0.019, dt)
print(f'RECOVER x200: r={s["reliability"]:.6f} policy={s["policy_state"]} ai={s["anomaly_integral"]:.6f}')

print('ALL TESTS PASSED')
