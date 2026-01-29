# failure-aware-vision
Studying how vision models fail under real-world corruptions and using uncertainty estimation to enable safer robotic behavior.
# Operational Design Domain (ODD)

## Environment
- Indoor
- Flat ground
- Static obstacles only

## Robot
- Differential drive mobile robot
- Maximum speed: TBD (will cap later)

## Sensors
- RGB camera only (primary)
- No sensor fusion in initial phases

## Perception Task
- Single task: image classification
- Output used only for decision support, not control

## Failure Definition
- Incorrect prediction with high confidence
- Confidence threshold: not yet defined

## Safety Assumptions
- Simulation only (Gazebo)
- No humans in environment
- Fail-safe behavior available (stop / slow)
