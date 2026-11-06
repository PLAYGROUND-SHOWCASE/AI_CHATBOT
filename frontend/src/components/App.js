/**
 * ZARVIS — Main Application Component
 * Orchestrates all UI, state, WebSocket, and audio
 */

import { ApiService, WebSocketService } from '../services/api.js';
import { VoiceInputService, VoiceOutputService, AudioVisualizerService } from '../services/audio.js';
import { ZarvisCore } from './ZarvisCore.js';
import { CommandPalette } from './CommandPalette.js';
import { NotificationCenter } from './NotificationCenter.js';
import { ParticleBackground } from './ParticleBackground.js';

export class ZarvisApp {
  constructor() {
    this.api = new ApiService();
    this.ws = null;
    this.voiceIn = new VoiceInputService();
    this.voiceOut = new VoiceOutputService();
    this.visualizer = null;
    this.zarvisCore = null;
    this.notifications = new NotificationCenter();
    this.commandPalette = new CommandPalette(this);

    this.state = {
      zarvisState: 'idle',
      isAuthenticated: false,
      user: null,
      currentPage: 'assistant',
      currentConversationId: null,
      personality: 'professional',
      messages: [],
      conversations: [],
      memories: [],
      files: [],
      tools: [],
      settings: {},
      autoSpeak: true,
      demoMode: false,
      geminiAvailable: false,
      connected: false,
    };

    this._currentStreamBuffer = '';
    this._streamMessageEl = null;
  }

  async init() {
    this._render();
    this._bindGlobalEvents();
    await this._runStartup();
  }

  // ══════════════════════════════════════════════
  // STARTUP
  // ══════════════════════════════════════════════
  async _runStartup() {
    const screen = document.getElementById('startup-screen');
    const bar = document.getElementById('startup-progress-bar');
    const checks = document.querySelectorAll('.startup-check');

    const steps = [
      { label: 'AI CORE', delay: 400 },
      { label: 'VOICE ENGINE', delay: 600 },
      { label: 'MEMORY', delay: 800 },
      { label: 'TOOLS', delay: 700 },
      { label: 'GEMINI', delay: 900 },
    ];

    for (let i = 0; i < steps.length; i++) {
      await new Promise(r => setTimeout(r, steps[i].delay));
      if (checks[i]) {
        checks[i].classList.add('done');
        const icon = checks[i].querySelector('.check-icon');
        if (icon) icon.textContent = '✓';
      }
      const progress = ((i + 1) / steps.length) * 100;
      if (bar) bar.style.width = `${progress}%`;
    }

    await new Promise(r => setTimeout(r, 500));

    // Fade out startup
    screen.style.transition = 'opacity 0.8s ease';
    screen.style.opacity = '0';
    await new Promise(r => setTimeout(r, 800));
    screen.style.display = 'none';

    // Check if already logged in
    const token = localStorage.getItem('zarvis_token');
    if (token) {
      try {
        const user = await this.api.me();
        this.state.user = user;
        this.state.isAuthenticated = true;
        await this._initDashboard();
        return;
      } catch {
        this.api.clearToken();
      }
    }

    // Show landing page
    this._showLanding();
  }

  // ══════════════════════════════════════════════
  // LANDING PAGE
  // ══════════════════════════════════════════════
  _showLanding() {
    const landing = document.getElementById('landing-page');
    landing.classList.add('active');
  }

  _hideLanding() {
    document.getElementById('landing-page').classList.remove('active');
  }

  _showAuth(tab = 'login') {
    this._hideLanding();
    const auth = document.getElementById('auth-screen');
    auth.classList.add('active');
    this._switchAuthTab(tab);
  }

  _switchAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const tabs = document.querySelectorAll('.auth-tab');

    tabs.forEach(t => t.classList.remove('active'));
    const activeTab = document.querySelector(`.auth-tab[data-tab="${tab}"]`);
    if (activeTab) activeTab.classList.add('active');

    if (tab === 'login') {
      loginForm.style.display = 'flex';
      registerForm.style.display = 'none';
    } else {
      loginForm.style.display = 'none';
      registerForm.style.display = 'flex';
    }
  }

  // ══════════════════════════════════════════════
  // DASHBOARD INIT
  // ══════════════════════════════════════════════
  async _initDashboard() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('landing-page').classList.remove('active');
    document.getElementById('main-app').classList.add('active');

    this._updateUserUI();
    this._startParticles();

    // Connect WebSocket
    this.ws = new WebSocketService(this.api.token);
    this._bindWebSocket();
    this.ws.connect();

    // Init audio visualizer
    const waveCanvas = document.getElementById('waveform-canvas');
    if (waveCanvas) {
      this.visualizer = new AudioVisualizerService(waveCanvas);
    }

    // Init ZARVIS core
    const coreCanvas = document.getElementById('zarvis-canvas');
    if (coreCanvas) {
      this.zarvisCore = new ZarvisCore(coreCanvas);
      this.zarvisCore.start();
    }

    // Voice input init
    this.voiceIn.init();
    this.voiceIn.onTranscript = (text, isFinal) => {
      if (isFinal) {
        this._onUserSpeech(text);
      }
    };
    this.voiceIn.onStart = () => this._setZarvisState('listening');
    this.voiceIn.onEnd = () => {
      if (this.state.zarvisState === 'listening') {
        this._setZarvisState('idle');
      }
    };
    this.voiceIn.onError = (err) => {
      this.notifications.show(`Microphone error: ${err}`, 'error');
      this._setZarvisState('idle');
    };

    // Voice output
    this.voiceOut.onStart = () => {
      this._setZarvisState('speaking');
      if (this.visualizer) this.visualizer.setMode('speaking');
    };
    this.voiceOut.onEnd = () => {
      this._setZarvisState('idle');
      if (this.visualizer) this.visualizer.setMode('idle');
    };

    // Load initial data
    await Promise.allSettled([
      this._loadConversations(),
      this._loadMemories(),
      this._loadFiles(),
      this._loadTools(),
      this._loadSettings(),
    ]);

    this._updateTopbar();
    this._startClock();
    this._showPage('assistant');

    this.notifications.show('ZARVIS ONLINE — Ready for your command', 'success');
  }

  // ══════════════════════════════════════════════
  // WEBSOCKET BINDING
  // ══════════════════════════════════════════════
  _bindWebSocket() {
    this.ws.on('connected', () => {
      this.state.connected = true;
      this._updateTopbar();
    });

    this.ws.on('disconnected', () => {
      this.state.connected = false;
      this._updateTopbar();
      this.notifications.show('Connection lost — reconnecting...', 'warning');
    });

    this.ws.on('init', (data) => {
      this.state.demoMode = data.demo_mode;
      this.state.geminiAvailable = data.gemini_available;
      if (data.demo_mode) {
        this.notifications.show('Demo mode active — add GEMINI_API_KEY for full AI', 'warning');
      }
    });

    this.ws.on('state', (data) => {
      this._setZarvisState(data.state);
    });

    this.ws.on('transcript', (data) => {
      this._addMessage('user', data.text);
    });

    this.ws.on('conversation_id', (data) => {
      this.state.currentConversationId = data.id;
    });

    this.ws.on('tool_start', (data) => {
      this._addToolCard(data.tool, 'running', data.args);
    });

    this.ws.on('tool_complete', (data) => {
      this._updateToolCard(data.tool, 'completed', data.result);
    });

    this.ws.on('tool_error', (data) => {
      this._updateToolCard(data.tool, 'failed', { error: data.error });
    });

    this.ws.on('assistant_chunk', (data) => {
      this._appendStreamChunk(data.text);
    });

    this.ws.on('assistant_done', (data) => {
      this._finalizeStreamMessage(data.text);
      if (this.state.autoSpeak && this.state.settings?.voice?.auto_speak !== false) {
        this.voiceOut.speak(data.text);
      }
    });

    this.ws.on('error', (data) => {
      this.notifications.show(data.message, 'error');
      this._setZarvisState('error');
      setTimeout(() => this._setZarvisState('idle'), 3000);
    });
  }

  // ══════════════════════════════════════════════
  // STATE MANAGEMENT
  // ══════════════════════════════════════════════
  _setZarvisState(newState) {
    this.state.zarvisState = newState;
    const wrapper = document.querySelector('.zarvis-core-wrapper');
    if (wrapper) {
      wrapper.className = `zarvis-core-wrapper ${newState}`;
    }

    const stateTitle = document.getElementById('state-title');
    const stateSubtitle = document.getElementById('state-subtitle');
    const voiceBtn = document.getElementById('voice-btn');

    const stateMap = {
      idle: { title: 'ZARVIS ONLINE', sub: 'Ready for your command.' },
      listening: { title: 'LISTENING...', sub: 'Speak now — I\'m paying attention.' },
      processing: { title: 'PROCESSING...', sub: 'Analyzing your request.' },
      thinking: { title: 'THINKING...', sub: 'Formulating a response.' },
      speaking: { title: 'SPEAKING...', sub: 'Click to interrupt.' },
      executing: { title: 'EXECUTING...', sub: 'Running tool command.' },
      error: { title: 'ERROR', sub: 'Something went wrong.' },
    };

    const info = stateMap[newState] || stateMap.idle;
    if (stateTitle) stateTitle.textContent = info.title;
    if (stateSubtitle) stateSubtitle.textContent = info.sub;

    if (voiceBtn) {
      voiceBtn.className = `voice-btn ${newState === 'listening' ? 'listening' : newState === 'speaking' ? 'speaking' : ''}`;
      voiceBtn.innerHTML = newState === 'listening' ? '⏹' : newState === 'speaking' ? '⏸' : '🎙';
    }

    if (this.zarvisCore) {
      this.zarvisCore.setState(newState);
    }
  }

  // ══════════════════════════════════════════════
  // CHAT MANAGEMENT
  // ══════════════════════════════════════════════
  _addMessage(role, content) {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `
      <div class="message-role">${role.toUpperCase()}</div>
      <div class="message-bubble">${this._formatContent(content)}</div>
      <div class="message-actions">
        <button class="msg-action-btn" onclick="navigator.clipboard.writeText(${JSON.stringify(content)})">📋 Copy</button>
        ${role === 'assistant' ? `<button class="msg-action-btn" onclick="window.zarvisApp.voiceOut.speak(${JSON.stringify(content)})">🔊 Play</button>` : ''}
      </div>
    `;

    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;

    this.state.messages.push({ role, content, ts: Date.now() });
    return div;
  }

  _formatContent(content) {
    // Basic markdown rendering
    return content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```(\w+)?\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  _addTypingIndicator() {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return null;
    const div = document.createElement('div');
    div.id = 'typing-indicator';
    div.className = 'typing-indicator';
    div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  _removeTypingIndicator() {
    document.getElementById('typing-indicator')?.remove();
  }

  _appendStreamChunk(chunk) {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    this._removeTypingIndicator();

    if (!this._streamMessageEl) {
      const div = document.createElement('div');
      div.className = 'message assistant';
      div.innerHTML = `<div class="message-role">ZARVIS</div><div class="message-bubble stream-bubble"></div>`;
      msgs.appendChild(div);
      this._streamMessageEl = div.querySelector('.stream-bubble');
      this._currentStreamBuffer = '';
    }

    this._currentStreamBuffer += chunk;
    this._streamMessageEl.innerHTML = this._formatContent(this._currentStreamBuffer);
    msgs.scrollTop = msgs.scrollHeight;
  }

  _finalizeStreamMessage(fullText) {
    if (this._streamMessageEl) {
      const parent = this._streamMessageEl.closest('.message');
      parent.innerHTML = `
        <div class="message-role">ZARVIS</div>
        <div class="message-bubble">${this._formatContent(fullText)}</div>
        <div class="message-actions">
          <button class="msg-action-btn" onclick="navigator.clipboard.writeText(${JSON.stringify(fullText)})">📋 Copy</button>
          <button class="msg-action-btn" onclick="window.zarvisApp.voiceOut.speak(${JSON.stringify(fullText)})">🔊 Play</button>
        </div>
      `;
      this._streamMessageEl = null;
      this._currentStreamBuffer = '';
    }
    this._removeTypingIndicator();
  }

  _addToolCard(toolName, status, args = {}) {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;

    const icons = {
      calculator: '🧮', weather: '🌤', time: '🕐', web_search: '🔎',
      system_status: '💻', default: '⚡',
    };

    const div = document.createElement('div');
    div.className = 'tool-card';
    div.id = `tool-${toolName}-${Date.now()}`;
    div.dataset.tool = toolName;
    div.innerHTML = `
      <div class="tool-card-header">${icons[toolName] || icons.default} TOOL EXECUTION</div>
      <div class="tool-card-name">Tool: <strong>${toolName}</strong></div>
      <div class="tool-card-status tool-badge-running">⟳ ${status.toUpperCase()}</div>
      ${Object.keys(args).length ? `<div class="tool-card-result">${JSON.stringify(args, null, 2)}</div>` : ''}
    `;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  _updateToolCard(toolName, status, result) {
    const cards = document.querySelectorAll(`[data-tool="${toolName}"]`);
    const card = cards[cards.length - 1];
    if (!card) return;

    const statusEl = card.querySelector('.tool-card-status');
    if (statusEl) {
      statusEl.className = `tool-card-status ${status === 'completed' ? 'tool-badge-done' : 'tool-badge-error'}`;
      statusEl.textContent = status === 'completed' ? '✓ COMPLETED' : '⚠ FAILED';
    }

    if (result && !result.error) {
      const resultEl = card.querySelector('.tool-card-result') || document.createElement('div');
      resultEl.className = 'tool-card-result';
      resultEl.textContent = JSON.stringify(result, null, 2);
      if (!card.contains(resultEl)) card.appendChild(resultEl);
    }
  }

  // ══════════════════════════════════════════════
  // USER INPUT
  // ══════════════════════════════════════════════
  _onUserSpeech(text) {
    if (!text.trim()) return;
    const input = document.getElementById('chat-input');
    if (input) input.value = '';
    this._sendMessage(text);
  }

  _sendMessage(text) {
    if (!text.trim()) return;

    this._addTypingIndicator();

    if (this.ws?.connected) {
      this.ws.sendMessage(text, this.state.personality, this.state.currentConversationId);
    } else {
      // Demo fallback
      this._removeTypingIndicator();
      this._addMessage('user', text);
      setTimeout(() => {
        const response = this._demoResponse(text);
        this._addMessage('assistant', response);
        if (this.state.autoSpeak) this.voiceOut.speak(response);
      }, 1000);
    }
  }

  _demoResponse(text) {
    const t = text.toLowerCase();
    if (t.includes('hello') || t.includes('hi')) return "Hello! I'm ZARVIS, your AI command intelligence. Connect to the backend for full capabilities.";
    if (t.includes('weather')) return "I'd check the weather, but I'm running in offline demo mode. Start the backend with your Gemini API key.";
    if (t.includes('calculate') || /\d+\s*[\+\-\*\/]\s*\d+/.test(t)) {
      try { return `Result: ${eval(t.match(/[\d\s\+\-\*\/\(\)\.]+/)[0])}`; } catch { return "I can perform calculations once the backend is running."; }
    }
    if (t.includes('what can you do')) return "I can have voice conversations, answer questions, search the web, analyze files, check weather, do calculations, manage tasks, and much more — all with Gemini AI powering my responses.";
    return "I'm ZARVIS in offline mode. Start the backend (uvicorn app.main:app --reload) and add your GEMINI_API_KEY for full AI capabilities.";
  }

  // ══════════════════════════════════════════════
  // VOICE CONTROL
  // ══════════════════════════════════════════════
  _toggleVoice() {
    if (this.state.zarvisState === 'speaking') {
      // Interrupt
      this.voiceOut.stop();
      if (this.ws?.connected) this.ws.stop();
      this._setZarvisState('idle');
      return;
    }

    if (this.voiceIn.isListening) {
      this.voiceIn.stop();
      if (this.visualizer) this.visualizer.stopListening();
      this._setZarvisState('idle');
      return;
    }

    if (!this.voiceIn.isSupported) {
      this.notifications.show('Speech recognition not supported in this browser. Try Chrome.', 'warning');
      return;
    }

    if (this.visualizer) {
      this.visualizer.startListening();
    }

    const started = this.voiceIn.start(this.state.settings?.voice?.language || 'en-US');
    if (!started) {
      this.notifications.show('Could not start microphone. Check permissions.', 'error');
    }
  }

  // ══════════════════════════════════════════════
  // DATA LOADING
  // ══════════════════════════════════════════════
  async _loadConversations() {
    try {
      this.state.conversations = await this.api.getConversations();
      this._renderConversationsList();
    } catch (e) {
      console.warn('Could not load conversations:', e.message);
    }
  }

  async _loadMemories() {
    try {
      this.state.memories = await this.api.getMemories();
      this._renderMemories();
    } catch (e) {
      console.warn('Could not load memories:', e.message);
    }
  }

  async _loadFiles() {
    try {
      this.state.files = await this.api.getFiles();
      this._renderFiles();
    } catch (e) {
      console.warn('Could not load files:', e.message);
    }
  }

  async _loadTools() {
    try {
      this.state.tools = await this.api.getTools();
      this._renderTools();
    } catch (e) {
      // Use defaults
      this.state.tools = [
        { name: 'calculator', description: 'Safe math calculations', enabled: true },
        { name: 'weather', description: 'Real-time weather data', enabled: true },
        { name: 'time', description: 'Current date and time', enabled: true },
        { name: 'web_search', description: 'DuckDuckGo web search', enabled: true },
        { name: 'system_status', description: 'System resource metrics', enabled: true },
      ];
      this._renderTools();
    }
  }

  async _loadSettings() {
    try {
      this.state.settings = await this.api.getSettings();
      this._applySettings();
    } catch (e) {
      console.warn('Could not load settings:', e.message);
    }
  }

  _applySettings() {
    const s = this.state.settings;
    if (s?.voice?.auto_speak !== undefined) this.state.autoSpeak = s.voice.auto_speak;
    if (s?.ai?.personality) this.state.personality = s.ai.personality;
    if (s?.voice) {
      this.voiceOut.updateSettings({
        speed: s.voice.speed || 1.0,
        pitch: s.voice.pitch || 1.0,
      });
    }
    this._renderSettings();
  }

  // ══════════════════════════════════════════════
  // PAGE NAVIGATION
  // ══════════════════════════════════════════════
  _showPage(page) {
    this.state.currentPage = page;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));

    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');

    const navItem = document.querySelector(`[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    // Refresh data for specific pages
    if (page === 'dashboard') this._renderDashboard();
    if (page === 'conversations') this._renderConversationsList();
    if (page === 'memory') this._loadMemories();
    if (page === 'files') this._loadFiles();
  }

  // ══════════════════════════════════════════════
  // RENDERING
  // ══════════════════════════════════════════════
  _updateUserUI() {
    const u = this.state.user;
    if (!u) return;
    const nameEl = document.getElementById('user-display-name');
    const avatarEl = document.getElementById('user-avatar');
    if (nameEl) nameEl.textContent = u.name;
    if (avatarEl) avatarEl.textContent = u.name?.charAt(0)?.toUpperCase() || 'U';
  }

  _updateTopbar() {
    const dot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const geminiStatus = document.getElementById('gemini-status');

    if (dot) dot.className = `status-dot ${this.state.connected ? '' : 'offline'}`;
    if (statusText) statusText.textContent = this.state.connected ? 'ONLINE' : 'OFFLINE';
    if (geminiStatus) {
      geminiStatus.textContent = this.state.geminiAvailable
        ? 'Gemini Connected'
        : this.state.demoMode
        ? 'Demo Mode'
        : 'Connecting...';
      geminiStatus.style.color = this.state.geminiAvailable
        ? 'var(--accent-green)' : 'var(--accent-orange)';
    }
  }

  _startClock() {
    const tick = () => {
      const el = document.getElementById('topbar-time');
      if (el) {
        const now = new Date();
        el.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      }
    };
    tick();
    setInterval(tick, 1000);
  }

  _renderDashboard() {
    const greeting = document.getElementById('dashboard-greeting');
    if (greeting) {
      const hour = new Date().getHours();
      const period = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
      greeting.textContent = `Good ${period}, ${this.state.user?.name || 'Commander'}`;
    }
    const dateEl = document.getElementById('dashboard-date');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    // Update stats
    this._setInner('stat-conversations', this.state.conversations.length);
    this._setInner('stat-messages', this.state.messages.length);
    this._setInner('stat-memories', this.state.memories.length);
    this._setInner('stat-files', this.state.files.length);
  }

  _renderConversationsList() {
    const list = document.getElementById('conversations-list');
    if (!list) return;

    if (!this.state.conversations.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div><div class="empty-state-text">No conversations yet. Start talking to ZARVIS!</div></div>';
      return;
    }

    list.innerHTML = this.state.conversations.map(c => `
      <div class="conv-item" onclick="window.zarvisApp._openConversation(${c.id})">
        <div class="conv-item-icon">💬</div>
        <div class="conv-info">
          <div class="conv-title">${c.title}</div>
          <div class="conv-date">${new Date(c.updated_at).toLocaleString()}</div>
        </div>
        <button class="conv-del" onclick="event.stopPropagation(); window.zarvisApp._deleteConversation(${c.id})" title="Delete">🗑</button>
      </div>
    `).join('');
  }

  async _openConversation(id) {
    try {
      const conv = await this.api.getConversation(id);
      this.state.currentConversationId = id;
      const msgs = document.getElementById('chat-messages');
      if (msgs) {
        msgs.innerHTML = '';
        conv.messages.forEach(m => this._addMessage(m.role, m.content));
      }
      this._showPage('assistant');
    } catch (e) {
      this.notifications.show('Failed to load conversation', 'error');
    }
  }

  async _deleteConversation(id) {
    try {
      await this.api.deleteConversation(id);
      this.state.conversations = this.state.conversations.filter(c => c.id !== id);
      this._renderConversationsList();
      this.notifications.show('Conversation deleted', 'success');
    } catch (e) {
      this.notifications.show('Failed to delete', 'error');
    }
  }

  _renderMemories() {
    const container = document.getElementById('memory-container');
    if (!container) return;

    if (!this.state.memories.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🧠</div><div class="empty-state-text">No memories stored yet. ZARVIS will learn from your conversations.</div></div>';
      return;
    }

    const byCategory = {};
    this.state.memories.forEach(m => {
      if (!byCategory[m.category]) byCategory[m.category] = [];
      byCategory[m.category].push(m);
    });

    container.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
      <div class="memory-category">
        <div class="memory-category-title">🧠 ${cat.toUpperCase().replace(/_/g, ' ')}</div>
        ${items.map(m => `
          <div class="memory-item">
            <span class="memory-check">✓</span>
            <span class="memory-key">${m.key}</span>
            <span class="memory-value">${m.value}</span>
            <button class="memory-delete" onclick="window.zarvisApp._deleteMemory(${m.id})">🗑</button>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  async _deleteMemory(id) {
    try {
      await this.api.deleteMemory(id);
      this.state.memories = this.state.memories.filter(m => m.id !== id);
      this._renderMemories();
      this.notifications.show('Memory deleted', 'success');
    } catch (e) {
      this.notifications.show('Failed to delete memory', 'error');
    }
  }

  _renderFiles() {
    const list = document.getElementById('files-list');
    if (!list) return;

    const icons = {
      'application/pdf': '📄',
      'text/plain': '📝',
      'text/csv': '📊',
      'image/jpeg': '🖼',
      'image/png': '🖼',
      'application/json': '📋',
      'default': '📁',
    };

    if (!this.state.files.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📁</div><div class="empty-state-text">No files uploaded. Drag and drop files to analyze them.</div></div>';
      return;
    }

    list.innerHTML = this.state.files.map(f => `
      <div class="file-item">
        <div class="file-icon">${icons[f.mime_type] || icons.default}</div>
        <div class="file-info">
          <div class="file-name">${f.filename}</div>
          <div class="file-meta">${f.mime_type} · ${(f.size_bytes / 1024).toFixed(1)}KB · ${new Date(f.created_at).toLocaleDateString()}</div>
        </div>
        <div class="file-actions">
          <button class="file-btn" onclick="window.zarvisApp._analyzeFile(${f.id}, '${f.filename}')">🔍</button>
          <button class="file-btn delete" onclick="window.zarvisApp._deleteFile(${f.id})">🗑</button>
        </div>
      </div>
    `).join('');
  }

  _analyzeFile(id, name) {
    this._showPage('assistant');
    this._sendMessage(`Please analyze the file: ${name}`);
  }

  async _deleteFile(id) {
    try {
      await this.api.deleteFile(id);
      this.state.files = this.state.files.filter(f => f.id !== id);
      this._renderFiles();
      this.notifications.show('File deleted', 'success');
    } catch (e) {
      this.notifications.show('Failed to delete file', 'error');
    }
  }

  _renderTools() {
    const grid = document.getElementById('tools-grid');
    if (!grid) return;

    const icons = {
      calculator: '🧮', weather: '🌤', time: '🕐', web_search: '🔎',
      system_status: '💻', email: '📧', calendar: '📅', notes: '📝',
    };

    grid.innerHTML = this.state.tools.map(t => `
      <div class="tool-tile">
        <div class="tool-tile-icon">${icons[t.name] || '⚡'}</div>
        <div class="tool-tile-name">${t.name.toUpperCase().replace(/_/g, ' ')}</div>
        <div class="tool-tile-desc">${t.description}</div>
        <div class="tool-tile-status">${t.enabled ? '● ACTIVE' : '○ DISABLED'}</div>
      </div>
    `).join('');
  }

  _renderSettings() {
    const s = this.state.settings;
    if (!s) return;

    // Populate settings fields
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!val;
      else if (el.type === 'range') el.value = val;
      else el.value = val;
    };

    setVal('setting-model', s.ai?.model || 'gemini-1.5-pro');
    setVal('setting-personality', s.ai?.personality || 'professional');
    setVal('setting-temperature', s.ai?.temperature || 0.7);
    setVal('setting-voice-speed', s.voice?.speed || 1.0);
    setVal('setting-voice-pitch', s.voice?.pitch || 1.0);
    setVal('setting-auto-speak', s.voice?.auto_speak !== false);
    setVal('setting-memory-enabled', s.memory?.enabled !== false);
  }

  async _saveSettings() {
    const getVal = (id, type = 'string') => {
      const el = document.getElementById(id);
      if (!el) return null;
      if (type === 'bool') return el.checked;
      if (type === 'number') return parseFloat(el.value);
      return el.value;
    };

    const settings = {
      ai: {
        model: getVal('setting-model'),
        personality: getVal('setting-personality'),
        temperature: getVal('setting-temperature', 'number'),
      },
      voice: {
        speed: getVal('setting-voice-speed', 'number'),
        pitch: getVal('setting-voice-pitch', 'number'),
        auto_speak: getVal('setting-auto-speak', 'bool'),
      },
      memory: {
        enabled: getVal('setting-memory-enabled', 'bool'),
      },
    };

    try {
      await this.api.updateSettings(settings);
      this.state.settings = settings;
      this._applySettings();
      this.notifications.show('Settings saved', 'success');
    } catch (e) {
      this.notifications.show('Failed to save settings', 'error');
    }
  }

  // ══════════════════════════════════════════════
  // GLOBAL EVENTS
  // ══════════════════════════════════════════════
  _bindGlobalEvents() {
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Cmd/Ctrl + K — Command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.commandPalette.toggle();
      }
      // Space — Voice (when not in input)
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        this._toggleVoice();
      }
      // Escape — Stop speaking / close palette
      if (e.key === 'Escape') {
        this.voiceOut.stop();
        this.voiceIn.abort();
        this.commandPalette.close();
        if (this.state.zarvisState !== 'idle') this._setZarvisState('idle');
      }
    });
  }

  _startParticles() {
    const canvas = document.getElementById('particles-canvas');
    if (canvas) new ParticleBackground(canvas).start();
  }

  _setInner(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ══════════════════════════════════════════════
  // RENDER (full HTML)
  // ══════════════════════════════════════════════
  _render() {
    document.getElementById('app').innerHTML = this._html();
    this._bindUIEvents();
    window.zarvisApp = this;
  }

  _bindUIEvents() {
    // Auth tabs
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => this._switchAuthTab(tab.dataset.tab));
    });

    // Login form
    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const btn = document.getElementById('login-btn');
      const errEl = document.getElementById('login-error');

      btn.disabled = true;
      btn.textContent = 'CONNECTING...';
      errEl.classList.remove('visible');

      try {
        const data = await this.api.login(email, password);
        this.state.user = data.user;
        this.state.isAuthenticated = true;
        await this._initDashboard();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.add('visible');
        btn.disabled = false;
        btn.textContent = 'INITIATE SESSION';
      }
    });

    // Register form
    document.getElementById('register-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-password').value;
      const name = document.getElementById('reg-name').value;
      const btn = document.getElementById('register-btn');
      const errEl = document.getElementById('register-error');

      btn.disabled = true;
      btn.textContent = 'CREATING...';
      errEl.classList.remove('visible');

      try {
        const data = await this.api.register(email, password, name);
        this.state.user = data.user;
        this.state.isAuthenticated = true;
        await this._initDashboard();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.add('visible');
        btn.disabled = false;
        btn.textContent = 'CREATE ACCOUNT';
      }
    });

    // Demo mode (skip auth)
    document.getElementById('demo-link')?.addEventListener('click', () => {
      this._hideLanding();
      document.getElementById('auth-screen').classList.remove('active');
      this.state.user = { name: 'Commander', email: 'demo@zarvis.ai' };
      this.state.isAuthenticated = true;
      this.state.demoMode = true;
      this._initDashboard();
    });

    // Landing nav
    document.getElementById('landing-login-btn')?.addEventListener('click', () => this._showAuth('login'));
    document.getElementById('landing-register-btn')?.addEventListener('click', () => this._showAuth('register'));
    document.getElementById('hero-start-btn')?.addEventListener('click', () => this._showAuth('register'));
    document.getElementById('hero-demo-btn')?.addEventListener('click', () => {
      document.getElementById('demo-link')?.click();
    });

    // Sidebar navigation
    document.querySelectorAll('.sidebar-item[data-page]').forEach(item => {
      item.addEventListener('click', () => this._showPage(item.dataset.page));
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      this.api.clearToken();
      this.ws?.disconnect();
      this.state.isAuthenticated = false;
      document.getElementById('main-app').classList.remove('active');
      this._showLanding();
    });

    // Voice button
    document.getElementById('voice-btn')?.addEventListener('click', () => this._toggleVoice());

    // Chat input
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');

    chatInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) {
          this._addMessage('user', text);
          this._sendMessage(text);
          chatInput.value = '';
        }
      }
    });

    sendBtn?.addEventListener('click', () => {
      const text = chatInput?.value.trim();
      if (text) {
        this._addMessage('user', text);
        this._sendMessage(text);
        if (chatInput) chatInput.value = '';
      }
    });

    // Chat mic button
    document.getElementById('chat-mic-btn')?.addEventListener('click', () => this._toggleVoice());

    // File upload
    const dropZone = document.getElementById('file-drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone?.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) await this._uploadFile(file);
    });

    fileInput?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      for (const file of files) await this._uploadFile(file);
    });

    // Settings save
    document.getElementById('settings-save-btn')?.addEventListener('click', () => this._saveSettings());

    // Memory clear
    document.getElementById('clear-memory-btn')?.addEventListener('click', async () => {
      try {
        await this.api.clearMemory();
        this.state.memories = [];
        this._renderMemories();
        this.notifications.show('All memories cleared', 'success');
      } catch (e) {
        this.notifications.show('Failed to clear memories', 'error');
      }
    });

    // Quick actions
    document.querySelectorAll('.quick-action[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'voice') { this._showPage('assistant'); this._toggleVoice(); }
        else if (action === 'assistant') this._showPage('assistant');
        else if (action === 'files') this._showPage('files');
        else if (action === 'search') { this._showPage('assistant'); this._sendMessage('Search the web for latest AI news'); }
        else if (action === 'memory') this._showPage('memory');
        else if (action === 'tools') this._showPage('tools');
      });
    });

    // Personality selector
    document.getElementById('personality-select')?.addEventListener('change', (e) => {
      this.state.personality = e.target.value;
    });
  }

  async _uploadFile(file) {
    try {
      this.notifications.show(`Uploading ${file.name}...`, 'info');
      const result = await this.api.uploadFile(file);
      this.state.files.unshift(result);
      this._renderFiles();
      this.notifications.show(`${file.name} uploaded successfully`, 'success');
    } catch (e) {
      this.notifications.show(`Upload failed: ${e.message}`, 'error');
    }
  }

  // ══════════════════════════════════════════════
  // HTML TEMPLATE
  // ══════════════════════════════════════════════
  _html() {
    return `
<!-- Ambient particles -->
<canvas id="particles-canvas"></canvas>
<div class="scanlines"></div>

<!-- ═══════════ STARTUP SCREEN ═══════════ -->
<div id="startup-screen">
  <div class="startup-logo">ZARVIS</div>
  <div class="startup-subtitle">AI COMMAND INTELLIGENCE</div>
  <div class="startup-ring">
    <svg width="180" height="180" viewBox="0 0 180 180" fill="none">
      <circle cx="90" cy="90" r="85" stroke="rgba(0,212,255,0.4)" stroke-width="1" stroke-dasharray="8 4"/>
    </svg>
    <svg width="150" height="150" viewBox="0 0 150 150" fill="none" style="position:absolute;inset:15px">
      <circle cx="75" cy="75" r="70" stroke="rgba(0,102,255,0.5)" stroke-width="1" stroke-dasharray="4 8"/>
    </svg>
    <svg width="116" height="116" viewBox="0 0 116 116" fill="none" style="position:absolute;inset:32px">
      <circle cx="58" cy="58" r="53" stroke="rgba(123,47,255,0.4)" stroke-width="1" stroke-dasharray="2 6"/>
    </svg>
  </div>
  <div class="startup-checks">
    <div class="startup-check"><span class="check-label">AI CORE</span><span class="check-dots">........</span><span class="check-icon">⟳</span></div>
    <div class="startup-check"><span class="check-label">VOICE ENGINE</span><span class="check-dots">......</span><span class="check-icon">⟳</span></div>
    <div class="startup-check"><span class="check-label">MEMORY</span><span class="check-dots">.........</span><span class="check-icon">⟳</span></div>
    <div class="startup-check"><span class="check-label">TOOLS</span><span class="check-dots">..........</span><span class="check-icon">⟳</span></div>
    <div class="startup-check"><span class="check-label">GEMINI</span><span class="check-dots">.........</span><span class="check-icon">⟳</span></div>
  </div>
  <div class="startup-progress"><div class="startup-progress-bar" id="startup-progress-bar"></div></div>
</div>

<!-- ═══════════ LANDING PAGE ═══════════ -->
<div id="landing-page">
  <nav class="landing-nav">
    <div class="landing-logo">ZARVIS</div>
    <div class="landing-nav-btns">
      <button class="btn-ghost" id="landing-login-btn">LOGIN</button>
      <button class="btn-primary" id="landing-register-btn">GET STARTED</button>
    </div>
  </nav>
  <section class="landing-hero">
    <div class="hero-eyebrow">AI COMMAND INTELLIGENCE · v1.0</div>
    <h1 class="hero-title">MEET ZARVIS</h1>
    <div class="hero-taglines">
      <span class="hero-tagline">Talk.</span>
      <span class="hero-tagline">Think.</span>
      <span class="hero-tagline">Analyze.</span>
      <span class="hero-tagline">Execute.</span>
    </div>
    <p class="hero-desc">Your intelligent voice-powered AI command center. Powered by Google Gemini. Designed for the future.</p>
    <div class="hero-buttons">
      <button class="btn-hero" id="hero-start-btn">▶ START ZARVIS</button>
      <button class="btn-ghost" id="hero-demo-btn">◈ DEMO MODE</button>
    </div>
  </section>
  <div class="landing-features">
    <div class="feature-card">
      <div class="feature-icon">🎙</div>
      <div class="feature-title">VOICE AI</div>
      <div class="feature-desc">Natural voice conversations with real-time speech recognition and synthesis. Interrupt at any moment.</div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">🧠</div>
      <div class="feature-title">GEMINI INTELLIGENCE</div>
      <div class="feature-desc">Powered by Google Gemini for state-of-the-art natural language understanding and generation.</div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">⚡</div>
      <div class="feature-title">AI TOOL EXECUTION</div>
      <div class="feature-desc">Weather, web search, calculations, file analysis, and more — all executed in real time.</div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">💾</div>
      <div class="feature-title">PERSISTENT MEMORY</div>
      <div class="feature-desc">ZARVIS remembers your preferences, projects, and important context across sessions.</div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">📁</div>
      <div class="feature-title">MULTIMODAL</div>
      <div class="feature-desc">Upload PDFs, images, spreadsheets, and more. ZARVIS reads, summarizes, and answers questions.</div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">🔒</div>
      <div class="feature-title">PRIVACY FIRST</div>
      <div class="feature-desc">API keys stay on the server. You control your data, memory, and conversation history.</div>
    </div>
  </div>
</div>

<!-- ═══════════ AUTH SCREEN ═══════════ -->
<div id="auth-screen">
  <div class="auth-bg"></div>
  <div class="auth-card">
    <div class="auth-logo">ZARVIS</div>
    <div class="auth-tagline">AI COMMAND INTELLIGENCE</div>
    <div class="auth-tabs">
      <button class="auth-tab active" data-tab="login">LOGIN</button>
      <button class="auth-tab" data-tab="register">REGISTER</button>
    </div>

    <!-- Login -->
    <form class="auth-form" id="login-form" style="display:flex">
      <div class="form-group">
        <label class="form-label">EMAIL ADDRESS</label>
        <input class="form-input" type="email" id="login-email" placeholder="commander@zarvis.ai" required />
      </div>
      <div class="form-group">
        <label class="form-label">ACCESS KEY</label>
        <input class="form-input" type="password" id="login-password" placeholder="••••••••••" required />
      </div>
      <div class="auth-error" id="login-error"></div>
      <button class="btn-primary" type="submit" id="login-btn">INITIATE SESSION</button>
    </form>

    <!-- Register -->
    <form class="auth-form" id="register-form" style="display:none">
      <div class="form-group">
        <label class="form-label">COMMANDER NAME</label>
        <input class="form-input" type="text" id="reg-name" placeholder="Your name" required />
      </div>
      <div class="form-group">
        <label class="form-label">EMAIL ADDRESS</label>
        <input class="form-input" type="email" id="reg-email" placeholder="commander@zarvis.ai" required />
      </div>
      <div class="form-group">
        <label class="form-label">ACCESS KEY</label>
        <input class="form-input" type="password" id="reg-password" placeholder="Create a strong password" required />
      </div>
      <div class="auth-error" id="register-error"></div>
      <button class="btn-primary" type="submit" id="register-btn">CREATE ACCOUNT</button>
    </form>

    <div class="demo-notice">
      No backend? <span class="demo-link" id="demo-link">Try Demo Mode</span>
    </div>
  </div>
</div>

<!-- ═══════════ MAIN APP ═══════════ -->
<div id="main-app">

  <!-- Top Status Bar -->
  <header class="topbar">
    <div class="topbar-logo">ZARVIS</div>
    <div class="topbar-status">
      <div class="status-dot" id="status-dot"></div>
      <span id="status-text">CONNECTING</span>
    </div>

    <div class="topbar-center">
      <div class="topbar-stat">
        <span class="topbar-stat-label">AI</span>
        <span class="topbar-stat-value" id="gemini-status">Connecting...</span>
      </div>
      <div class="topbar-stat">
        <span class="topbar-stat-label">MIC</span>
        <span class="topbar-stat-value" style="color:var(--accent-green)">READY</span>
      </div>
      <div class="topbar-stat">
        <span class="topbar-stat-label">MEM</span>
        <span class="topbar-stat-value" style="color:var(--accent-green)">ACTIVE</span>
      </div>
    </div>

    <div class="topbar-right">
      <div class="topbar-time" id="topbar-time">--:--</div>
      <select id="personality-select" class="setting-select" style="width:130px;font-size:0.7rem;padding:6px 10px">
        <option value="professional">Professional</option>
        <option value="friendly">Friendly</option>
        <option value="concise">Concise</option>
        <option value="technical">Technical</option>
        <option value="creative">Creative</option>
        <option value="researcher">Researcher</option>
        <option value="executive">Executive</option>
      </select>
      <button class="topbar-btn" id="logout-btn">LOGOUT</button>
    </div>
  </header>

  <div class="app-body">

    <!-- Sidebar -->
    <nav class="sidebar">
      <button class="sidebar-item active" data-page="assistant">
        <span class="sidebar-icon">◉</span> Assistant
      </button>
      <button class="sidebar-item" data-page="dashboard">
        <span class="sidebar-icon">⌂</span> Dashboard
      </button>
      <button class="sidebar-item" data-page="conversations">
        <span class="sidebar-icon">◫</span> Conversations
      </button>
      <div class="sidebar-section-label">INTELLIGENCE</div>
      <button class="sidebar-item" data-page="memory">
        <span class="sidebar-icon">🧠</span> Memory
      </button>
      <button class="sidebar-item" data-page="files">
        <span class="sidebar-icon">📁</span> Files
      </button>
      <button class="sidebar-item" data-page="tools">
        <span class="sidebar-icon">🔧</span> Tools
      </button>
      <div class="sidebar-section-label">SYSTEM</div>
      <button class="sidebar-item" data-page="settings">
        <span class="sidebar-icon">⚙</span> Settings
      </button>

      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-avatar" id="user-avatar">Z</div>
          <div class="user-name" id="user-display-name">Commander</div>
        </div>
      </div>
    </nav>

    <!-- Page Container -->
    <div class="page-container">

      <!-- ── ASSISTANT PAGE ── -->
      <div class="page active" id="page-assistant">
        <div class="assistant-layout">

          <!-- AI Core Panel -->
          <div class="core-panel">
            <div class="zarvis-core-wrapper idle">
              <canvas id="zarvis-canvas" width="300" height="300"></canvas>
              <div class="core-rings">
                <div class="core-ring"></div>
                <div class="core-ring"></div>
                <div class="core-ring"></div>
                <div class="core-center">
                  <div class="core-label">ZARVIS</div>
                  <div class="core-state-text" id="core-state-text">CORE</div>
                </div>
              </div>
            </div>

            <div class="state-display">
              <div class="state-title" id="state-title">ZARVIS ONLINE</div>
              <div class="state-subtitle" id="state-subtitle">Ready for your command.</div>
            </div>

            <div class="waveform-container">
              <canvas id="waveform-canvas"></canvas>
            </div>

            <div class="voice-controls">
              <button class="voice-btn" id="voice-btn" aria-label="Talk to ZARVIS" title="Press Space or click to speak">🎙</button>
              <div class="voice-label">CLICK TO SPEAK<br><span style="font-size:0.5rem;opacity:0.6">OR PRESS SPACE</span></div>
            </div>
          </div>

          <!-- Chat Panel -->
          <div class="chat-panel">
            <div class="chat-header">
              <div class="chat-title">ZARVIS CONVERSATION</div>
              <button class="msg-action-btn" onclick="document.getElementById('chat-messages').innerHTML=''" title="Clear chat">🗑 Clear</button>
            </div>

            <div class="chat-messages" id="chat-messages">
              <div class="message assistant">
                <div class="message-role">ZARVIS</div>
                <div class="message-bubble">
                  Good day, Commander. I am ZARVIS — your AI command intelligence. I'm ready to assist you with questions, analysis, web searches, calculations, and more.<br><br>
                  <strong>How to start:</strong><br>
                  • Click the microphone button or press <code>Space</code> to speak<br>
                  • Type your message below<br>
                  • Press <code>Ctrl+K</code> for the command palette<br><br>
                  What can I do for you today?
                </div>
              </div>
            </div>

            <div class="chat-input-area">
              <div class="chat-input-row">
                <textarea class="chat-input" id="chat-input" placeholder="Ask ZARVIS anything..." rows="1"></textarea>
                <button class="chat-mic-btn" id="chat-mic-btn" title="Voice input">🎙</button>
                <button class="chat-input-btn" id="chat-send-btn" title="Send (Enter)">➤</button>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- ── DASHBOARD PAGE ── -->
      <div class="page" id="page-dashboard">
        <div class="dashboard-page">
          <div class="dashboard-header">
            <h1 class="dashboard-greeting" id="dashboard-greeting">Good day, Commander</h1>
            <div class="dashboard-date" id="dashboard-date"></div>
          </div>

          <div class="stat-grid">
            <div class="stat-card">
              <div class="stat-icon">💬</div>
              <div class="stat-value" id="stat-conversations">0</div>
              <div class="stat-label">CONVERSATIONS</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon">📨</div>
              <div class="stat-value" id="stat-messages">0</div>
              <div class="stat-label">MESSAGES</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon">🧠</div>
              <div class="stat-value" id="stat-memories">0</div>
              <div class="stat-label">MEMORIES</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon">📁</div>
              <div class="stat-value" id="stat-files">0</div>
              <div class="stat-label">FILES</div>
            </div>
          </div>

          <h2 style="font-family:var(--font-display);font-size:0.65rem;letter-spacing:0.2em;color:var(--text-muted);margin-bottom:4px">QUICK ACTIONS</h2>
          <div class="quick-actions">
            <div class="quick-action" data-action="assistant"><div class="quick-action-icon">◉</div><div class="quick-action-label">ASK ZARVIS</div></div>
            <div class="quick-action" data-action="voice"><div class="quick-action-icon">🎙</div><div class="quick-action-label">VOICE INPUT</div></div>
            <div class="quick-action" data-action="files"><div class="quick-action-icon">📄</div><div class="quick-action-label">ANALYZE FILE</div></div>
            <div class="quick-action" data-action="search"><div class="quick-action-icon">🔎</div><div class="quick-action-label">SEARCH WEB</div></div>
            <div class="quick-action" data-action="memory"><div class="quick-action-icon">🧠</div><div class="quick-action-label">VIEW MEMORY</div></div>
            <div class="quick-action" data-action="tools"><div class="quick-action-icon">🔧</div><div class="quick-action-label">TOOLS</div></div>
          </div>

          <div class="system-grid">
            <div class="system-card">
              <div class="system-card-title">◈ SYSTEM STATUS</div>
              <div class="metric-row">
                <span class="metric-label">CPU</span>
                <div class="metric-bar"><div class="metric-fill cpu" style="width:32%"></div></div>
                <span class="metric-value">32%</span>
              </div>
              <div class="metric-row">
                <span class="metric-label">MEMORY</span>
                <div class="metric-bar"><div class="metric-fill mem" style="width:54%"></div></div>
                <span class="metric-value">54%</span>
              </div>
              <div class="metric-row">
                <span class="metric-label">NETWORK</span>
                <div class="metric-bar"><div class="metric-fill net" style="width:80%"></div></div>
                <span class="metric-value">ONLINE</span>
              </div>
            </div>
            <div class="system-card">
              <div class="system-card-title">◈ AI STATUS</div>
              <div class="metric-row">
                <span class="metric-label">MODEL</span>
                <span class="metric-value">GEMINI</span>
              </div>
              <div class="metric-row">
                <span class="metric-label">STATUS</span>
                <span class="metric-value" id="gemini-status-dash" style="color:var(--accent-green)">ONLINE</span>
              </div>
              <div class="metric-row">
                <span class="metric-label">TOOLS</span>
                <span class="metric-value">5 ACTIVE</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── CONVERSATIONS PAGE ── -->
      <div class="page" id="page-conversations">
        <div class="conversations-page">
          <div class="page-header">
            <h1 class="page-title">CONVERSATIONS</h1>
            <button class="btn-primary" style="padding:8px 20px;font-size:0.6rem" onclick="window.zarvisApp._showPage('assistant')">+ NEW</button>
          </div>
          <input class="conv-search" id="conv-search" placeholder="Search conversations..." oninput="window.zarvisApp._filterConversations(this.value)" />
          <div id="conversations-list"></div>
        </div>
      </div>

      <!-- ── MEMORY PAGE ── -->
      <div class="page" id="page-memory">
        <div class="memory-page">
          <div class="page-header">
            <h1 class="page-title">MEMORY</h1>
            <button class="btn-cancel" id="clear-memory-btn">CLEAR ALL</button>
          </div>
          <div id="memory-container"></div>
        </div>
      </div>

      <!-- ── FILES PAGE ── -->
      <div class="page" id="page-files">
        <div class="files-page">
          <div class="page-header">
            <h1 class="page-title">FILES</h1>
          </div>
          <div class="file-drop-zone" id="file-drop-zone">
            <div class="drop-icon">📁</div>
            <div class="drop-text">DRAG & DROP FILES</div>
            <div class="drop-sub">PDF, DOCX, TXT, CSV, XLSX, JSON, Images (max 50MB)</div>
          </div>
          <input type="file" id="file-input" style="display:none" multiple accept=".pdf,.docx,.txt,.csv,.xlsx,.json,.jpg,.jpeg,.png,.webp" />
          <div class="file-list" id="files-list"></div>
        </div>
      </div>

      <!-- ── TOOLS PAGE ── -->
      <div class="page" id="page-tools">
        <div class="tools-page">
          <div class="page-header">
            <h1 class="page-title">TOOLS</h1>
          </div>
          <div class="tools-grid" id="tools-grid"></div>
        </div>
      </div>

      <!-- ── SETTINGS PAGE ── -->
      <div class="page" id="page-settings">
        <div class="settings-page">
          <div class="page-header">
            <h1 class="page-title">SETTINGS</h1>
            <button class="btn-primary" id="settings-save-btn" style="padding:8px 20px;font-size:0.6rem">SAVE</button>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">AI CONFIGURATION</div>
            <div class="setting-row">
              <div class="setting-info"><div class="setting-label">AI Model</div><div class="setting-desc">Google Gemini model to use</div></div>
              <div class="setting-control">
                <select class="setting-select" id="setting-model">
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                  <option value="gemini-pro">Gemini Pro</option>
                </select>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-info"><div class="setting-label">Personality</div><div class="setting-desc">Default response style</div></div>
              <div class="setting-control">
                <select class="setting-select" id="setting-personality">
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="concise">Concise</option>
                  <option value="technical">Technical</option>
                  <option value="creative">Creative</option>
                </select>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-info"><div class="setting-label">Temperature</div><div class="setting-desc">Creativity level (0–1)</div></div>
              <div class="setting-control">
                <input class="setting-input" type="number" id="setting-temperature" min="0" max="1" step="0.1" value="0.7" />
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">VOICE & AUDIO</div>
            <div class="setting-row">
              <div class="setting-info"><div class="setting-label">Auto Speak</div><div class="setting-desc">Automatically speak ZARVIS responses</div></div>
              <div class="setting-control">
                <label class="setting-toggle">
                  <input type="checkbox" id="setting-auto-speak" checked />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-info"><div class="setting-label">Speech Speed</div><div class="setting-desc">Voice playback rate</div></div>
              <div class="setting-control">
                <input class="setting-input" type="number" id="setting-voice-speed" min="0.5" max="2" step="0.1" value="1.0" />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-info"><div class="setting-label">Voice Pitch</div><div class="setting-desc">Pitch of synthesized voice</div></div>
              <div class="setting-control">
                <input class="setting-input" type="number" id="setting-voice-pitch" min="0.5" max="2" step="0.1" value="1.0" />
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">MEMORY & PRIVACY</div>
            <div class="setting-row">
              <div class="setting-info"><div class="setting-label">Enable Memory</div><div class="setting-desc">ZARVIS remembers context between sessions</div></div>
              <div class="setting-control">
                <label class="setting-toggle">
                  <input type="checkbox" id="setting-memory-enabled" checked />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>

        </div>
      </div>

    </div>
  </div>
</div>

<!-- Command Palette -->
<div class="command-overlay" id="command-overlay">
  <div class="command-palette">
    <div class="palette-input-row">
      <span class="palette-icon">⌘</span>
      <input class="palette-input" id="palette-input" placeholder="Search commands or ask ZARVIS..." />
      <span class="palette-kbd">ESC</span>
    </div>
    <div class="palette-results" id="palette-results"></div>
  </div>
</div>

<!-- Confirmation Dialog -->
<div class="confirm-overlay" id="confirm-overlay">
  <div class="confirm-dialog">
    <div class="confirm-title">⚠ ZARVIS REQUESTS CONFIRMATION</div>
    <div class="confirm-action" id="confirm-action-text">Are you sure?</div>
    <div class="confirm-buttons">
      <button class="btn-cancel" id="confirm-cancel">CANCEL</button>
      <button class="btn-danger" id="confirm-proceed">CONFIRM</button>
    </div>
  </div>
</div>

<!-- Notifications -->
<div class="notifications" id="notifications"></div>
    `;
  }

  _filterConversations(query) {
    const list = document.getElementById('conversations-list');
    if (!list) return;
    const filtered = query
      ? this.state.conversations.filter(c => c.title.toLowerCase().includes(query.toLowerCase()))
      : this.state.conversations;

    this.state.conversations = filtered; // temp override for render
    this._renderConversationsList();
  }
}
