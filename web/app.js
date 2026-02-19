class AssistantDevUi {
  constructor({ apiBase = '/assistant' } = {}) {
    this.apiBase = apiBase;
    this.state = {
      open: true,
      settingsOpen: false,
      mode: 'normal',
      userId: 'luna',
      messages: [],
      loading: false,
      llmEnabled: null,
      lastAssistantText: '',
      lastUserText: '',
      selectedCharacter: 'luna',
      characters: [],
    };

    this.palette = {
      luna: 'linear-gradient(135deg,#ff8bd6,#8ea6ff)',
      eva: 'linear-gradient(135deg,#f59e0b,#facc15)',
      news: 'linear-gradient(135deg,#3b82f6,#60a5fa)',
      support: 'linear-gradient(135deg,#10b981,#34d399)',
    };

    this.el = this.getElements();
  }

  getElements() {
    return {
      fab: document.getElementById('fab'),
      panel: document.getElementById('panel'),
      chatView: document.getElementById('chatView'),
      settingsView: document.getElementById('settingsView'),
      tabChat: document.getElementById('tabChat'),
      tabSettings: document.getElementById('tabSettings'),
      modeToggle: document.getElementById('modeToggle'),
      chatScroll: document.getElementById('chatScroll'),
      chatInput: document.getElementById('chatInput'),
      sendBtn: document.getElementById('sendBtn'),
      llmStatus: document.getElementById('llmStatus'),
      serverStatus: document.getElementById('serverStatus'),
      gpuStatus: document.getElementById('gpuStatus'),
      serverDetail: document.getElementById('serverDetail'),
      gpuDetail: document.getElementById('gpuDetail'),
      serverSpinner: document.getElementById('serverSpinner'),
      gpuSpinner: document.getElementById('gpuSpinner'),
      charName: document.getElementById('charName'),
      avatarBtn: document.getElementById('avatarBtn'),
      settingsToggle: document.getElementById('settingsToggle'),
      closeBtn: document.getElementById('closeBtn'),
      overlay: document.getElementById('overlay'),
      charGrid: document.getElementById('charGrid'),
      closeOverlay: document.getElementById('closeOverlay'),
      btnTrainPrepare: document.getElementById('btnTrainPrepare'),
      btnTrainAuto: document.getElementById('btnTrainAuto'),
      btnReset: document.getElementById('btnReset'),
      btnRefresh: document.getElementById('btnRefresh'),
      btnDeleteDay: document.getElementById('btnDeleteDay'),
      btnDelete7Days: document.getElementById('btnDelete7Days'),
      btnDeleteMonth: document.getElementById('btnDeleteMonth'),
      minCurated: document.getElementById('minCurated'),
      btnExampleAdapter: document.getElementById('btnExampleAdapter'),
      btnEnsureTrainer: document.getElementById('btnEnsureTrainer'),
      opsOut: document.getElementById('opsOut'),
      adapterPathOut: document.getElementById('adapterPathOut'),
      adapterHintOut: document.getElementById('adapterHintOut'),
      ovHist: document.getElementById('ovHist'),
      ovUnc: document.getElementById('ovUnc'),
      ovMem: document.getElementById('ovMem'),
      ovMode: document.getElementById('ovMode'),
      apiEndpoint: document.getElementById('apiEndpoint'),
      apiMethod: document.getElementById('apiMethod'),
      apiPayload: document.getElementById('apiPayload'),
      btnRunApi: document.getElementById('btnRunApi'),
    };
  }

  getApiCatalog() {
    const cid = encodeURIComponent(this.state.selectedCharacter || 'luna');
    return [
      { path: `/brief?characterId=${cid}`, method: 'GET' },
      { path: `/settings?characterId=${cid}`, method: 'GET' },
      { path: '/settings', method: 'POST', body: { characterId: this.state.selectedCharacter, llmEnabled: true } },
      { path: '/mode', method: 'POST', body: { characterId: this.state.selectedCharacter, mode: 'normal' } },
      { path: `/mode?characterId=${cid}`, method: 'GET' },
      { path: `/mode-extras?characterId=${cid}`, method: 'GET' },
      { path: '/mode-extras', method: 'POST', body: { characterId: this.state.selectedCharacter, instructions: [], memories: [] } },
      { path: '/web-search/preview', method: 'POST', body: { characterId: this.state.selectedCharacter, message: 'Marktupdate heute' } },
      { path: '/feedback', method: 'POST', body: { characterId: this.state.selectedCharacter, mode: this.state.mode, value: 'up', userMessage: 'hi', assistantMessage: 'hello' } },
      { path: '/training/example', method: 'POST', body: { characterId: this.state.selectedCharacter, mode: this.state.mode, source: 'api-explorer', accepted: true, user: 'hi', assistant: 'hello' } },
      { path: '/training/prepare', method: 'POST', body: {} },
      { path: '/training/auto', method: 'POST', body: { minCurated: Number(this.el.minCurated.value || 20) } },
      { path: `/training/status?minCurated=${encodeURIComponent(this.el.minCurated.value || 20)}`, method: 'GET' },
      { path: '/training/lora/config', method: 'GET' },
      { path: '/training/lora/provider-health', method: 'GET' },
      { path: '/training/lora/trainer/ensure', method: 'POST', body: { ensureTrainer: true } },
      { path: '/training/lora/start', method: 'POST', body: { datasetTier: 'curated', minCurated: 1, dryRun: false, skipEval: true, skipExport: false } },
      { path: '/training/lora/example-adapter', method: 'POST', body: { characterId: this.state.selectedCharacter, mode: this.state.mode, userMessage: 'hi', assistantMessage: 'hello' } },
      { path: '/training/lora/status', method: 'GET' },
      { path: '/training/lora/quick-start', method: 'POST', body: { characterId: this.state.selectedCharacter, mode: this.state.mode, userMessage: 'hi', assistantMessage: 'hello' } },
      { path: '/memory/delete-recent', method: 'POST', body: { characterId: this.state.selectedCharacter, mode: this.state.mode, days: 7 } },
      { path: '/profile', method: 'POST', body: { characterId: this.state.selectedCharacter, preferredName: 'User' } },
      { path: '/characters', method: 'GET' },
      { path: '/reset', method: 'POST', body: { characterId: this.state.selectedCharacter } },
    ];
  }

  inferMethodForEndpoint(pathValue = '') {
    const normalized = String(pathValue || '').trim();
    const match = this.getApiCatalog().find((entry) => entry.path === normalized);
    if (match) return match.method;

    const noQuery = normalized.split('?')[0];
    if (/^\/training\/lora\/status$/i.test(noQuery)) return 'GET';
    if (/^\/training\/status$/i.test(noQuery)) return 'GET';
    if (/^\/mode$/i.test(noQuery) || /^\/settings$/i.test(noQuery)) return 'POST';
    if (/^\/characters$/i.test(noQuery) || /^\/brief$/i.test(noQuery)) return 'GET';
    if (/^\/.*\/.*$/i.test(noQuery) && /^(\/training|\/memory|\/profile|\/reset|\/feedback|\/chat)/i.test(noQuery)) return 'POST';
    return 'GET';
  }

  updateApiMethodHint() {
    if (!this.el.apiEndpoint || !this.el.apiMethod) return;
    const method = this.inferMethodForEndpoint(this.el.apiEndpoint.value);
    this.el.apiMethod.textContent = method;
  }

  prefillApiPayloadForCurrentEndpoint() {
    if (!this.el.apiEndpoint || !this.el.apiPayload) return;
    const endpoint = String(this.el.apiEndpoint.value || '').trim();
    const match = this.getApiCatalog().find((entry) => entry.path === endpoint);
    if (!match || !match.body) {
      this.el.apiPayload.value = '';
      return;
    }
    this.el.apiPayload.value = JSON.stringify(match.body, null, 2);
  }

  async runApiExplorer() {
    if (!this.el.apiEndpoint) return;

    const endpoint = String(this.el.apiEndpoint.value || '').trim();
    if (!endpoint.startsWith('/')) {
      this.showOps('Fehler: Endpoint muss mit / beginnen. Beispiel: /mode?characterId=luna');
      return;
    }

    const method = this.inferMethodForEndpoint(endpoint);
    let payload = null;

    if (method !== 'GET') {
      const raw = String(this.el.apiPayload?.value || '').trim();
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          this.showOps('Fehler: Payload ist kein valides JSON.');
          return;
        }
      } else {
        payload = {};
      }
    }

    try {
      const out = await this.api(endpoint, method, payload);
      this.showOps({
        endpoint,
        method,
        payload,
        response: out,
      });

      if (endpoint.startsWith('/mode') || endpoint.startsWith('/settings') || endpoint.startsWith('/training/status')) {
        await this.refreshModeAndStatus();
        await this.refreshTrainingStatus();
      }
    } catch (error) {
      this.showOps({ endpoint, method, payload, error: error.message });
    }
  }

  isoDate(value) {
    const dateValue = new Date(value || Date.now());
    return dateValue.toISOString().slice(0, 10);
  }

  fmtDateLabel(value) {
    try {
      return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value));
    } catch {
      return value;
    }
  }

  async api(path, method = 'GET', body = null) {
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok === false) {
      throw new Error(json?.error?.message || `HTTP ${response.status}`);
    }
    return json;
  }

  async getServerHealth() {
    const response = await fetch('/health', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok === false) {
      throw new Error(json?.error?.message || `HTTP ${response.status}`);
    }
    return json;
  }

  setModeUi() {
    const dot = this.state.mode === 'uncensored' ? '●' : '○';
    this.el.modeToggle.textContent = `${dot} ${this.state.mode}`;
  }

  applyCharacterUi() {
    const first = String(this.state.selectedCharacter || 'l').charAt(0).toUpperCase();
    this.el.avatarBtn.textContent = first;
    this.el.avatarBtn.style.background = this.palette[this.state.selectedCharacter] || this.palette.luna;
    this.el.charName.textContent = this.state.selectedCharacter;
  }

  setStatus(text, cssClass = '') {
    this.el.llmStatus.textContent = text;
    this.el.llmStatus.className = `status ${cssClass}`.trim();
  }

  setSimpleStatus(element, text, cssClass = '') {
    if (!element) return;
    element.textContent = text;
    const baseClass = element.id === 'serverStatus' || element.id === 'gpuStatus' ? 'infra-value' : 'status';
    element.className = `${baseClass} ${cssClass}`.trim();
  }

  setInfraDetail(element, text) {
    if (!element) return;
    element.textContent = String(text || '').trim();
  }

  setSpinnerRunning(element, running) {
    if (!element) return;
    element.classList.toggle('running', !!running);
  }

  togglePanel(force = null) {
    this.state.open = typeof force === 'boolean' ? force : !this.state.open;
    this.el.panel.classList.toggle('open', this.state.open);
    this.el.fab.textContent = this.state.open ? '×' : '✦';
  }

  toggleSettings(force = null) {
    this.state.settingsOpen = typeof force === 'boolean' ? force : !this.state.settingsOpen;
    this.el.chatView.classList.toggle('active', !this.state.settingsOpen);
    this.el.settingsView.classList.toggle('active', this.state.settingsOpen);
    this.el.tabChat.classList.toggle('active', !this.state.settingsOpen);
    this.el.tabSettings.classList.toggle('active', this.state.settingsOpen);
  }

  appendMessage(role, text, meta = '') {
    this.state.messages.push({
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text: String(text || ''),
      at: new Date().toISOString(),
      meta,
      feedback: null,
    });
    this.renderMessages();
  }

  renderMessages() {
    const list = [];
    let previousDate = '';

    this.state.messages.forEach((message, index) => {
      const day = this.isoDate(message.at);
      if (day !== previousDate) {
        list.push(`<div class="day-sep">${this.fmtDateLabel(message.at)}</div>`);
        previousDate = day;
      }

      const isUser = message.role === 'user';
      const avatar = isUser ? 'YOU' : (this.state.selectedCharacter || 'L').slice(0, 2).toUpperCase();
      const actions = isUser
        ? `<div class="msg-actions"><button class="action-btn" data-act="retry" data-id="${message.id}">↻ retry</button></div>`
        : `<div class="msg-actions">
            <button class="action-btn ${message.feedback === 'up' ? 'active' : ''}" data-act="up" data-id="${message.id}">👍</button>
            <button class="action-btn ${message.feedback === 'down' ? 'active' : ''}" data-act="down" data-id="${message.id}">👎</button>
            <button class="action-btn" data-act="retry" data-id="${message.id}">↻</button>
            <button class="action-btn" data-act="edit" data-id="${message.id}">✎</button>
          </div>`;

      list.push(`
        <article class="message ${isUser ? 'user' : 'assistant'}" data-id="${message.id}" data-idx="${index}">
          <div class="msg-avatar">${avatar}</div>
          <div class="msg-stack">
            <div class="bubble">${this.escapeHtml(message.text)}</div>
            <div class="meta">${this.escapeHtml(message.meta || '')}</div>
            ${actions}
          </div>
        </article>
      `);
    });

    if (this.state.loading) {
      list.push('<div class="thinking">Luna denkt<span class="dots"></span></div>');
    }

    this.el.chatScroll.innerHTML = list.join('');
    this.el.chatScroll.scrollTop = this.el.chatScroll.scrollHeight;
  }

  escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  async refreshModeAndStatus() {
    try {
      const mode = await this.api(`/mode?characterId=${encodeURIComponent(this.state.selectedCharacter)}`);
      this.state.mode = mode.mode || 'normal';
      this.setModeUi();

      const settings = await this.api(`/settings?characterId=${encodeURIComponent(this.state.selectedCharacter)}`);
      this.state.llmEnabled = !!settings?.settings?.llmEnabled;
      this.setStatus(this.state.llmEnabled ? 'Live LLM' : 'Fallback', this.state.llmEnabled ? 'live' : 'fallback');

      const overview = settings?.settings?.memoryOverview || {};
      this.el.ovHist.textContent = Number(overview.historyCount || 0);
      this.el.ovUnc.textContent = Number(overview.uncensoredHistoryCount || 0);
      const memCount = Number(overview.goalsCount || 0) + Number(overview.notesCount || 0) + Number(overview.pinnedMemoriesCount || 0);
      this.el.ovMem.textContent = memCount;
      this.el.ovMode.textContent = settings?.settings?.mode || this.state.mode;

      await this.refreshInfraStatus();
    } catch (error) {
      this.setStatus(`Statusfehler: ${error.message}`, 'fallback');
      this.setSimpleStatus(this.el.serverStatus, 'Server: offline', 'fallback');
      this.setSimpleStatus(this.el.gpuStatus, 'GPU-ML: unbekannt', 'fallback');
    }
  }

  async refreshInfraStatus() {
    this.setSpinnerRunning(this.el.serverSpinner, true);
    try {
      await this.getServerHealth();
      this.setSimpleStatus(this.el.serverStatus, 'Online', 'live');
      this.setInfraDetail(this.el.serverDetail, 'Core API antwortet auf /health');
    } catch {
      this.setSimpleStatus(this.el.serverStatus, 'Offline', 'fallback');
      this.setInfraDetail(this.el.serverDetail, 'Core API nicht erreichbar');
    } finally {
      this.setSpinnerRunning(this.el.serverSpinner, false);
    }

    this.setSpinnerRunning(this.el.gpuSpinner, true);
    try {
      const out = await this.api('/training/lora/provider-health', 'GET');
      const provider = out?.provider || {};
      const health = provider?.health || {};

      if (!provider.enabled) {
        this.setSimpleStatus(this.el.gpuStatus, 'Deaktiviert', 'fallback');
        this.setInfraDetail(this.el.gpuDetail, 'ASSISTANT_LORA_ENABLED=false');
        return;
      }

      if (!provider.reachable) {
        this.setSimpleStatus(this.el.gpuStatus, 'Trainer offline', 'fallback');
        this.setInfraDetail(this.el.gpuDetail, provider.reason || 'Provider nicht erreichbar');
        return;
      }

      const cuda = health?.cudaAvailable;
      if (cuda === true) {
        this.setSimpleStatus(this.el.gpuStatus, 'Aktiv (CUDA)', 'live');
        this.setInfraDetail(this.el.gpuDetail, `Trainer online: ${health?.service || 'lora-trainer'}`);
      } else if (cuda === false) {
        this.setSimpleStatus(this.el.gpuStatus, 'Online (CPU)', 'fallback');
        this.setInfraDetail(this.el.gpuDetail, `Trainer ohne CUDA: ${health?.service || 'lora-trainer'}`);
      } else {
        this.setSimpleStatus(this.el.gpuStatus, 'Trainer online', 'live');
        this.setInfraDetail(this.el.gpuDetail, `Service: ${health?.service || 'unknown'}`);
      }
    } catch {
      this.setSimpleStatus(this.el.gpuStatus, 'Trainer offline', 'fallback');
      this.setInfraDetail(this.el.gpuDetail, 'Port 6060 antwortet nicht');
    } finally {
      this.setSpinnerRunning(this.el.gpuSpinner, false);
    }
  }

  async sendMessage() {
    const message = this.el.chatInput.value.trim();
    if (!message || this.state.loading) return;

    this.el.chatInput.value = '';
    this.autosizeInput();
    this.appendMessage('user', message, 'gesendet');
    this.state.lastUserText = message;

    this.state.loading = true;
    this.renderMessages();

    try {
      const out = await this.api('/chat', 'POST', {
        characterId: this.state.selectedCharacter,
        mode: this.state.mode,
        message,
      });
      const reply = out.reply || '(leer)';
      this.state.lastAssistantText = reply;
      this.appendMessage('assistant', reply, 'neu ausgeführt');
    } catch (error) {
      this.appendMessage('assistant', `Fehler: ${error.message}`, 'fehler');
    } finally {
      this.state.loading = false;
      this.renderMessages();
    }
  }

  async sendFeedback(value, assistantText, userText) {
    await this.api('/feedback', 'POST', {
      characterId: this.state.selectedCharacter,
      mode: this.state.mode,
      value,
      assistantMessage: assistantText,
      userMessage: userText,
    });
  }

  async saveManualCorrection(userText, assistantText) {
    return this.api('/training/example', 'POST', {
      characterId: this.state.selectedCharacter,
      mode: this.state.mode,
      source: 'assistant-manual-edit',
      accepted: true,
      user: userText,
      assistant: assistantText,
      userOriginal: userText,
      assistantOriginal: assistantText,
    });
  }

  autosizeInput() {
    this.el.chatInput.style.height = 'auto';
    this.el.chatInput.style.height = `${Math.min(this.el.chatInput.scrollHeight, 120)}px`;
  }

  showOps(data) {
    this.el.opsOut.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }

  renderAdapterPaths(training = null) {
    const paths = training?.lora?.adapterPaths || {};
    const active = String(paths.activeAdapterPath || '').trim() || '(kein aktiver Adapter)';
    const latest = String(paths.latestExpectedAdapterPath || '').trim() || '(kein letzter erwarteter Pfad)';
    const canAutoTrain = Boolean(training?.canAutoTrain);

    this.el.adapterPathOut.textContent = `Active Adapter Path: ${active}\nLatest Expected Path: ${latest}`;
    this.el.adapterHintOut.textContent = canAutoTrain
      ? 'Auto Train: bereit'
      : 'Auto Train: noch nicht bereit (curated < minCurated)';
    if (this.el.btnTrainAuto) {
      this.el.btnTrainAuto.disabled = !canAutoTrain;
    }
  }

  async refreshTrainingStatus(showLog = false) {
    const minCurated = Number(this.el.minCurated.value || 20);
    const status = await this.api(`/training/status?minCurated=${encodeURIComponent(minCurated)}`);
    this.renderAdapterPaths(status?.training || {});
    if (showLog) {
      this.showOps(status);
    }
    return status;
  }

  async runSettingsAction(action) {
    try {
      if (action === 'reset') {
        if (!window.confirm('Wirklich kompletten State zurücksetzen?')) return;
        this.showOps(await this.api('/reset', 'POST', { characterId: this.state.selectedCharacter }));
        await this.refreshModeAndStatus();
        return;
      }
      if (action === 'deleteDay') {
        this.showOps(await this.api('/memory/delete-recent', 'POST', {
          mode: this.state.mode,
          days: 1,
        }));
        await this.refreshModeAndStatus();
        return;
      }
      if (action === 'delete7Days') {
        this.showOps(await this.api('/memory/delete-recent', 'POST', {
          mode: this.state.mode,
          days: 7,
        }));
        await this.refreshModeAndStatus();
        return;
      }
      if (action === 'deleteMonth') {
        this.showOps(await this.api('/memory/delete-recent', 'POST', {
          mode: this.state.mode,
          days: 30,
        }));
        await this.refreshModeAndStatus();
        return;
      }
      if (action === 'exampleAdapter') {
        let userMessage = String(this.state.lastUserText || '').trim();
        let assistantMessage = String(this.state.lastAssistantText || '').trim();

        if (!userMessage) {
          userMessage = window.prompt('User Message für Example Adapter Training', 'Sag kurz hallo') || '';
        }
        if (!assistantMessage) {
          assistantMessage = window.prompt('Assistant Message für Example Adapter Training', 'Hallo! Schön, dass du da bist.') || '';
        }

        this.showOps(await this.api('/training/lora/example-adapter', 'POST', {
          characterId: this.state.selectedCharacter,
          mode: this.state.mode,
          userMessage,
          assistantMessage,
          datasetTier: 'curated',
          minCurated: 1,
          dryRun: false,
          skipEval: true,
          skipExport: false,
          source: 'example-adapter-ui',
        }));
        await this.refreshTrainingStatus();
        return;
      }
      if (action === 'ensureTrainer') {
        this.showOps(await this.api('/training/lora/trainer/ensure', 'POST', {
          ensureTrainer: true,
        }));
        await this.refreshInfraStatus();
        return;
      }
      if (action === 'refresh') {
        await this.refreshModeAndStatus();
        await this.refreshTrainingStatus(true);
        await this.refreshInfraStatus();
        this.showOps('Settings + Training Status aktualisiert');
        return;
      }
    } catch (error) {
      this.showOps(`Fehler: ${error.message}`);
    }
  }

  openCharacterOverlay() {
    this.el.overlay.classList.add('open');
  }

  closeCharacterOverlay() {
    this.el.overlay.classList.remove('open');
  }

  renderCharacters() {
    const chars = this.state.characters.length
      ? this.state.characters
      : [{ id: 'luna', name: 'Luna', note: 'Default' }, { id: 'eva', name: 'Eva', note: 'Trading' }];

    this.el.charGrid.innerHTML = chars.map((character) => {
      const id = String(character.id || '').toLowerCase();
      const active = id === this.state.selectedCharacter ? 'active' : '';
      const dotStyle = `background:${this.palette[id] || this.palette.luna}`;
      return `
        <button class="char-item ${active}" data-char="${id}">
          <span class="char-dot" style="${dotStyle}"></span>
          <span style="text-align:left;display:flex;flex-direction:column;gap:2px;">
            <strong style="font-size:13px;color:var(--txt)">${this.escapeHtml(character.name || id)}</strong>
            <small style="font-size:11px;color:var(--txt-dim)">${this.escapeHtml(character.note || '')}</small>
          </span>
        </button>
      `;
    }).join('');
  }

  async loadCharacters() {
    try {
      const out = await this.api('/characters', 'GET');
      this.state.characters = Array.isArray(out?.characters) ? out.characters : [];
      this.renderCharacters();
    } catch {
      this.renderCharacters();
    }
  }

  async handleMessageAction(target) {
    const button = target.closest('[data-act]');
    if (!button) return;

    const action = button.getAttribute('data-act');
    const wrap = button.closest('.message');
    if (!wrap) return;

    const index = Number(wrap.getAttribute('data-idx'));
    const message = this.state.messages[index];
    if (!message) return;

    try {
      if (action === 'up' || action === 'down') {
        const assistantText = message.text;
        const userText = [...this.state.messages].slice(0, index).reverse().find((item) => item.role === 'user')?.text || this.state.lastUserText;
        await this.sendFeedback(action, assistantText, userText);
        message.feedback = action;
        message.meta = action === 'up' ? '👍 feedback gespeichert' : '👎 feedback gespeichert';
        this.renderMessages();
        return;
      }

      if (action === 'retry') {
        const candidate = message.role === 'user'
          ? message.text
          : [...this.state.messages].slice(0, index).reverse().find((item) => item.role === 'user')?.text;
        if (!candidate) return;

        this.el.chatInput.value = candidate;
        this.autosizeInput();
        await this.sendMessage();
        return;
      }

      if (action === 'edit' && message.role === 'assistant') {
        const edited = window.prompt('Assistant Antwort bearbeiten', message.text);
        if (!edited || !edited.trim()) return;

        const userText = [...this.state.messages].slice(0, index).reverse().find((item) => item.role === 'user')?.text || '';
        await this.saveManualCorrection(userText, edited.trim());
        message.text = edited.trim();
        message.meta = '✏️ bearbeitet + als Training gespeichert';
        this.renderMessages();
      }
    } catch (error) {
      this.showOps(`Action Fehler: ${error.message}`);
    }
  }

  async toggleMode() {
    const target = this.state.mode === 'normal' ? 'uncensored' : 'normal';
    let password = '';
    if (target === 'uncensored') {
      password = window.prompt('Passwort für uncensored mode (falls gesetzt):', '') || '';
    }

    try {
      const out = await this.api('/mode', 'POST', {
        characterId: this.state.selectedCharacter,
        mode: target,
        password,
      });
      this.state.mode = out.mode || target;
      this.setModeUi();
    } catch (error) {
      this.showOps(`Mode Fehler: ${error.message}`);
    }
  }

  wireEvents() {
    const bindClick = (element, handler) => {
      if (element) {
        element.addEventListener('click', handler);
      }
    };

    this.el.fab.addEventListener('click', () => this.togglePanel());
    this.el.closeBtn.addEventListener('click', () => this.togglePanel(false));
    this.el.settingsToggle.addEventListener('click', () => this.toggleSettings(true));
    this.el.tabChat.addEventListener('click', () => this.toggleSettings(false));
    this.el.tabSettings.addEventListener('click', () => this.toggleSettings(true));
    this.el.modeToggle.addEventListener('click', () => this.toggleMode());
    this.el.sendBtn.addEventListener('click', () => this.sendMessage());

    this.el.chatInput.addEventListener('input', () => this.autosizeInput());
    this.el.chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.sendMessage();
      }
    });

    this.el.chatScroll.addEventListener('click', (event) => {
      this.handleMessageAction(event.target);
    });

    bindClick(this.el.btnReset, () => this.runSettingsAction('reset'));
    bindClick(this.el.btnRefresh, () => this.runSettingsAction('refresh'));
    bindClick(this.el.btnDeleteDay, () => this.runSettingsAction('deleteDay'));
    bindClick(this.el.btnDelete7Days, () => this.runSettingsAction('delete7Days'));
    bindClick(this.el.btnDeleteMonth, () => this.runSettingsAction('deleteMonth'));
    bindClick(this.el.btnEnsureTrainer, () => this.runSettingsAction('ensureTrainer'));
    bindClick(this.el.btnExampleAdapter, () => this.runSettingsAction('exampleAdapter'));
    bindClick(this.el.btnRunApi, () => this.runApiExplorer());

    if (this.el.apiEndpoint) {
      this.el.apiEndpoint.addEventListener('input', () => this.updateApiMethodHint());
      this.el.apiEndpoint.addEventListener('change', () => {
        this.updateApiMethodHint();
        this.prefillApiPayloadForCurrentEndpoint();
      });
    }

    this.el.avatarBtn.addEventListener('click', () => this.openCharacterOverlay());
    this.el.closeOverlay.addEventListener('click', () => this.closeCharacterOverlay());
    this.el.overlay.addEventListener('click', (event) => {
      if (event.target === this.el.overlay) {
        this.closeCharacterOverlay();
      }
    });

    this.el.charGrid.addEventListener('click', async (event) => {
      const item = event.target.closest('[data-char]');
      if (!item) return;

      this.state.selectedCharacter = item.getAttribute('data-char');
      this.applyCharacterUi();
      this.renderCharacters();
      this.closeCharacterOverlay();
      await this.refreshModeAndStatus();
    });
  }

  async init() {
    this.wireEvents();
    this.setModeUi();
    this.applyCharacterUi();
    await this.loadCharacters();
    await this.refreshModeAndStatus();
    await this.refreshTrainingStatus();
    await this.refreshInfraStatus();

    if (this.el.apiEndpoint) {
      this.updateApiMethodHint();
      this.prefillApiPayloadForCurrentEndpoint();
    }

    this.appendMessage('assistant', 'Hi ✨ Ich bin bereit. Schreib mir eine Nachricht oder öffne Settings für Training/LoRA.', 'bereit');
    this.autosizeInput();

    window.setInterval(() => {
      this.refreshInfraStatus().catch(() => {});
    }, 10000);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const app = new AssistantDevUi();
  await app.init();
  window.assistantDevUi = app;
});
