/**
 * Animated reliability gauge — Canvas-based arc gauge.
 */
class ReliabilityGauge {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.value = 1.0;
    this.displayValue = 1.0;
    this.animSpeed = 0.08;
    this._draw();
  }

  setValue(v) {
    this.value = Math.max(0, Math.min(1, v));
  }

  _getColor(v) {
    if (v >= 0.7) return '#00ff88';
    if (v >= 0.3) return '#ffaa00';
    return '#ff3355';
  }

  _draw() {
    // Smooth interpolation
    this.displayValue += (this.value - this.displayValue) * this.animSpeed;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2 + 10;
    const radius = 70;
    const lineWidth = 10;

    ctx.clearRect(0, 0, w, h);

    // Background arc
    const startAngle = Math.PI * 0.8;
    const endAngle = Math.PI * 2.2;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Value arc
    const valueAngle = startAngle + (endAngle - startAngle) * this.displayValue;
    const color = this._getColor(this.displayValue);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, valueAngle);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Glow effect
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, valueAngle);
    ctx.strokeStyle = color + '40';
    ctx.lineWidth = lineWidth + 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Center value text
    ctx.fillStyle = color;
    ctx.font = '700 28px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.displayValue.toFixed(3), cx, cy - 8);

    // Sub label
    ctx.fillStyle = 'rgba(232, 232, 240, 0.35)';
    ctx.font = '600 10px "Inter", sans-serif';
    ctx.letterSpacing = '0.1em';
    ctx.fillText('RELIABILITY', cx, cy + 18);

    // Threshold markers
    this._drawThreshold(ctx, cx, cy, radius, startAngle, endAngle, 0.7, '#00ff88');
    this._drawThreshold(ctx, cx, cy, radius, startAngle, endAngle, 0.3, '#ff3355');

    requestAnimationFrame(() => this._draw());
  }

  _drawThreshold(ctx, cx, cy, radius, startAngle, endAngle, threshold, color) {
    const angle = startAngle + (endAngle - startAngle) * threshold;
    const innerR = radius - 18;
    const outerR = radius + 18;

    ctx.beginPath();
    ctx.moveTo(cx + innerR * Math.cos(angle), cy + innerR * Math.sin(angle));
    ctx.lineTo(cx + outerR * Math.cos(angle), cy + outerR * Math.sin(angle));
    ctx.strokeStyle = color + '30';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label text
    const labelX = cx + (outerR + 6) * Math.cos(angle);
    const labelY = cy + (outerR + 6) * Math.sin(angle);
    ctx.fillStyle = color + '80';
    ctx.font = '500 8px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(threshold === 0.7 ? '0.7' : '0.3', labelX, labelY);
  }
}
