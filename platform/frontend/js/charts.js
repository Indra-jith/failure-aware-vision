/**
 * Time-series chart manager — Chart.js wrapper for trust visualization.
 */
class TrustChart {
    constructor(canvasId) {
        this.maxPoints = 600; // ~20 seconds at 30Hz
        this.reliabilityData = [];
        this.anomalyData = [];
        this.labels = [];
        this.policyChanges = [];
        this.startTime = null;

        const ctx = document.getElementById(canvasId).getContext('2d');

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.labels,
                datasets: [
                    {
                        label: 'Reliability',
                        data: this.reliabilityData,
                        borderColor: '#00f0ff',
                        backgroundColor: 'rgba(0, 240, 255, 0.05)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Anomaly Score',
                        data: this.anomalyData,
                        borderColor: '#ff00aa',
                        backgroundColor: 'rgba(255, 0, 170, 0.05)',
                        borderWidth: 1.5,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        yAxisID: 'y2',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: 'rgba(232, 232, 240, 0.5)',
                            font: { family: "'Inter', sans-serif", size: 11 },
                            boxWidth: 12,
                            padding: 16,
                        },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(6, 6, 13, 0.9)',
                        titleColor: '#e8e8f0',
                        bodyColor: 'rgba(232, 232, 240, 0.7)',
                        borderColor: 'rgba(255, 255, 255, 0.08)',
                        borderWidth: 1,
                        bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
                        padding: 10,
                    },
                },
                scales: {
                    x: {
                        display: true,
                        title: { display: true, text: 'Time (s)', color: 'rgba(232, 232, 240, 0.3)', font: { size: 10 } },
                        ticks: { color: 'rgba(232, 232, 240, 0.25)', font: { size: 9 }, maxTicksLimit: 10 },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    },
                    y: {
                        position: 'left',
                        min: 0,
                        max: 1.05,
                        title: { display: true, text: 'Reliability', color: '#00f0ff', font: { size: 10 } },
                        ticks: { color: 'rgba(0, 240, 255, 0.5)', font: { size: 9, family: "'JetBrains Mono', monospace" } },
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    },
                    y2: {
                        position: 'right',
                        min: 0,
                        suggestedMax: 0.05,
                        title: { display: true, text: 'Anomaly', color: '#ff00aa', font: { size: 10 } },
                        ticks: { color: 'rgba(255, 0, 170, 0.5)', font: { size: 9, family: "'JetBrains Mono', monospace" } },
                        grid: { drawOnChartArea: false },
                    },
                },
            },
        });
    }

    addPoint(timestamp, reliability, anomalyScore) {
        if (this.startTime === null) this.startTime = timestamp;
        const t = (timestamp - this.startTime).toFixed(1);

        this.labels.push(t);
        this.reliabilityData.push(reliability);
        this.anomalyData.push(anomalyScore);

        // Trim old data
        if (this.labels.length > this.maxPoints) {
            this.labels.shift();
            this.reliabilityData.shift();
            this.anomalyData.shift();
        }

        this.chart.update('none');
    }

    setView(view) {
        const ds = this.chart.data.datasets;
        if (view === 'reliability') {
            ds[0].hidden = false;
            ds[1].hidden = true;
        } else if (view === 'anomaly') {
            ds[0].hidden = true;
            ds[1].hidden = false;
        } else {
            ds[0].hidden = false;
            ds[1].hidden = false;
        }
        this.chart.update();
    }

    reset() {
        this.labels.length = 0;
        this.reliabilityData.length = 0;
        this.anomalyData.length = 0;
        this.startTime = null;
        this.chart.update();
    }
}
