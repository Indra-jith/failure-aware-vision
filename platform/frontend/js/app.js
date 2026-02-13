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

// ── Initialize ──
document.addEventListener('DOMContentLoaded', () => {
    // Vision canvas
    visionCanvas = document.getElementById('visionCanvas');
    visionCtx = visionCanvas.getContext('2d');

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
        downloadCSV(state.csv);
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
    if (policy.includes('ALLOWED')) {
        badge.className = 'policy-badge allowed';
        badge.textContent = '● ALLOWED';
    } else if (policy.includes('DEGRADED')) {
        badge.className = 'policy-badge degraded';
        badge.textContent = '● DEGRADED';
    } else {
        badge.className = 'policy-badge blocked';
        badge.textContent = '● BLOCKED';
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

// ── Vision canvas rendering ──
function renderVisionFrame() {
    frameCounter++;
    const w = visionCanvas.width;
    const h = visionCanvas.height;

    if (currentMode === 'normal') {
        // Simulated camera feed — moving gradient with noise
        const noise = parseFloat(document.getElementById('noiseSlider').value) / 100;
        const brightness = parseFloat(document.getElementById('brightnessSlider').value) / 100;
        const imgData = visionCtx.createImageData(w, h);
        const data = imgData.data;
        const time = frameCounter * 0.02;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                // Base pattern: moving gradient
                const base = Math.sin(x * 0.03 + time) * 30 + Math.cos(y * 0.04 + time * 0.7) * 25 + 80;
                const b = base * brightness * 2;
                // Add noise
                const n = noise > 0 ? (Math.random() - 0.5) * 255 * noise : 0;
                const val = Math.max(0, Math.min(255, b + n));
                data[idx] = val * 0.7;     // R
                data[idx + 1] = val * 0.9; // G
                data[idx + 2] = val;       // B
                data[idx + 3] = 255;
            }
        }
        visionCtx.putImageData(imgData, 0, 0);

        // Overlay text
        visionCtx.fillStyle = 'rgba(0, 240, 255, 0.3)';
        visionCtx.font = '10px "JetBrains Mono", monospace';
        visionCtx.fillText(`FRAME ${frameCounter}`, 8, 16);
        visionCtx.fillText(`NOISE: ${noise.toFixed(2)}  BRI: ${brightness.toFixed(2)}`, 8, 28);

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
        // Corrupted: glitch effect
        const imgData = visionCtx.createImageData(w, h);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const glitch = Math.random() > 0.5;
            data[i] = glitch ? Math.random() * 255 : 0;
            data[i + 1] = glitch ? 0 : Math.random() * 100;
            data[i + 2] = Math.random() * 180;
            data[i + 3] = 255;
        }
        visionCtx.putImageData(imgData, 0, 0);

        // Glitch bars
        for (let i = 0; i < 5; i++) {
            const y = Math.random() * h;
            const barH = 2 + Math.random() * 8;
            visionCtx.fillStyle = `rgba(255, 0, 170, ${0.3 + Math.random() * 0.4})`;
            visionCtx.fillRect(0, y, w, barH);
        }

        visionCtx.fillStyle = '#ff00aa';
        visionCtx.font = 'bold 14px "Inter", sans-serif';
        visionCtx.textAlign = 'center';
        visionCtx.fillText('⚠ CORRUPTED', w / 2, h / 2);
        visionCtx.textAlign = 'start';
    }

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

    if (chart) chart.reset();
    if (wsClient) wsClient.send({ action: 'reset' });
}

function downloadLog() {
    if (wsClient) {
        wsClient.send({ action: 'get_log' });
    }
}

function downloadCSV(csvContent) {
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trust_session_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
