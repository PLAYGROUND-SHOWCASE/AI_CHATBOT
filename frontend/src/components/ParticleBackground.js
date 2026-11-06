/**
 * Animated particle background for ambient ambiance
 */
export class ParticleBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.animFrame = null;
    this._init();
  }

  _init() {
    const count = Math.floor((window.innerWidth * window.innerHeight) / 18000);
    for (let i = 0; i < Math.min(count, 80); i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: 0.5 + Math.random() * 1.5,
        opacity: 0.05 + Math.random() * 0.25,
        color: Math.random() > 0.7 ? '#7b2fff' : Math.random() > 0.4 ? '#0066ff' : '#00d4ff',
      });
    }
  }

  start() {
    this._loop();
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _loop() {
    this.animFrame = requestAnimationFrame(() => this._loop());
    const { canvas, ctx } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    this.particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.opacity;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Draw connections between nearby particles
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const dx = this.particles[i].x - this.particles[j].x;
        const dy = this.particles[i].y - this.particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(this.particles[i].x, this.particles[i].y);
          ctx.lineTo(this.particles[j].x, this.particles[j].y);
          ctx.strokeStyle = '#00d4ff';
          ctx.lineWidth = 0.3;
          ctx.globalAlpha = (1 - dist / 120) * 0.08;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  stop() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }
}
