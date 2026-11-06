/**
 * Audio Services — Voice Input (STT) and Voice Output (TTS)
 * Uses Web Speech API for cross-platform compatibility
 */

export class VoiceInputService {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.onTranscript = null;
    this.onError = null;
    this.onStart = null;
    this.onEnd = null;
    this._supported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }

  get isSupported() { return this._supported; }

  init() {
    if (!this._supported) return false;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStart?.();
    };

    this.recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('');
      const isFinal = event.results[event.results.length - 1].isFinal;
      this.onTranscript?.(transcript, isFinal);
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      this.onError?.(event.error);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.onEnd?.();
    };

    return true;
  }

  start(lang = 'en-US') {
    if (!this.recognition) this.init();
    if (!this.recognition) return false;
    try {
      this.recognition.lang = lang;
      this.recognition.start();
      return true;
    } catch (e) {
      console.error('STT start error:', e);
      return false;
    }
  }

  stop() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  abort() {
    if (this.recognition) {
      this.recognition.abort();
      this.isListening = false;
    }
  }
}

export class VoiceOutputService {
  constructor() {
    this.synth = window.speechSynthesis;
    this.speaking = false;
    this.utterance = null;
    this.voices = [];
    this.settings = {
      voice: null,
      speed: 1.0,
      pitch: 1.0,
      volume: 1.0,
    };
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;
    this._loadVoices();
  }

  get isSupported() { return 'speechSynthesis' in window; }

  _loadVoices() {
    this.voices = this.synth.getVoices();
    if (!this.voices.length) {
      this.synth.onvoiceschanged = () => {
        this.voices = this.synth.getVoices();
      };
    }
  }

  getVoices() { return this.voices; }

  speak(text, interrupt = true) {
    if (!this.isSupported) return;
    if (interrupt) this.stop();

    // Strip markdown for spoken output
    const clean = text
      .replace(/```[\s\S]*?```/g, 'code block')
      .replace(/`[^`]*`/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/^\s*[-*+]\s/gm, '')
      .replace(/\n+/g, '. ')
      .trim();

    this.utterance = new SpeechSynthesisUtterance(clean);
    this.utterance.rate = this.settings.speed;
    this.utterance.pitch = this.settings.pitch;
    this.utterance.volume = this.settings.volume;

    // Select voice
    if (this.settings.voice) {
      const v = this.voices.find(v => v.name === this.settings.voice);
      if (v) this.utterance.voice = v;
    } else {
      // Prefer a nice English voice
      const pref = this.voices.find(v => v.lang.startsWith('en') && !v.name.includes('espeak'));
      if (pref) this.utterance.voice = pref;
    }

    this.utterance.onstart = () => { this.speaking = true; this.onStart?.(); };
    this.utterance.onend = () => { this.speaking = false; this.onEnd?.(); };
    this.utterance.onerror = (e) => { this.speaking = false; this.onError?.(e); };

    this.synth.speak(this.utterance);
  }

  stop() {
    if (this.synth) {
      this.synth.cancel();
      this.speaking = false;
    }
  }

  pause() { this.synth?.pause(); }
  resume() { this.synth?.resume(); }

  updateSettings(settings) {
    Object.assign(this.settings, settings);
  }
}

export class AudioVisualizerService {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.animFrame = null;
    this.stream = null;
    this.mode = 'idle'; // idle | listening | speaking
    this.amplitude = 0;
  }

  async startListening() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.mode = 'listening';
      this._animate();
      return true;
    } catch (e) {
      console.error('Mic access denied:', e);
      return false;
    }
  }

  stopListening() {
    this.mode = 'idle';
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  setMode(mode) {
    this.mode = mode;
  }

  _animate() {
    this.animFrame = requestAnimationFrame(() => this._animate());
    const { canvas, ctx } = this;

    canvas.width = canvas.offsetWidth * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    ctx.clearRect(0, 0, w, h);

    if (this.mode === 'idle') {
      this._drawIdle(w, h);
    } else if (this.analyser) {
      this.analyser.getByteFrequencyData(this.dataArray);
      const avg = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
      this.amplitude = avg / 255;
      this._drawWaveform(w, h);
    } else {
      this._drawSpeaking(w, h);
    }
  }

  _drawIdle(w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const t = Date.now() / 1000;
    const ctx = this.ctx;

    for (let i = 0; i < 5; i++) {
      const x = cx + Math.sin(t * 0.5 + i * 1.2) * (w / 2 - 10);
      const y = cy + Math.cos(t * 0.3 + i * 0.8) * (h / 2 - 4);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 212, 255, ${0.2 + i * 0.08})`;
      ctx.fill();
    }
  }

  _drawWaveform(w, h) {
    const ctx = this.ctx;
    const bufLen = this.dataArray.length;
    const barW = w / bufLen * 2;
    let x = 0;

    for (let i = 0; i < bufLen; i++) {
      const barH = (this.dataArray[i] / 255) * h;
      const intensity = this.dataArray[i] / 255;

      const r = Math.round(0 + intensity * 0);
      const g = Math.round(212 - intensity * 100);
      const b = 255;

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.4 + intensity * 0.6})`;
      ctx.fillRect(x, h - barH, barW - 1, barH);

      // Mirror
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.15 + intensity * 0.2})`;
      ctx.fillRect(x, 0, barW - 1, barH * 0.3);

      x += barW;
    }
  }

  _drawSpeaking(w, h) {
    const ctx = this.ctx;
    const t = Date.now() / 1000;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);

    for (let i = 0; i <= w; i++) {
      const y = h / 2 + Math.sin(i * 0.04 + t * 4) * 12 * Math.sin(t * 1.5)
        + Math.sin(i * 0.08 + t * 6) * 6;
      ctx.lineTo(i, y);
    }

    ctx.strokeStyle = 'rgba(0, 212, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 102, 255, 0.3)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  destroy() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.stopListening();
  }
}
