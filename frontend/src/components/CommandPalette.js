/**
 * Command Palette — Ctrl+K search interface
 */
export class CommandPalette {
  constructor(app) {
    this.app = app;
    this.isOpen = false;
    this.commands = [
      { icon: '🎙', label: 'Talk to ZARVIS', key: 'Space', action: () => app._toggleVoice() },
      { icon: '◉', label: 'Open Assistant', action: () => app._showPage('assistant') },
      { icon: '💬', label: 'New Conversation', action: () => { app._showPage('assistant'); app._sendMessage(''); } },
      { icon: '📁', label: 'Upload File', action: () => { app._showPage('files'); document.getElementById('file-input')?.click(); } },
      { icon: '🧠', label: 'Open Memory', action: () => app._showPage('memory') },
      { icon: '⚙', label: 'Open Settings', action: () => app._showPage('settings') },
      { icon: '🔎', label: 'Search Web', action: () => { app._showPage('assistant'); app._sendMessage('Search the web for'); } },
      { icon: '🔧', label: 'View Tools', action: () => app._showPage('tools') },
      { icon: '📊', label: 'Dashboard', action: () => app._showPage('dashboard') },
    ];
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    const overlay = document.getElementById('command-overlay');
    overlay?.classList.add('active');
    const input = document.getElementById('palette-input');
    if (input) { input.value = ''; input.focus(); }
    this._render('');

    const input2 = document.getElementById('palette-input');
    input2?.addEventListener('input', (e) => this._render(e.target.value));
    input2?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter') {
        const selected = document.querySelector('.palette-item.selected');
        if (selected) { selected.click(); this.close(); }
      }
    });

    document.getElementById('command-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'command-overlay') this.close();
    });
  }

  close() {
    this.isOpen = false;
    document.getElementById('command-overlay')?.classList.remove('active');
  }

  _render(query) {
    const results = document.getElementById('palette-results');
    if (!results) return;

    const filtered = query
      ? this.commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
      : this.commands;

    results.innerHTML = `
      <div class="palette-group-label">COMMANDS</div>
      ${filtered.map((cmd, i) => `
        <div class="palette-item ${i === 0 ? 'selected' : ''}" onclick="window.zarvisApp.commandPalette._execute(${i})">
          <div class="palette-item-icon">${cmd.icon}</div>
          <div class="palette-item-label">${cmd.label}</div>
          ${cmd.key ? `<div class="palette-item-kbd">${cmd.key}</div>` : ''}
        </div>
      `).join('')}
      ${query && !filtered.length ? `
        <div class="palette-item" onclick="window.zarvisApp._sendMessage('${query}'); window.zarvisApp.commandPalette.close(); window.zarvisApp._showPage('assistant')">
          <div class="palette-item-icon">💬</div>
          <div class="palette-item-label">Ask ZARVIS: "${query}"</div>
        </div>
      ` : ''}
    `;

    // Store filtered for execute
    this._filtered = filtered;
  }

  _execute(index) {
    const cmd = this._filtered?.[index] || this.commands[index];
    cmd?.action?.();
    this.close();
  }
}

/**
 * Notification Center
 */
export class NotificationCenter {
  constructor() {
    this._queue = [];
  }

  show(message, type = 'info', duration = 4000) {
    const container = document.getElementById('notifications');
    if (!container) return;

    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const div = document.createElement('div');
    div.className = `notification ${type}`;
    div.innerHTML = `
      <span class="notif-icon">${icons[type] || icons.info}</span>
      <span class="notif-text">${message}</span>
      <span class="notif-close">✕</span>
    `;

    div.addEventListener('click', () => div.remove());
    container.appendChild(div);

    setTimeout(() => {
      div.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      div.style.opacity = '0';
      div.style.transform = 'translateX(40px)';
      setTimeout(() => div.remove(), 400);
    }, duration);
  }
}
