/**
 * API & WebSocket Service Layer
 */

// Detect backend URL — works for localhost dev and same-origin prod
function _detectBackend() {
  const origin = window.location.origin;
  if (origin.startsWith('file://') || origin === 'null') return 'http://localhost:8000';
  if (origin.includes(':5173') || origin.includes(':3000') || origin.includes(':8080')) return 'http://localhost:8000';
  return origin; // production: backend on same origin via nginx
}

const BASE_URL = _detectBackend();

const WS_BASE = BASE_URL.replace(/^http/, 'ws');

export class ApiService {
  constructor() {
    this.baseUrl = BASE_URL;
    this.token = localStorage.getItem('zarvis_token');
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('zarvis_token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('zarvis_token');
  }

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    try {
      const res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Network error' }));
        throw new Error(err.detail || 'Request failed');
      }
      return await res.json();
    } catch (err) {
      if (err.name === 'TypeError') throw new Error('Cannot connect to ZARVIS backend. Is it running?');
      throw err;
    }
  }

  // Auth
  async login(email, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.access_token);
    return data;
  }

  async register(email, password, name) {
    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
    this.setToken(data.access_token);
    return data;
  }

  async me() {
    return this.request('/api/auth/me');
  }

  // Health
  async health() {
    return this.request('/api/health');
  }

  // Conversations
  async getConversations() {
    return this.request('/api/conversations');
  }

  async getConversation(id) {
    return this.request(`/api/conversations/${id}`);
  }

  async createConversation(title = 'New Conversation') {
    return this.request('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  }

  async deleteConversation(id) {
    return this.request(`/api/conversations/${id}`, { method: 'DELETE' });
  }

  // Memory
  async getMemories(category = null) {
    const q = category ? `?category=${category}` : '';
    return this.request(`/api/memory${q}`);
  }

  async addMemory(category, key, value, importance = 0.5) {
    return this.request('/api/memory', {
      method: 'POST',
      body: JSON.stringify({ category, key, value, importance }),
    });
  }

  async deleteMemory(id) {
    return this.request(`/api/memory/${id}`, { method: 'DELETE' });
  }

  async clearMemory() {
    return this.request('/api/memory', { method: 'DELETE' });
  }

  // Tools
  async getTools() {
    return this.request('/api/tools');
  }

  async executeTool(toolName, args = {}) {
    return this.request(`/api/tools/${toolName}/execute`, {
      method: 'POST',
      body: JSON.stringify({ arguments: args }),
    });
  }

  // Files
  async getFiles() {
    return this.request('/api/files');
  }

  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}/api/files/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(err.detail);
    }
    return res.json();
  }

  async deleteFile(id) {
    return this.request(`/api/files/${id}`, { method: 'DELETE' });
  }

  // Settings
  async getSettings() {
    return this.request('/api/settings');
  }

  async updateSettings(data) {
    return this.request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
}

export class WebSocketService {
  constructor(token) {
    this.token = token;
    this.ws = null;
    this.handlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnect = 5;
    this.connected = false;
    this._pingInterval = null;
  }

  connect() {
    const url = `${WS_BASE}/ws/zarvis?token=${this.token || ''}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this._emit('connected', {});
      this._startPing();
    };

    this.ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        this._emit(data.type, data);
      } catch (e) {
        console.error('WS parse error', e);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._emit('disconnected', {});
      this._stopPing();
      if (this.reconnectAttempts < this.maxReconnect) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), 2000 * this.reconnectAttempts);
      }
    };

    this.ws.onerror = (err) => {
      this._emit('ws_error', { error: err });
    };
  }

  disconnect() {
    this._stopPing();
    if (this.ws) this.ws.close();
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendMessage(text, personality = 'professional', conversationId = null) {
    this.send({ type: 'user_message', text, personality, conversation_id: conversationId });
  }

  stop() {
    this.send({ type: 'stop' });
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(handler);
  }

  off(event, handler) {
    const h = this.handlers.get(event);
    if (h) this.handlers.set(event, h.filter(fn => fn !== handler));
  }

  _emit(event, data) {
    const handlers = this.handlers.get(event) || [];
    handlers.forEach(h => h(data));
    const wildcards = this.handlers.get('*') || [];
    wildcards.forEach(h => h(event, data));
  }

  _startPing() {
    this._pingInterval = setInterval(() => {
      if (this.connected) this.send({ type: 'ping' });
    }, 30000);
  }

  _stopPing() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }
}
