/**
 * ML Playground — video analysis and simulated trust evolution.
 */

let pgReliabilityChart, pgAnomalyChart;
let pgWs = null;
let simulationData = [];

document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    connectPlaygroundWs();
    setupDragDrop();
});

function initCharts() {
    pgReliabilityChart = new Chart(
        document.getElementById('pgReliabilityChart').getContext('2d'),
        {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Reliability',
                    data: [],
                    borderColor: '#00f0ff',
                    backgroundColor: 'rgba(0, 240, 255, 0.08)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                plugins: {
                    legend: { display: false },
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Time (s)', color: 'rgba(232,232,240,0.3)', font: { size: 10 } },
                        ticks: { color: 'rgba(232,232,240,0.25)', font: { size: 9 }, maxTicksLimit: 8 },
                        grid: { color: 'rgba(255,255,255,0.03)' },
                    },
                    y: {
                        min: 0, max: 1.05,
                        ticks: { color: 'rgba(0,240,255,0.5)', font: { size: 9, family: "'JetBrains Mono', monospace" } },
                        grid: { color: 'rgba(255,255,255,0.03)' },
                    },
                },
            },
        }
    );

    pgAnomalyChart = new Chart(
        document.getElementById('pgAnomalyChart').getContext('2d'),
        {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Anomaly',
                    data: [],
                    borderColor: '#ff00aa',
                    backgroundColor: 'rgba(255,0,170,0.08)',
                    borderWidth: 1.5,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                plugins: {
                    legend: { display: false },
                },
                scales: {
                    x: {
                        ticks: { color: 'rgba(232,232,240,0.25)', font: { size: 9 }, maxTicksLimit: 8 },
                        grid: { color: 'rgba(255,255,255,0.03)' },
                    },
                    y: {
                        suggestedMin: 0, suggestedMax: 0.04,
                        ticks: { color: 'rgba(255,0,170,0.5)', font: { size: 9, family: "'JetBrains Mono', monospace" } },
                        grid: { color: 'rgba(255,255,255,0.03)' },
                    },
                },
            },
        }
    );
}

function connectPlaygroundWs() {
    const url = `ws://${location.host}/ws/playground`;
    pgWs = new TrustWebSocket(url, onPlaygroundMessage, (connected) => {
        const dot = document.getElementById('pgWsDot');
        const text = document.getElementById('pgWsText');
        if (connected) {
            dot.classList.remove('disconnected');
            text.textContent = 'Connected';
            text.style.color = 'var(--green)';
        } else {
            dot.classList.add('disconnected');
            text.textContent = 'Disconnected';
            text.style.color = 'var(--text-tertiary)';
        }
    });
}

function onPlaygroundMessage(msg) {
    if (msg.type === 'sequence_result') {
        simulationData = msg.data;
        renderResults(simulationData);
    }
}

function renderResults(data) {
    if (!data || data.length === 0) return;

    // Update charts
    const labels = data.map(d => d.sim_time.toFixed(1));
    const reliabilities = data.map(d => d.reliability);
    const anomalies = data.map(d => d.anomaly_score);

    pgReliabilityChart.data.labels = labels;
    pgReliabilityChart.data.datasets[0].data = reliabilities;
    pgReliabilityChart.update();

    pgAnomalyChart.data.labels = labels;
    pgAnomalyChart.data.datasets[0].data = anomalies;
    pgAnomalyChart.update();

    // Summary metrics
    const lastState = data[data.length - 1];
    document.getElementById('pgTotalFrames').textContent = data.length;
    document.getElementById('pgFinalReliability').textContent = lastState.reliability.toFixed(3);
    document.getElementById('pgMinReliability').textContent = Math.min(...reliabilities).toFixed(3);
    document.getElementById('pgMeanAnomaly').textContent = (anomalies.reduce((a, b) => a + b, 0) / anomalies.length).toFixed(6);

    // Policy changes
    let policyChanges = 0;
    let blockedFrames = 0;
    let lastPolicy = null;
    data.forEach(d => {
        if (d.policy_state !== lastPolicy) { policyChanges++; lastPolicy = d.policy_state; }
        if (d.policy_state === 'VISION_BLOCKED') blockedFrames++;
    });
    document.getElementById('pgPolicyChanges').textContent = policyChanges;
    document.getElementById('pgTimeBlocked').textContent = (blockedFrames / 30).toFixed(1) + 's';

    // Animate frame comparison
    animateFrameComparison(data);
}

let frameAnimId = null;
function animateFrameComparison(data) {
    if (frameAnimId) cancelAnimationFrame(frameAnimId);

    const rawCanvas = document.getElementById('rawFrameCanvas');
    const reconCanvas = document.getElementById('reconFrameCanvas');
    const rawCtx = rawCanvas.getContext('2d');
    const reconCtx = reconCanvas.getContext('2d');
    let idx = 0;

    function drawFrame() {
        if (idx >= data.length) { idx = 0; } // loop

        const d = data[idx];
        const w = rawCanvas.width;
        const h = rawCanvas.height;

        // Raw frame — simulate based on vision status
        const rawImg = rawCtx.createImageData(w, h);
        const reconImg = reconCtx.createImageData(w, h);

        const noise = d.anomaly_score * 50;
        const isOk = d.vision_status === 'VISION_OK';
        const isFrozen = d.vision_status === 'VISION_FROZEN';
        const isBlank = d.vision_status === 'VISION_BLANK';
        const isCorrupt = d.vision_status === 'VISION_CORRUPTED';

        for (let i = 0; i < rawImg.data.length; i += 4) {
            const px = (i / 4) % w;
            const py = Math.floor((i / 4) / w);

            let r, g, b;
            if (isBlank) {
                r = g = b = 2;
            } else if (isCorrupt) {
                r = Math.random() * 255;
                g = Math.random() * 50;
                b = Math.random() * 180;
            } else if (isFrozen) {
                const base = Math.sin(px * 0.05) * 40 + Math.cos(py * 0.06) * 30 + 90;
                r = base * 0.7; g = base * 0.9; b = base;
            } else {
                const base = Math.sin(px * 0.03 + idx * 0.05) * 35 + Math.cos(py * 0.04 + idx * 0.03) * 25 + 85;
                const n = (Math.random() - 0.5) * noise * 5;
                r = Math.max(0, Math.min(255, (base + n) * 0.7));
                g = Math.max(0, Math.min(255, (base + n) * 0.9));
                b = Math.max(0, Math.min(255, base + n));
            }

            rawImg.data[i] = r;
            rawImg.data[i + 1] = g;
            rawImg.data[i + 2] = b;
            rawImg.data[i + 3] = 255;

            // Reconstructed: smoothed version (blur proxy)
            const smoothFactor = 0.85;
            reconImg.data[i] = r * smoothFactor + (255 - r) * 0.02;
            reconImg.data[i + 1] = g * smoothFactor + (255 - g) * 0.02;
            reconImg.data[i + 2] = b * smoothFactor + (255 - b) * 0.02;
            reconImg.data[i + 3] = 255;
        }

        rawCtx.putImageData(rawImg, 0, 0);
        reconCtx.putImageData(reconImg, 0, 0);

        document.getElementById('currentFrameNum').textContent = idx;
        document.getElementById('pgAnomalyScore').textContent = d.anomaly_score.toFixed(6);

        idx++;
        frameAnimId = setTimeout(() => requestAnimationFrame(drawFrame), 50);
    }

    drawFrame();
}

// ── Preset sequences ──
function buildSequence(name) {
    const sequences = {
        normal_stable: [
            { status: 'VISION_OK', noise: 0, brightness: 0.5, frames: 150 },
        ],
        gradual_decay: [
            { status: 'VISION_OK', noise: 0, brightness: 0.5, frames: 60 },
            { status: 'VISION_OK', noise: 0.3, brightness: 0.5, frames: 60 },
            { status: 'VISION_OK', noise: 0.6, brightness: 0.5, frames: 60 },
            { status: 'VISION_OK', noise: 0.9, brightness: 0.5, frames: 60 },
            { status: 'VISION_CORRUPTED', noise: 0, brightness: 0.5, frames: 60 },
        ],
        freeze_recovery: [
            { status: 'VISION_OK', noise: 0, brightness: 0.5, frames: 60 },
            { status: 'VISION_FROZEN', noise: 0, brightness: 0.5, frames: 90 },
            { status: 'VISION_OK', noise: 0, brightness: 0.5, frames: 150 },
        ],
        full_cycle: [
            { status: 'VISION_OK', noise: 0, brightness: 0.5, frames: 60 },
            { status: 'VISION_FROZEN', noise: 0, brightness: 0.5, frames: 60 },
            { status: 'VISION_OK', noise: 0, brightness: 0.5, frames: 60 },
            { status: 'VISION_BLANK', noise: 0, brightness: 0, frames: 60 },
            { status: 'VISION_OK', noise: 0, brightness: 0.5, frames: 60 },
            { status: 'VISION_CORRUPTED', noise: 0, brightness: 0.5, frames: 60 },
            { status: 'VISION_OK', noise: 0, brightness: 0.5, frames: 120 },
        ],
    };

    const events = sequences[name];
    if (!events) return;

    // Reset server
    if (pgWs) {
        pgWs.send({ action: 'reset' });
        setTimeout(() => {
            pgWs.send({ action: 'simulate_sequence', events: events });
        }, 200);
    }
}

// ── Video upload (client-side frame extraction) ──
function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const video = document.getElementById('videoPlayer');
    video.src = URL.createObjectURL(file);
    video.style.display = 'block';

    video.onloadeddata = () => {
        // Extract frames and build a sequence based on video properties
        const duration = video.duration;
        const fps = 30;
        const totalFrames = Math.min(Math.floor(duration * fps), 300);

        // For now, simulate with a normal sequence matching video length
        const events = [
            { status: 'VISION_OK', noise: 0.1, brightness: 0.5, frames: totalFrames },
        ];

        if (pgWs) {
            pgWs.send({ action: 'reset' });
            setTimeout(() => {
                pgWs.send({ action: 'simulate_sequence', events: events });
            }, 200);
        }
    };
}

// ── Drag & drop ──
function setupDragDrop() {
    const zone = document.getElementById('uploadZone');
    if (!zone) return;

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('video/')) {
            const input = document.getElementById('videoInput');
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            handleVideoUpload({ target: input });
        }
    });
}
