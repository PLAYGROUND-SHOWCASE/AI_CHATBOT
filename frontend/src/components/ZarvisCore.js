/**
 * ZARVIS Core — Canvas-based animated AI visualization
 * Responds to state changes with unique animations
 */

export class ZarvisCore {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';
    this.animFrame = null;
    this.particles = [];
    this.t = 0;
    this.amplitude = 0;
    this._initParticles();
  }

  _initParticles() {
    for (let i = 0; i < 60; i++) {
      this.particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: 60 + Math.random() * 70,
        speed: (0.003 + Math.random() * 0.01) * (Math.random() > 0.5 ? 1 : -1),
        size: 1 + Math.random() * 2.5,
        opacity: 0.2 + Math.random() * 0.6,
        pulseOffset: Math.random() * Math.PI * 2,
      });
    }
  }

  setState(state) {
    this.state = state;
  }

  start() {
    this._loop();
  }

  stop() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }

  _loop() {
    this.animFrame = requestAnimationFrame(() => this._loop());
    this.t += 0.016;
    this._draw();
  }

  _draw() {
    const { canvas, ctx, t, state } = this;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(canvas.offsetWidth, canvas.offsetHeight) || 300;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;

    ctx.clearRect(0, 0, size, size);

    // State-specific colors
    const colors = {
      idle:       { primary: '#00d4ff', secondary: '#0066ff', glow: 'rgba(0,212,255,0.3)' },
      listening:  { primary: '#00ff88', secondary: '#00d4ff', glow: 'rgba(0,255,136,0.4)' },
      processing: { primary: '#0066ff', secondary: '#7b2fff', glow: 'rgba(0,102,255,0.4)' },
      thinking:   { primary: '#7b2fff', secondary: '#0066ff', glow: 'rgba(123,47,255,0.4)' },
      speaking:   { primary: '#00d4ff', secondary: '#ffffff', glow: 'rgba(0,212,255,0.5)' },
      executing:  { primary: '#ff6b35', secondary: '#ff3b5c', glow: 'rgba(255,107,53,0.4)' },
      error:      { primary: '#ff3b5c', secondary: '#ff6b35', glow: 'rgba(255,59,92,0.5)' },
    };

    const c = colors[state] || colors.idle;

    // Speed modifier per state
    const speeds = { idle: 1, listening: 3, processing: 2, thinking: 1.5, speaking: 2.5, executing: 3, error: 0.5 };
    const speed = speeds[state] || 1;

    // ── Outer glow ──────────────────────────────────
    const pulse = Math.sin(t * speed * 2) * 0.5 + 0.5;
    const glowGrad = ctx.createRadialGradient(cx, cy, size * 0.25, cx, cy, size * 0.55);
    glowGrad.addColorStop(0, c.glow.replace(')', `, ${0.15 + pulse * 0.1})`).replace('rgba(', 'rgba('));
    glowGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, size, size);

    // ── Orbiting particles ───────────────────────────
    this.particles.forEach((p, i) => {
      p.angle += p.speed * speed;
      const px = cx + Math.cos(p.angle) * p.radius;
      const py = cy + Math.sin(p.angle) * p.radius;
      const pPulse = Math.sin(t * 2 + p.pulseOffset) * 0.5 + 0.5;

      ctx.beginPath();
      ctx.arc(px, py, p.size * (1 + pPulse * 0.5), 0, Math.PI * 2);

      const grad = ctx.createRadialGradient(px, py, 0, px, py, p.size * 2);
      grad.addColorStop(0, c.primary);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.globalAlpha = p.opacity * (0.5 + pPulse * 0.5);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // ── Neural network lines (thinking) ─────────────
    if (state === 'thinking' || state === 'processing') {
      ctx.save();
      ctx.globalAlpha = 0.15;
      for (let i = 0; i < this.particles.length; i += 3) {
        for (let j = i + 3; j < this.particles.length; j += 5) {
          const pa = this.particles[i];
          const pb = this.particles[j];
          const pax = cx + Math.cos(pa.angle) * pa.radius;
          const pay = cy + Math.sin(pa.angle) * pa.radius;
          const pbx = cx + Math.cos(pb.angle) * pb.radius;
          const pby = cy + Math.sin(pb.angle) * pb.radius;
          const dist = Math.hypot(pbx - pax, pby - pay);
          if (dist < 80) {
            ctx.beginPath();
            ctx.moveTo(pax, pay);
            ctx.lineTo(pbx, pby);
            ctx.strokeStyle = c.primary;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    // ── Central core ────────────────────────────────
    const coreR = size * 0.2;

    // Core gradient
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    coreGrad.addColorStop(0, `${c.primary}44`);
    coreGrad.addColorStop(0.5, `${c.secondary}22`);
    coreGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    // Core ring
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.strokeStyle = c.primary;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ── Listening waveform ring ──────────────────────
    if (state === 'listening' || state === 'speaking') {
      const segments = 64;
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const wave = state === 'listening'
          ? Math.sin(a * 8 + t * 12) * (6 + Math.random() * 4)
          : Math.sin(a * 6 + t * 8) * 8;
        const r = coreR + 12 + wave;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = c.primary;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ── Data streams (processing / executing) ────────
    if (state === 'processing' || state === 'executing') {
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + t * 2;
        const len = 40 + Math.sin(t * 3 + i) * 15;
        const x1 = cx + Math.cos(angle) * coreR;
        const y1 = cy + Math.sin(angle) * coreR;
        const x2 = cx + Math.cos(angle) * (coreR + len);
        const y2 = cy + Math.sin(angle) * (coreR + len);

        const streamGrad = ctx.createLinearGradient(x1, y1, x2, y2);
        streamGrad.addColorStop(0, c.primary);
        streamGrad.addColorStop(1, 'transparent');

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = streamGrad;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // ── Error pulse ──────────────────────────────────
    if (state === 'error') {
      const errPulse = Math.abs(Math.sin(t * 8));
      ctx.beginPath();
      ctx.arc(cx, cy, coreR + 15 * errPulse, 0, Math.PI * 2);
      ctx.strokeStyle = c.primary;
      ctx.lineWidth = 2;
      ctx.globalAlpha = errPulse * 0.7;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
