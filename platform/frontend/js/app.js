/**
 * Main simulator application — connects all components.
 */

// ── Smooth scroll to simulator ──
function scrollToSimulator() {
    const simulator = document.getElementById('simulator');
    if (simulator) {
        simulator.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ── Globals ──
let gauge, chart, wsClient;
let currentMode = 'normal';
let visionCanvas, visionCtx;
let frameCounter = 0;
let currentBrightness = 0.5;

// ── Robot World state ──
const robotCanvas = null; // set in DOMContentLoaded
let robotCtx = null;
let robotVelocity = 2.5;
let robotDisplayVel = 2.5;
let treePositions = [100, 220, 340, 460];
let robotWheelAngle = 0;
let robotRocking = 0;

const POLICY_VELOCITY = {
    'VISION_ALLOWED': 2.5,
    'VISION_DECLINING': 1.2,
    'VISION_DEGRADED': 0.5,
    'VISION_BLOCKED': 0.0,
};

// ── Robot World enhanced state ──
const rwState = {
    paused: false,          // play/pause
    gridOn: false,          // perspective grid overlay
    fpsCounter: 0,
    fpsTime: performance.now(),
    fpsDisplay: 0,
    // particles (dust motes)
    particles: [],
    particlesEnabled: (window.devicePixelRatio || 1) >= 1.25,
};

// init particles
(function initParticles() {
    for (let i = 0; i < 28; i++) {
        rwState.particles.push({
            x: Math.random() * 400,
            y: Math.random() * 220,
            r: 0.8 + Math.random() * 1.6,
            vx: 0.15 + Math.random() * 0.3,
            vy: (Math.random() - 0.5) * 0.12,
            alpha: 0.06 + Math.random() * 0.14,
        });
    }
})();

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
    // Vision canvas
    visionCanvas = document.getElementById('visionCanvas');
    visionCtx = visionCanvas.getContext('2d');

    // Robot canvas
    const rc = document.getElementById('robotCanvas');
    if (rc) {
        robotCtx = rc.getContext('2d');
    }

    // Gauge
    gauge = new ReliabilityGauge('reliabilityGauge');

    // Chart
    chart = new TrustChart('timeSeriesChart');

    // WebSocket
    const wsUrl = `ws://${location.host}/ws`;
    wsClient = new TrustWebSocket(wsUrl, onStateUpdate, onConnectionChange);

    // Start vision canvas animation
    renderVisionFrame();
});

// ── WebSocket handlers ──
function onConnectionChange(connected) {
    const dot = document.getElementById('wsStatusDot');
    const text = document.getElementById('wsStatusText');
    if (connected) {
        dot.classList.remove('disconnected');
        text.textContent = 'Connected';
        text.style.color = 'var(--green)';
    } else {
        dot.classList.add('disconnected');
        text.textContent = 'Disconnected';
        text.style.color = 'var(--text-tertiary)';
    }
}

function onStateUpdate(state) {
    if (state.type === 'log_data') {
        // Download trust reliability CSV
        downloadCSV(state.csv, `trust_session_${Date.now()}.csv`);
        // Download failure attribution CSV if present
        if (state.failure_csv && state.failure_csv.trim()) {
            downloadCSV(state.failure_csv, `failure_attribution_${Date.now()}.csv`);
        }
        return;
    }

    // Update gauge
    gauge.setValue(state.reliability);

    // Update chart (throttle to every 3rd tick for performance)
    if (state.tick_count % 3 === 0) {
        chart.addPoint(state.timestamp, state.reliability, state.anomaly_score || 0);
    }

    // Update metrics
    updateMetrics(state);

    // Update vision badge
    updateVisionBadge(state.vision_status);

    // Update failure attribution panel
    if (state.failure_events) {
        updateFailurePanel(state.failure_events);
    }

    // Update robot world
    const brightness = parseFloat(document.getElementById('brightnessSlider').value) / 100;
    updateRobotState(state.policy_state, brightness);

    // Update vision canvas border
    const vc = document.getElementById('visionCanvas');
    vc.className = '';
    if (state.policy_state === 'VISION_ALLOWED') vc.classList.add('border-allowed');
    else if (state.policy_state === 'VISION_DECLINING') vc.classList.add('border-declining');
    else if (state.policy_state === 'VISION_DEGRADED') vc.classList.add('border-degraded');
    else vc.classList.add('border-blocked');
}

function updateMetrics(s) {
    document.getElementById('metricReliability').textContent = s.reliability.toFixed(3);
    document.getElementById('metricAnomaly').textContent = (s.anomaly_score || 0).toFixed(6);
    document.getElementById('metricIntegral').textContent = s.anomaly_integral.toFixed(6);
    document.getElementById('metricDecay').textContent = s.decay_coefficient.toFixed(2);
    document.getElementById('metricRecovery').textContent = s.recovery_coefficient.toFixed(2);
    document.getElementById('metricTick').textContent = s.tick_count;

    // Vision state
    const visionEl = document.getElementById('metricVision');
    const shortStatus = (s.vision_status || 'UNKNOWN').replace('VISION_', '');
    visionEl.textContent = shortStatus;
    visionEl.className = 'metric-value';
    if (shortStatus === 'OK') visionEl.classList.add('green');
    else if (shortStatus === 'FROZEN') visionEl.classList.add('amber');
    else if (shortStatus === 'BLANK') visionEl.classList.add('red');
    else if (shortStatus === 'CORRUPTED') visionEl.classList.add('magenta');

    // ML influence
    const mlEl = document.getElementById('metricML');
    if (s.ml_influence_active) {
        mlEl.className = 'ml-indicator active';
        mlEl.textContent = '● ACTIVE';
    } else {
        mlEl.className = 'ml-indicator inactive';
        mlEl.textContent = '○ DISABLED';
    }

    // Reliability color
    const relEl = document.getElementById('metricReliability');
    relEl.className = 'metric-value';
    if (s.reliability >= 0.7) relEl.classList.add('cyan');
    else if (s.reliability >= 0.3) relEl.classList.add('amber');
    else relEl.classList.add('red');

    // Policy badge
    const badge = document.getElementById('policyBadge');
    const policy = s.policy_state || '';
    if (policy.includes('DECLINING')) {
        badge.className = 'policy-badge declining';
        badge.textContent = '↓ DECLINING';
    } else if (policy.includes('ALLOWED')) {
        badge.className = 'policy-badge allowed';
        badge.textContent = '● ALLOWED';
    } else if (policy.includes('DEGRADED')) {
        badge.className = 'policy-badge degraded';
        badge.textContent = '● DEGRADED';
    } else {
        badge.className = 'policy-badge blocked';
        badge.textContent = '● BLOCKED';
    }

    // Trust velocity
    const vel = s.trust_velocity || 0;
    const velEl = document.getElementById('metricVelocity');
    if (velEl) {
        velEl.textContent = (vel >= 0 ? '+' : '') + vel.toFixed(3);
        velEl.className = 'metric-value ' + (vel > 0.01 ? 'cyan' : vel < -0.01 ? 'red' : '');
    }

    // Recovery debt
    const debtEl = document.getElementById('metricDebt');
    if (debtEl) {
        debtEl.textContent = (s.recovery_debt || 0).toFixed(3);
    }

    // Conflict
    const conflictCountEl = document.getElementById('metricConflictCount');
    if (conflictCountEl) {
        conflictCountEl.textContent = s.contradiction_count || 0;
    }
    const chip = document.getElementById('metricConflictIndicator');
    if (chip) {
        if (s.contradiction_detected) {
            chip.className = 'conflict-chip conflict';
            chip.textContent = '⚡ CONFLICT';
        } else {
            chip.className = 'conflict-chip consensus';
            chip.textContent = '✓ OK';
        }
    }

    // Robot speed
    const speedEl = document.getElementById('metricRobotSpeed');
    if (speedEl) {
        const speedPct = Math.round((POLICY_VELOCITY[s.policy_state] ?? 0) / 2.5 * 100);
        speedEl.textContent = speedPct + '%';
    }
}

function updateVisionBadge(status) {
    const badge = document.getElementById('visionBadge');
    badge.textContent = status || 'UNKNOWN';
    badge.className = 'vision-status-badge';
    if (status === 'VISION_OK') badge.classList.add('ok');
    else if (status === 'VISION_FROZEN') badge.classList.add('frozen');
    else if (status === 'VISION_BLANK') badge.classList.add('blank');
    else if (status === 'VISION_CORRUPTED') badge.classList.add('corrupted');
}

// ── Robot World Renderer ──
function updateRobotState(policyState, brightness) {
    const target = POLICY_VELOCITY[policyState] ?? 0;

    // Trigger stop-rock animation
    if (target === 0 && robotDisplayVel > 0.2) {
        robotRocking = 8;
    }

    robotVelocity = target;

    // Update HUD
    const hud = document.getElementById('robotStatusHUD');
    if (!hud) return;
    if (policyState === 'VISION_BLOCKED') {
        hud.style.color = '#ff3355';
        hud.textContent = '■ STOPPED';
    } else if (policyState === 'VISION_DECLINING') {
        hud.style.color = '#ffaa00';
        hud.textContent = '▲ SLOWING';
    } else if (policyState === 'VISION_DEGRADED') {
        hud.style.color = '#ff6600';
        hud.textContent = '◆ CRAWLING';
    } else {
        hud.style.color = '#00ff88';
        hud.textContent = '● MOVING';
    }
}

// ── Shared Environment Renderer ──
function drawEnvironment(ctx, w, h, brightness, isVision) {
    const groundY = h * 0.64;

    // ── Sky gradient (atmospheric depth) ──
    const skyBri = Math.floor(brightness * 38);
    const skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    skyGrad.addColorStop(0, `rgb(${skyBri + 5},  ${skyBri + 14}, ${skyBri + 32})`);
    skyGrad.addColorStop(0.6, `rgb(${skyBri + 10}, ${skyBri + 22}, ${skyBri + 42})`);
    skyGrad.addColorStop(1, `rgb(${skyBri + 18}, ${skyBri + 30}, ${skyBri + 48})`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, groundY);

    // Horizon haze
    const hazeGrad = ctx.createLinearGradient(0, groundY - 28, 0, groundY + 8);
    hazeGrad.addColorStop(0, 'rgba(180,220,255,0.00)');
    hazeGrad.addColorStop(1, `rgba(${skyBri + 20},${skyBri + 40},${skyBri + 60},${brightness * 0.18 + 0.04})`);
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, groundY - 28, w, 36);

    // ── Ground gradient ──
    const gBri = Math.floor(brightness * 32);
    const groundGrad = ctx.createLinearGradient(0, groundY, 0, h);
    groundGrad.addColorStop(0, `rgb(${gBri + 16}, ${gBri + 26}, ${gBri + 14})`);
    groundGrad.addColorStop(0.5, `rgb(${gBri + 10}, ${gBri + 18}, ${gBri + 9})`);
    groundGrad.addColorStop(1, `rgb(${gBri + 6},  ${gBri + 12}, ${gBri + 5})`);
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, groundY, w, h - groundY);

    // Ground texture lines (subtle)
    ctx.strokeStyle = `rgba(255,255,255,${brightness * 0.06 + 0.015})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
        const y = groundY + (h - groundY) * (i + 1) / 5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Ground horizon line
    ctx.strokeStyle = `rgba(255,255,255,${brightness * 0.12 + 0.03})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(w, groundY); ctx.stroke();

    // ── Perspective grid overlay ──
    if (rwState.gridOn && !isVision) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 0.5;
        const vp = { x: w / 2, y: groundY };
        // vertical lines converging to vanishing point
        for (let i = -5; i <= 5; i++) {
            ctx.beginPath();
            ctx.moveTo(vp.x, vp.y);
            ctx.lineTo(vp.x + i * 40, h);
            ctx.stroke();
        }
        // horizontal lines
        for (let j = 1; j <= 5; j++) {
            const y = groundY + (h - groundY) * (j / 5);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
        ctx.restore();
    }

    // ── Dust particles ──
    if (rwState.particlesEnabled) {
        rwState.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.alpha * brightness;
            ctx.fillStyle = '#c8e8ff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }

    // ── Trees ──
    treePositions.forEach(x => {
        const treeH = 60 + Math.sin(x * 0.27) * 14;
        const alpha = Math.min(1, brightness * 1.5 + 0.1);
        // Trunk
        ctx.fillStyle = `rgba(72,48,28,${alpha})`;
        ctx.beginPath();
        ctx.roundRect(x - 5, groundY - treeH * 0.42, 10, treeH * 0.42, 2);
        ctx.fill();
        // Canopy layers (depth)
        const gCol = Math.floor(brightness * 85 + 38);
        ctx.beginPath();
        ctx.arc(x, groundY - treeH * 0.42 - 8, 26, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(20,${gCol},20,${alpha * 0.7})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x - 4, groundY - treeH * 0.42 - 2, 22, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(28,${gCol + 10},28,${alpha})`;
        ctx.fill();
    });
}

function drawRobotWorld(brightness) {
    if (!robotCtx) return;
    const rc = document.getElementById('robotCanvas');
    if (!rc) return;

    // Physics is already updated by renderVisionFrame; just draw.
    const w = rc.width;
    const h = rc.height;
    const groundY = h * 0.64;

    drawEnvironment(robotCtx, w, h, brightness, false);

    // ── Robot (2× larger) ──
    const robotX = 100;
    const robotY = groundY - 22;
    const t = Date.now() * 0.002;

    // Idle bob when moving
    const bobY = robotDisplayVel > 0.2 ? Math.sin(t * 4) * 1.5 : 0;

    // Sudden stop rock
    const rockOffset = robotRocking > 0 ? Math.sin(robotRocking * 1.3) * 3 : 0;
    if (robotRocking > 0) robotRocking -= 0.8;

    robotCtx.save();
    robotCtx.translate(robotX, robotY + bobY + rockOffset);

    // Shadow
    robotCtx.fillStyle = 'rgba(0,0,0,0.25)';
    robotCtx.beginPath();
    robotCtx.ellipse(0, 26, 28, 5, 0, 0, Math.PI * 2);
    robotCtx.fill();

    // Body (larger: 50w x 36h)
    const blocked = robotVelocity === 0;
    const bodyCol = blocked ? 'rgba(255,51,85,0.82)' : 'rgba(0,200,255,0.88)';
    robotCtx.fillStyle = bodyCol;
    robotCtx.beginPath();
    robotCtx.roundRect(-25, -18, 50, 36, 6);
    robotCtx.fill();

    // Body highlight
    const hlGrad = robotCtx.createLinearGradient(-25, -18, -25, 0);
    hlGrad.addColorStop(0, 'rgba(255,255,255,0.18)');
    hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
    robotCtx.fillStyle = hlGrad;
    robotCtx.beginPath();
    robotCtx.roundRect(-25, -18, 50, 18, [6, 6, 0, 0]);
    robotCtx.fill();

    // Antenna
    robotCtx.strokeStyle = blocked ? 'rgba(255,100,100,0.7)' : 'rgba(0,240,255,0.7)';
    robotCtx.lineWidth = 2;
    robotCtx.beginPath(); robotCtx.moveTo(8, -18); robotCtx.lineTo(8, -28); robotCtx.stroke();
    robotCtx.fillStyle = blocked ? '#ff6060' : '#00f0ff';
    robotCtx.beginPath(); robotCtx.arc(8, -30, 3, 0, Math.PI * 2); robotCtx.fill();

    // Camera eye
    robotCtx.fillStyle = '#ffffff';
    robotCtx.beginPath(); robotCtx.arc(14, -6, 7, 0, Math.PI * 2); robotCtx.fill();
    robotCtx.fillStyle = '#001a2e';
    robotCtx.beginPath(); robotCtx.arc(14 + (blocked ? 0 : 1), -6, 3.5, 0, Math.PI * 2); robotCtx.fill();
    // Pupil glint
    robotCtx.fillStyle = 'rgba(255,255,255,0.7)';
    robotCtx.beginPath(); robotCtx.arc(16, -8, 1.3, 0, Math.PI * 2); robotCtx.fill();

    // Chest panel LEDs
    const ledColors = blocked ? ['#ff3355', '#ff6600'] : ['#00ff88', '#00f0ff'];
    [-10, -4].forEach((lx, i) => {
        robotCtx.fillStyle = ledColors[i];
        robotCtx.beginPath(); robotCtx.arc(lx, 4, 2.5, 0, Math.PI * 2); robotCtx.fill();
    });

    // Wheels (bigger radius: 11px)
    robotWheelAngle += robotDisplayVel * 0.18;
    [-15, 15].forEach(wx => {
        robotCtx.save();
        robotCtx.translate(wx, 18);
        // Wheel shadow
        robotCtx.fillStyle = 'rgba(0,0,0,0.3)';
        robotCtx.beginPath(); robotCtx.ellipse(1, 2, 11, 4, 0, 0, Math.PI * 2); robotCtx.fill();
        // Wheel body
        robotCtx.rotate(robotWheelAngle);
        robotCtx.fillStyle = '#2a2a3a';
        robotCtx.beginPath(); robotCtx.arc(0, 0, 11, 0, Math.PI * 2); robotCtx.fill();
        // Tread ring
        robotCtx.strokeStyle = '#1a1a28';
        robotCtx.lineWidth = 3;
        robotCtx.beginPath(); robotCtx.arc(0, 0, 9, 0, Math.PI * 2); robotCtx.stroke();
        // Spokes
        const spokeCol = blocked ? 'rgba(255,80,80,0.7)' : 'rgba(0,200,255,0.75)';
        robotCtx.strokeStyle = spokeCol;
        robotCtx.lineWidth = 2;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
            robotCtx.beginPath();
            robotCtx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
            robotCtx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
            robotCtx.stroke();
        }
        // Hub
        robotCtx.fillStyle = blocked ? '#ff3355' : '#00f0ff';
        robotCtx.beginPath(); robotCtx.arc(0, 0, 3, 0, Math.PI * 2); robotCtx.fill();
        robotCtx.restore();
    });

    robotCtx.restore();

    // Vision-blocked red X + shaded box
    if (blocked) {
        robotCtx.fillStyle = 'rgba(255,51,85,0.12)';
        robotCtx.fillRect(62, groundY - 60, 76, 55);
        robotCtx.strokeStyle = 'rgba(255,51,85,0.65)';
        robotCtx.lineWidth = 2.5;
        const [x1, y1, x2, y2] = [66, groundY - 56, 134, groundY - 10];
        robotCtx.beginPath();
        robotCtx.moveTo(x1, y1); robotCtx.lineTo(x2, y2);
        robotCtx.moveTo(x2, y1); robotCtx.lineTo(x1, y2);
        robotCtx.stroke();
    }

    // ── FPS HUD (top-right) ──
    robotCtx.save();
    robotCtx.font = '9px "JetBrains Mono", monospace';
    robotCtx.fillStyle = 'rgba(0,240,255,0.5)';
    robotCtx.textAlign = 'right';
    robotCtx.fillText(`${rwState.fpsDisplay} FPS`, w - 6, 14);
    robotCtx.fillText(`v=${robotDisplayVel.toFixed(1)}`, w - 6, 24);
    robotCtx.textAlign = 'start';
    robotCtx.restore();
}

// ── Vision canvas rendering ──
function renderVisionFrame() {
    frameCounter++;

    const w = visionCanvas.width;
    const h = visionCanvas.height;

    // Ensure physics update happens exactly once per frame
    if (!rwState.paused) {
        rwState.fpsCounter++;
        const now = performance.now();
        if (now - rwState.fpsTime >= 1000) {
            rwState.fpsDisplay = rwState.fpsCounter;
            rwState.fpsCounter = 0;
            rwState.fpsTime = now;
        }

        robotDisplayVel += (robotVelocity - robotDisplayVel) * 0.08;

        if (rwState.particlesEnabled) {
            rwState.particles.forEach(p => {
                p.x += p.vx * (0.5 + robotDisplayVel * 0.5);
                p.y += p.vy;
                if (p.x > w + 4) p.x = -4;
                if (p.y < 0) p.y = h;
                if (p.y > h) p.y = 0;
            });
        }

        treePositions = treePositions.map(x => {
            let nx = x - robotDisplayVel;
            if (nx < -35) nx = w + 65 + Math.random() * 100;
            return nx;
        });
    }

    // Update global brightness for robot world
    currentBrightness = parseFloat(document.getElementById('brightnessSlider').value) / 100;

    if (currentMode === 'normal') {
        const noise = parseFloat(document.getElementById('noiseSlider').value) / 100;

        // 1. Draw exactly what the robot sees into the vision context!
        drawEnvironment(visionCtx, w, h, currentBrightness, true);

        // 2. ONLY apply noise over top of it if noise > 0
        if (noise > 0) {
            const imgData = visionCtx.getImageData(0, 0, w, h);
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                const n = (Math.random() - 0.5) * 255 * noise;
                data[i] = Math.max(0, Math.min(255, data[i] + n));
                data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
                data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
            }
            visionCtx.putImageData(imgData, 0, 0);
        }

        // Overlay text
        visionCtx.fillStyle = 'rgba(0, 240, 255, 0.4)';
        visionCtx.font = '10px "JetBrains Mono", monospace';
        visionCtx.fillText(`FRAME ${frameCounter}`, 8, 16);
        visionCtx.fillText(`NOISE: ${noise.toFixed(2)}  BRI: ${currentBrightness.toFixed(2)}`, 8, 28);

    } else if (currentMode === 'frozen') {
        // Don't update — freeze the last frame
        visionCtx.fillStyle = 'rgba(255, 170, 0, 0.15)';
        visionCtx.fillRect(0, 0, w, h);
        visionCtx.fillStyle = '#ffaa00';
        visionCtx.font = 'bold 16px "Inter", sans-serif';
        visionCtx.textAlign = 'center';
        visionCtx.fillText('⏸ FRAME FROZEN', w / 2, h / 2);
        visionCtx.font = '11px "JetBrains Mono", monospace';
        visionCtx.fillText(`Frozen at frame ${frameCounter}`, w / 2, h / 2 + 22);
        visionCtx.textAlign = 'start';

    } else if (currentMode === 'blank') {
        visionCtx.fillStyle = '#020204';
        visionCtx.fillRect(0, 0, w, h);
        visionCtx.fillStyle = 'rgba(255, 51, 85, 0.6)';
        visionCtx.font = 'bold 16px "Inter", sans-serif';
        visionCtx.textAlign = 'center';
        visionCtx.fillText('◻ BLANK FRAME', w / 2, h / 2);
        visionCtx.font = '11px "JetBrains Mono", monospace';
        visionCtx.fillText('Mean intensity < 5', w / 2, h / 2 + 22);
        visionCtx.textAlign = 'start';

        // Corrupted: glitch effect applied over the real environment
        drawEnvironment(visionCtx, w, h, currentBrightness, true);

        const imgData = visionCtx.getImageData(0, 0, w, h);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            if (Math.random() > 0.8) {
                data[i] = Math.random() * 255;
                data[i + 1] = 0;
                data[i + 2] = Math.random() * 255;
            }
        }
        visionCtx.putImageData(imgData, 0, 0);

        // Glitch bars
        for (let i = 0; i < 6; i++) {
            const y = Math.random() * h;
            const barH = 2 + Math.random() * 12;
            visionCtx.fillStyle = `rgba(255, 0, 170, ${0.4 + Math.random() * 0.5})`;
            visionCtx.fillRect(0, y, w, barH);
        }

        visionCtx.fillStyle = '#ff00aa';
        visionCtx.font = 'bold 14px "Inter", sans-serif';
        visionCtx.textAlign = 'center';
        visionCtx.fillText('⚠ CORRUPTED', w / 2, h / 2);
        visionCtx.textAlign = 'start';
    }

    // Draw robot world each frame
    drawRobotWorld(currentBrightness);

    requestAnimationFrame(renderVisionFrame);
}

// ── Control handlers ──
function setMode(mode, btn) {
    currentMode = mode;
    // Update button states
    document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.remove('active');
    });
    btn.classList.add('active');

    // Send to server
    if (wsClient) {
        wsClient.send({ action: 'set_vision', mode: mode });
    }
}

function setNoise(val) {
    const level = val / 100;
    document.getElementById('noiseValue').textContent = level.toFixed(2);
    if (wsClient) {
        wsClient.send({ action: 'set_noise', level: level });
    }
}

function setBrightness(val) {
    const level = val / 100;
    document.getElementById('brightnessValue').textContent = level.toFixed(2);
    currentBrightness = level;
    if (wsClient) {
        wsClient.send({ action: 'set_brightness', level: level });
    }
}

function resetSimulation() {
    currentMode = 'normal';
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.mode-btn[data-mode="normal"]').classList.add('active');
    document.getElementById('noiseSlider').value = 0;
    document.getElementById('brightnessSlider').value = 50;
    document.getElementById('noiseValue').textContent = '0.00';
    document.getElementById('brightnessValue').textContent = '0.50';
    currentBrightness = 0.5;

    if (chart) chart.reset();
    if (wsClient) wsClient.send({ action: 'reset' });
}

function downloadLog() {
    if (wsClient) {
        wsClient.send({ action: 'get_log' });
    }
}

function downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `trust_session_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Update the failure attribution summary panel.
 * @param {Object} fe - failure_events summary from backend
 */
function updateFailurePanel(fe) {
    const panel = document.getElementById('failureSummaryPanel');
    if (!panel) return;

    if (!fe || fe.total_excursions === 0) {
        panel.textContent = 'No trust excursions recorded.';
        panel.className = 'failure-summary-panel none';
        return;
    }

    // Build "By cause" string: "FROZEN×2 BLANK×1"
    const causeParts = Object.entries(fe.by_cause)
        .sort((a, b) => b[1] - a[1])
        .map(([cause, count]) => `${cause}\u00d7${count}`);

    panel.className = 'failure-summary-panel active';
    panel.innerHTML =
        `<span class="fa-label">Excursions:</span> <span class="fa-count">${fe.total_excursions}</span>` +
        (causeParts.length
            ? ` &nbsp;|&nbsp; <span class="fa-label">By cause:</span> <span class="fa-causes">${causeParts.join(' ')}</span>`
            : '') +
        (fe.mean_recovery_s !== undefined
            ? ` &nbsp;|&nbsp; <span class="fa-label">Avg recovery:</span> <span class="fa-recovery">${fe.mean_recovery_s}s</span>`
            : '') +
        (fe.worst_reliability !== undefined
            ? ` &nbsp;|&nbsp; <span class="fa-label">Worst:</span> <span class="fa-worst">${fe.worst_reliability}</span>`
            : '');
}

function setChartView(view, btn) {
    document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (chart) chart.setView(view);
}

// ── Preset scenarios ──
function runScenario(name) {
    resetSimulation();

    const scenarios = {
        normal: () => {
            setMode('normal', document.querySelector('.mode-btn[data-mode="normal"]'));
        },
        freeze: () => {
            setTimeout(() => {
                setMode('frozen', document.querySelector('.mode-btn[data-mode="frozen"]'));
            }, 100);
        },
        degrade: () => {
            // Gradual noise increase
            let noise = 0;
            const interval = setInterval(() => {
                noise += 5;
                if (noise > 100) {
                    clearInterval(interval);
                    setMode('corrupted', document.querySelector('.mode-btn[data-mode="corrupted"]'));
                    return;
                }
                document.getElementById('noiseSlider').value = noise;
                setNoise(noise);
            }, 500);
        },
        recovery: () => {
            // Start corrupted, then recover
            setMode('corrupted', document.querySelector('.mode-btn[data-mode="corrupted"]'));
            setTimeout(() => {
                setMode('normal', document.querySelector('.mode-btn[data-mode="normal"]'));
            }, 3000);
        },
        ml_stress: () => {
            // High anomaly with normal vision
            document.getElementById('noiseSlider').value = 80;
            setNoise(80);
        },
    };

    if (scenarios[name]) {
        setTimeout(scenarios[name], 200);
    }
}
