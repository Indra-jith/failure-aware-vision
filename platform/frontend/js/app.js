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

// ── Source mode state (simulation | webcam | video) ──
let currentSourceMode = 'simulation';
let liveVideoImage = null;       // Image element for live video frames
let liveVideoReady = false;      // true when a new frame is available to draw
let lastSignalMetrics = null;    // {blur, brightness, freeze, entropy, raw} from backend
let uploadedVideoPath = null;    // server-side path for uploaded video

// ── Robot World state ──
const robotCanvas = null; // set in DOMContentLoaded
let robotCtx = null;
let robotVelocity = 2.5;
let robotDisplayVel = 2.5;
let treePositions = [
    { x: 100, side: -1, seed: 0.3 },
    { x: 220, side: 1, seed: 0.7 },
    { x: 340, side: -1, seed: 0.5 },
    { x: 460, side: 1, seed: 0.9 }
];
let robotWheelAngle = 0;
let robotRocking = 0;
let fpvGroundScroll = 0; // scrolling ground offset for first-person view

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

    // WebSocket — auto-detect ws:// (local) vs wss:// (production HTTPS)
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
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

    // Handle mode change acknowledgment
    if (state.type === 'mode_changed') {
        currentSourceMode = state.source_mode;
        return;
    }

    // Handle error messages
    if (state.type === 'error') {
        console.warn('Server error:', state.message);
        return;
    }

    // ── Live video frame handling ──
    if (state.video_frame) {
        if (!liveVideoImage) {
            liveVideoImage = new Image();
            liveVideoImage.onload = () => { liveVideoReady = true; };
        }
        liveVideoImage.src = 'data:image/jpeg;base64,' + state.video_frame;
    }
    if (state.signal_metrics) {
        lastSignalMetrics = state.signal_metrics;
    }

    // Update source mode from server state
    if (state.source_mode) {
        currentSourceMode = state.source_mode;
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
    treePositions.forEach(tree => {
        const x = tree.x;
        const treeH = 60 + Math.sin(tree.seed * 17) * 14;
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

// ── First-Person POV Renderer (robot's onboard camera) ──
function drawFirstPersonPOV(ctx, w, h, brightness) {
    const horizonY = h * 0.42; // horizon near mid-frame (~42%)
    const vpX = w / 2;         // vanishing point center
    const speed = robotDisplayVel;

    // ── Sky ──
    const skyBri = Math.floor(brightness * 38);
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, `rgb(${skyBri + 4}, ${skyBri + 12}, ${skyBri + 30})`);
    skyGrad.addColorStop(0.5, `rgb(${skyBri + 8}, ${skyBri + 20}, ${skyBri + 40})`);
    skyGrad.addColorStop(1, `rgb(${skyBri + 16}, ${skyBri + 30}, ${skyBri + 52})`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY);

    // Horizon atmospheric haze
    const hazeGrad = ctx.createLinearGradient(0, horizonY - 20, 0, horizonY + 12);
    hazeGrad.addColorStop(0, 'rgba(160,200,240,0.00)');
    hazeGrad.addColorStop(1, `rgba(${skyBri + 25},${skyBri + 45},${skyBri + 65},${brightness * 0.22 + 0.05})`);
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, horizonY - 20, w, 32);

    // ── Ground (perspective road surface) ──
    const gBri = Math.floor(brightness * 32);
    const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    groundGrad.addColorStop(0, `rgb(${gBri + 18}, ${gBri + 28}, ${gBri + 16})`);
    groundGrad.addColorStop(0.4, `rgb(${gBri + 12}, ${gBri + 20}, ${gBri + 10})`);
    groundGrad.addColorStop(1, `rgb(${gBri + 8}, ${gBri + 14}, ${gBri + 7})`);
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // ── Road / path (centered darker strip converging to vanishing point) ──
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(vpX - 3, horizonY);            // narrow at horizon
    ctx.lineTo(vpX + 3, horizonY);
    ctx.lineTo(w * 0.7, h);                    // wide at bottom
    ctx.lineTo(w * 0.3, h);
    ctx.closePath();
    const roadGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    roadGrad.addColorStop(0, `rgba(${gBri + 6},${gBri + 10},${gBri + 5},0.6)`);
    roadGrad.addColorStop(1, `rgba(${gBri + 4},${gBri + 8},${gBri + 3},0.9)`);
    ctx.fillStyle = roadGrad;
    ctx.fill();
    ctx.restore();

    // ── Road center dashes (scrolling forward motion) ──
    fpvGroundScroll = (fpvGroundScroll + speed * 3) % 40;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${brightness * 0.18 + 0.04})`;
    ctx.lineWidth = 1.5;
    const dashCount = 12;
    for (let i = 0; i < dashCount; i++) {
        const t = (i / dashCount + fpvGroundScroll / 40 / dashCount) % 1;
        // perspective: t=0 is horizon, t=1 is bottom
        const pY = horizonY + (h - horizonY) * t * t; // quadratic for depth
        const dashLen = 2 + t * 14;
        const alpha = t * 0.7;
        ctx.globalAlpha = alpha * brightness;
        ctx.beginPath();
        ctx.moveTo(vpX, pY);
        ctx.lineTo(vpX, pY + dashLen);
        ctx.stroke();
    }
    ctx.restore();

    // ── Road edge lines ──
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${brightness * 0.08 + 0.02})`;
    ctx.lineWidth = 1;
    // Left edge
    ctx.beginPath();
    ctx.moveTo(vpX - 3, horizonY);
    ctx.lineTo(w * 0.3, h);
    ctx.stroke();
    // Right edge
    ctx.beginPath();
    ctx.moveTo(vpX + 3, horizonY);
    ctx.lineTo(w * 0.7, h);
    ctx.stroke();
    ctx.restore();

    // ── Ground texture (horizontal depth lines) ──
    ctx.strokeStyle = `rgba(255,255,255,${brightness * 0.04 + 0.01})`;
    ctx.lineWidth = 0.5;
    for (let i = 1; i <= 6; i++) {
        const t = i / 7;
        const y = horizonY + (h - horizonY) * t * t;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Horizon line
    ctx.strokeStyle = `rgba(255,255,255,${brightness * 0.1 + 0.02})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, horizonY); ctx.lineTo(w, horizonY); ctx.stroke();

    // ── Trees (perspective-projected, both sides) ──
    const alpha = Math.min(1, brightness * 1.5 + 0.1);
    const gCol = Math.floor(brightness * 85 + 38);

    treePositions.forEach(tree => {
        const worldX = tree.x;
        const dist = worldX - 80;
        if (dist < 5 || dist > 520) return; // behind or too far

        // depth factor: 0 = far (horizon), 1 = close (bottom)
        const depthT = Math.max(0, Math.min(1, 1 - dist / 500));
        const pY = horizonY + (h - horizonY) * depthT * depthT;
        const scale = 0.15 + depthT * 0.85;

        // Use the tree's stable side assignment
        const side = tree.side;
        const lateralBase = 60 + depthT * (w * 0.38);
        const pX = vpX + side * lateralBase;

        // smooth fade at edges (fade in when dist 5..60, fade out when dist 440..520)
        let edgeFade = 1;
        if (dist < 60) edgeFade = (dist - 5) / 55;
        if (dist > 440) edgeFade = (520 - dist) / 80;
        edgeFade = Math.max(0, Math.min(1, edgeFade));

        const treeH = (50 + Math.sin(tree.seed * 17) * 12) * scale;
        const trunkW = Math.max(2, 6 * scale);
        const canopyR = Math.max(4, 20 * scale);
        const treeAlpha = alpha * (0.3 + depthT * 0.7) * edgeFade;

        // Trunk
        ctx.fillStyle = `rgba(72,48,28,${treeAlpha})`;
        ctx.beginPath();
        ctx.roundRect(pX - trunkW / 2, pY - treeH * 0.5, trunkW, treeH * 0.5, 1);
        ctx.fill();

        // Canopy
        ctx.beginPath();
        ctx.arc(pX, pY - treeH * 0.5 - canopyR * 0.4, canopyR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(20,${gCol},20,${treeAlpha * 0.7})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pX - canopyR * 0.15, pY - treeH * 0.5 - canopyR * 0.2, canopyR * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(28,${gCol + 10},28,${treeAlpha})`;
        ctx.fill();
    });

    // ── Dust / particles (POV version) ──
    if (rwState.particlesEnabled) {
        rwState.particles.forEach(p => {
            const t = p.y / h;
            ctx.save();
            ctx.globalAlpha = p.alpha * brightness * (0.3 + t * 0.7);
            ctx.fillStyle = '#c8e8ff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * (0.5 + t), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }

    // ── Subtle motion blur overlay when moving fast ──
    if (speed > 1.0) {
        const blurAlpha = Math.min(0.08, (speed - 1.0) * 0.025);
        const blurGrad = ctx.createLinearGradient(0, h * 0.7, 0, h);
        blurGrad.addColorStop(0, `rgba(180,200,220,0)`);
        blurGrad.addColorStop(1, `rgba(180,200,220,${blurAlpha})`);
        ctx.fillStyle = blurGrad;
        ctx.fillRect(0, h * 0.7, w, h * 0.3);
    }

    // ── Subtle vignette (camera lens effect) ──
    ctx.save();
    const vigGrad = ctx.createRadialGradient(vpX, h * 0.5, w * 0.25, vpX, h * 0.5, w * 0.75);
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
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

        treePositions = treePositions.map(tree => {
            let nx = tree.x - robotDisplayVel;
            if (nx < -35) {
                return {
                    x: w + 65 + Math.random() * 100,
                    side: Math.random() < 0.5 ? -1 : 1,
                    seed: Math.random()
                };
            }
            return { ...tree, x: nx };
        });
    }

    // Update global brightness for robot world
    currentBrightness = parseFloat(document.getElementById('brightnessSlider').value) / 100;

    // ── Branch: Live mode vs Simulation mode ──
    if (currentSourceMode !== 'simulation') {
        // Live mode: render real video frame + signal overlay
        drawLiveVideoFrame();

        // Still draw robot world (it reacts to policy changes)
        drawRobotWorld(currentBrightness);
        requestAnimationFrame(renderVisionFrame);
        return;
    }

    if (currentMode === 'normal') {
        const noise = parseFloat(document.getElementById('noiseSlider').value) / 100;

        // 1. Draw first-person POV from robot's onboard camera
        drawFirstPersonPOV(visionCtx, w, h, currentBrightness);

        // 2. Apply Gaussian noise over the scene if noise > 0
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

        // Overlay HUD text
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

    } else if (currentMode === 'corrupted') {
        // Corrupted: glitch effect applied over the first-person POV
        drawFirstPersonPOV(visionCtx, w, h, currentBrightness);

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

// ── Live video frame renderer (draws real video + signal overlay) ──
let hasReceivedFirstFrame = false;

function drawLiveVideoFrame() {
    const w = visionCanvas.width;
    const h = visionCanvas.height;

    // ── No new frame? Leave the canvas COMPLETELY untouched ──
    // The previous frame + overlays stay on screen as-is.
    // This prevents overlay accumulation flicker.
    if (!liveVideoReady || !liveVideoImage || !liveVideoImage.complete) {
        if (!hasReceivedFirstFrame) {
            // Show placeholder only before the very first frame
            visionCtx.fillStyle = '#0a0a14';
            visionCtx.fillRect(0, 0, w, h);
            visionCtx.fillStyle = 'rgba(0,240,255,0.3)';
            visionCtx.font = '12px "JetBrains Mono", monospace';
            visionCtx.textAlign = 'center';
            visionCtx.fillText('Connecting to video feed...', w / 2, h / 2);
            visionCtx.textAlign = 'start';
        }
        return; // ← KEY: do nothing, leave canvas as-is
    }

    // ── New frame arrived — draw everything fresh ──
    visionCtx.drawImage(liveVideoImage, 0, 0, w, h);
    liveVideoReady = false;
    hasReceivedFirstFrame = true;

    // ── Signal metrics overlay (drawn exactly once per frame) ──
    if (lastSignalMetrics) {
        const m = lastSignalMetrics;
        const y0 = h - 58;

        // Semi-transparent background bar
        visionCtx.fillStyle = 'rgba(0,0,0,0.55)';
        visionCtx.fillRect(0, y0 - 4, w, 62);

        visionCtx.font = '9px "JetBrains Mono", monospace';
        visionCtx.fillStyle = 'rgba(0,240,255,0.7)';
        visionCtx.fillText(`BLUR: ${m.blur.toFixed(3)}`, 8, y0 + 8);
        visionCtx.fillText(`BRIGHT: ${m.brightness.toFixed(3)}`, 8, y0 + 20);
        visionCtx.fillText(`FREEZE: ${m.freeze.toFixed(3)}`, 8, y0 + 32);
        visionCtx.fillText(`ENTROPY: ${m.entropy.toFixed(3)}`, 8, y0 + 44);

        if (m.raw) {
            visionCtx.fillStyle = 'rgba(255,255,255,0.35)';
            visionCtx.fillText(`lap=${m.raw.laplacian_var}`, 120, y0 + 8);
            visionCtx.fillText(`\u03bc=${m.raw.mean_brightness}`, 120, y0 + 20);
            visionCtx.fillText(`\u0394=${m.raw.frame_diff}`, 120, y0 + 32);
            visionCtx.fillText(`H=${m.raw.entropy}`, 120, y0 + 44);
        }
    }

    // Frame counter overlay (top-left)
    visionCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    visionCtx.fillRect(0, 0, 175, 34);
    visionCtx.fillStyle = 'rgba(0, 240, 255, 0.6)';
    visionCtx.font = '10px "JetBrains Mono", monospace';
    visionCtx.fillText(`LIVE \u2022 FRAME ${frameCounter}`, 8, 14);
    visionCtx.fillText(`MODE: ${currentSourceMode.toUpperCase()}`, 8, 26);
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

// ── Source mode switching ──
function setSourceMode(mode, btn) {
    // Webcam is not available on cloud servers (no camera hardware)
    if (mode === 'webcam' && window.location.protocol === 'https:') {
        alert('Webcam is not available on the cloud server (no camera hardware).\\nPlease use "Video File" mode or run the app locally for webcam support.');
        return;
    }

    // Update button states
    document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const simControls = document.getElementById('simOnlyControls');
    const controlPanel = document.querySelector('.control-panel');

    if (mode === 'video') {
        // Trigger file picker
        document.getElementById('videoFileInput').click();
        return; // handleVideoUpload will complete the switch
    }

    if (mode === 'simulation') {
        // Show simulation-only controls
        if (simControls) simControls.style.display = '';
        currentSourceMode = 'simulation';
        liveVideoReady = false;
        hasReceivedFirstFrame = false;
        lastSignalMetrics = null;
    } else {
        // Hide simulation-only controls in live modes
        if (simControls) simControls.style.display = 'none';
        hasReceivedFirstFrame = false;
    }

    // Send to server
    if (wsClient) {
        wsClient.send({ action: 'set_source_mode', mode: mode });
    }

    // Reset chart on mode switch
    if (chart) chart.reset();
}

async function handleVideoUpload(input) {
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
        const resp = await fetch('/api/upload-video', {
            method: 'POST',
            body: formData,
        });

        if (!resp.ok) {
            console.error('Upload failed:', resp.statusText);
            return;
        }

        const result = await resp.json();
        uploadedVideoPath = result.path;

        // Hide sim controls
        const simControls = document.getElementById('simOnlyControls');
        if (simControls) simControls.style.display = 'none';

        // Tell server to start analyzing the uploaded video
        if (wsClient) {
            wsClient.send({
                action: 'set_source_mode',
                mode: 'video',
                filepath: uploadedVideoPath,
            });
        }

        if (chart) chart.reset();
        currentSourceMode = 'video';
        lastSignalMetrics = null;

    } catch (err) {
        console.error('Upload error:', err);
    }

    // Reset the input so the same file can be re-selected
    input.value = '';
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
