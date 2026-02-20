class VoiceInterface {
  constructor({ onStatus = null, onError = null } = {}) {
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.onError = typeof onError === 'function' ? onError : () => {};
    this.synth = window.speechSynthesis || null;
    this.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    this.recognition = null;
    this.voices = [];
    this.speakingSessionId = 0;
  }

  supportsTts() {
    return !!this.synth;
  }

  supportsStt() {
    return !!this.SpeechRecognition;
  }

  async loadVoices() {
    if (!this.supportsTts()) return [];

    const loadNow = () => {
      const list = this.synth.getVoices() || [];
      this.voices = Array.isArray(list) ? list.slice() : [];
      return this.voices;
    };

    const initial = loadNow();
    if (initial.length > 0) return initial;

    await new Promise((resolve) => {
      const timeout = window.setTimeout(resolve, 1200);
      if ('onvoiceschanged' in this.synth) {
        this.synth.onvoiceschanged = () => {
          window.clearTimeout(timeout);
          loadNow();
          resolve();
        };
      }
    });

    return loadNow();
  }

  resolveVoice(settings = {}) {
    if (!this.supportsTts()) return null;
    const voiceName = String(settings.voiceName || '').trim();
    const lang = String(settings.lang || 'de-DE').trim().toLowerCase();

    if (voiceName) {
      const exact = this.voices.find((voice) => String(voice?.name || '') === voiceName);
      if (exact) return exact;
    }

    const langMatches = this.voices.filter((voice) => String(voice?.lang || '').toLowerCase().startsWith(lang.slice(0, 2)));
    if (langMatches.length > 0) {
      const preferred = langMatches.find((voice) => /(katja|helena|anna|vicki|zira|female|girl|amelie)/i.test(String(voice?.name || '')));
      return preferred || langMatches[0];
    }

    return this.voices[0] || null;
  }

  speak(text = '', settings = {}) {
    if (!this.supportsTts()) {
      this.onError({ state: 'error', text: 'TTS wird in diesem Browser nicht unterstützt.' });
      return;
    }

    const content = String(text || '').trim();
    if (!content) return;

    const chunks = this.splitSpeechText(content);
    const currentSession = Date.now();
    this.speakingSessionId = currentSession;
    this.synth.cancel();
    this.onStatus({ state: 'speaking', text: '🔊 Luna spricht ...' });

    const speakNext = (index) => {
      if (this.speakingSessionId !== currentSession) return;
      if (index >= chunks.length) {
        this.onStatus({ state: 'idle', text: '🔊 Luna fertig.' });
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = String(settings.lang || 'de-DE');
      utterance.rate = Number(settings.rate || 1.0);
      utterance.pitch = Number(settings.pitch || 1.15);
      utterance.volume = Number(settings.volume || 1.0);
      utterance.voice = this.resolveVoice(settings);
      utterance.onend = () => speakNext(index + 1);
      utterance.onerror = () => this.onError({ state: 'error', text: 'Voice-Ausgabe fehlgeschlagen.' });
      this.synth.speak(utterance);
    };

    speakNext(0);
  }

  splitSpeechText(text = '') {
    const maxChunkLength = 220;
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    const sentenceChunks = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
    const out = [];
    sentenceChunks.forEach((sentence) => {
      const part = String(sentence || '').trim();
      if (!part) return;
      if (part.length <= maxChunkLength) {
        out.push(part);
        return;
      }
      let buffer = part;
      while (buffer.length > maxChunkLength) {
        out.push(buffer.slice(0, maxChunkLength));
        buffer = buffer.slice(maxChunkLength).trim();
      }
      if (buffer) out.push(buffer);
    });
    return out;
  }

  stopSpeaking() {
    if (!this.supportsTts()) return;
    this.speakingSessionId = Date.now();
    this.synth.cancel();
    this.onStatus({ state: 'idle', text: '⏹ Voice gestoppt.' });
  }

  stopListening() {
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch {
      // no-op
    }
  }

  startListening({ lang = 'de-DE', onTranscript, onPartial } = {}) {
    if (!this.supportsStt()) {
      this.onError({ state: 'error', text: 'Speech-to-Text wird in diesem Browser nicht unterstützt.' });
      return;
    }

    this.stopListening();
    this.recognition = new this.SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    this.recognition.lang = String(lang || 'de-DE');

    this.recognition.onstart = () => this.onStatus({ state: 'listening', text: '🎤 Höre zu ...' });
    this.recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const snippet = String(result?.[0]?.transcript || '').trim();
        if (!snippet) continue;
        if (result.isFinal) {
          finalText += `${snippet} `;
        } else {
          interimText += `${snippet} `;
        }
      }

      const partial = interimText.trim();
      if (typeof onPartial === 'function') {
        onPartial(partial);
      }

      const finalTranscript = finalText.trim();
      if (typeof onTranscript === 'function' && finalTranscript) {
        onTranscript(finalTranscript);
      }
    };
    this.recognition.onerror = (event) => {
      this.onError({ state: 'error', text: `Speech-Fehler: ${event?.error || 'unknown'}` });
    };
    this.recognition.onend = () => this.onStatus({ state: 'idle', text: '🎤 Aufnahme beendet.' });

    this.recognition.start();
  }
}

class AssistantDevUi {
  constructor({ apiBase = '/assistant' } = {}) {
    this.apiBase = apiBase;
    this.state = {
      open: false,
      settingsOpen: false,
      mode: 'normal',
      userId: 'luna',
      messages: [],
      messagesByCharacter: {},
      loading: false,
      llmEnabled: null,
      lastAssistantText: '',
      lastUserText: '',
      selectedCharacter: 'luna',
      characters: [],
      conversationActive: false,
      awaitingConversationResume: false,
      liveTranscript: '',
      lastInputWasVoice: false,
      voice: {
        preset: 'egirl-cute',
        voiceName: '',
        lang: 'de-DE',
        rate: 1.03,
        pitch: 1.35,
        volume: 1.0,
        autoSpeak: false,
        autoLearn: true,
        ttsProvider: 'web-speech',
        sttProvider: 'web-speech',
        avatarProfileImage: 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl',
        speakOnlyInConversation: true,
        presets: [],
      },
      voiceProviders: {
        tts: [],
        stt: [],
      },
      avatarCatalog: [],
    };

    this.palette = {
      luna: 'linear-gradient(135deg,#ff8bd6,#8ea6ff)',
      eva: 'linear-gradient(135deg,#f59e0b,#facc15)',
      news: 'linear-gradient(135deg,#3b82f6,#60a5fa)',
      support: 'linear-gradient(135deg,#10b981,#34d399)',
    };

    this.voice = new VoiceInterface({
      onStatus: (event) => this.handleVoiceEvent(event, false),
      onError: (event) => this.handleVoiceEvent(event, true),
    });

    this.el = this.getElements();
    this.storage = {
      panelPrefs: 'assistant.panel.prefs',
      messagesByCharacter: 'assistant.messages.byCharacter',
    };
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
      charNameBtn: document.getElementById('charNameBtn'),
      avatarBtn: document.getElementById('avatarBtn'),
      settingsToggle: document.getElementById('settingsToggle'),
      closeBtn: document.getElementById('closeBtn'),
      overlay: document.getElementById('overlay'),
      avatarOverlay: document.getElementById('avatarOverlay'),
      avatarPreviewImage: document.getElementById('avatarPreviewImage'),
      charGrid: document.getElementById('charGrid'),
      closeOverlay: document.getElementById('closeOverlay'),
      closeAvatarOverlay: document.getElementById('closeAvatarOverlay'),
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
      voicePreset: document.getElementById('voicePreset'),
      voiceDevice: document.getElementById('voiceDevice'),
      voiceRate: document.getElementById('voiceRate'),
      voicePitch: document.getElementById('voicePitch'),
      voiceAutoSpeak: document.getElementById('voiceAutoSpeak'),
      voiceAutoLearn: document.getElementById('voiceAutoLearn'),
      voiceTtsProvider: document.getElementById('voiceTtsProvider'),
      voiceSttProvider: document.getElementById('voiceSttProvider'),
      voiceAvatarUrl: document.getElementById('voiceAvatarUrl'),
      btnVoiceListen: document.getElementById('btnVoiceListen'),
      btnVoiceSpeak: document.getElementById('btnVoiceSpeak'),
      btnVoiceStop: document.getElementById('btnVoiceStop'),
      btnVoiceSave: document.getElementById('btnVoiceSave'),
      btnConversation: document.getElementById('btnConversation'),
      conversationHint: document.getElementById('conversationHint'),
      conversationPfp: document.getElementById('conversationPfp'),
      trainingProfile: document.getElementById('trainingProfile'),
      voiceStatus: document.getElementById('voiceStatus'),
      opsOut: document.getElementById('opsOut'),
      adapterPathOut: document.getElementById('adapterPathOut'),
      adapterHintOut: document.getElementById('adapterHintOut'),
      ovHist: document.getElementById('ovHist'),
      ovUnc: document.getElementById('ovUnc'),
      ovMem: document.getElementById('ovMem'),
      ovMode: document.getElementById('ovMode'),
    };
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
    this.el.charName.textContent = this.state.selectedCharacter;
    this.applyAvatarProfileImage();
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
    this.savePanelPrefs();
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
    this.saveCurrentCharacterMessages();
    this.renderMessages();
  }

  savePanelPrefs() {
    try {
      window.localStorage.setItem(this.storage.panelPrefs, JSON.stringify({
        open: this.state.open,
        selectedCharacter: this.state.selectedCharacter,
      }));
    } catch {
      // ignore storage failures
    }
  }

  loadPanelPrefs() {
    try {
      const raw = window.localStorage.getItem(this.storage.panelPrefs);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.open === 'boolean') {
        this.state.open = parsed.open;
      }
      const storedCharacter = String(parsed?.selectedCharacter || '').trim().toLowerCase();
      if (storedCharacter) {
        this.state.selectedCharacter = storedCharacter;
      }
    } catch {
      // ignore storage failures
    }
  }

  loadMessagesStore() {
    try {
      const raw = window.localStorage.getItem(this.storage.messagesByCharacter);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.state.messagesByCharacter = parsed;
      }
    } catch {
      this.state.messagesByCharacter = {};
    }
  }

  persistMessagesStore() {
    try {
      window.localStorage.setItem(this.storage.messagesByCharacter, JSON.stringify(this.state.messagesByCharacter));
    } catch {
      // ignore storage failures
    }
  }

  normalizeStoredMessage(message = {}) {
    return {
      id: String(message?.id || `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      role: message?.role === 'user' ? 'user' : 'assistant',
      text: String(message?.text || ''),
      at: String(message?.at || new Date().toISOString()),
      meta: String(message?.meta || ''),
      feedback: ['up', 'down'].includes(message?.feedback) ? message.feedback : null,
    };
  }

  loadCurrentCharacterMessages() {
    const source = this.state.messagesByCharacter?.[this.state.selectedCharacter];
    if (!Array.isArray(source)) {
      this.state.messages = [];
      return;
    }
    this.state.messages = source.map((item) => this.normalizeStoredMessage(item));
  }

  saveCurrentCharacterMessages() {
    this.state.messagesByCharacter = {
      ...(this.state.messagesByCharacter || {}),
      [this.state.selectedCharacter]: [...this.state.messages],
    };
    this.persistMessagesStore();
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
      const roleClass = isUser ? 'user' : 'assistant';
      const roleLabel = isUser ? 'DU' : 'LUNA';
      const first = isUser ? 'U' : 'L';

      list.push(`
        <article class="message ${roleClass}" data-id="${message.id}" data-idx="${index}">
          <div class="msg-avatar">${first}</div>
          <div class="msg-stack">
            <div class="bubble">${this.escapeHtml(message.text)}</div>
            <div class="meta">${this.escapeHtml(roleLabel)} · ${new Date(message.at || Date.now()).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </article>
      `);
    });

    if (this.state.liveTranscript) {
      list.push(`
        <article class="message user interim">
          <div class="msg-avatar">U</div>
          <div class="msg-stack">
            <div class="bubble">${this.escapeHtml(this.state.liveTranscript)}</div>
            <div class="meta">DU · live</div>
          </div>
        </article>
      `);
    }

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
      if (this.el.ovHist) this.el.ovHist.textContent = Number(overview.historyCount || 0);
      if (this.el.ovUnc) this.el.ovUnc.textContent = Number(overview.uncensoredHistoryCount || 0);
      const memCount = Number(overview.goalsCount || 0) + Number(overview.notesCount || 0) + Number(overview.pinnedMemoriesCount || 0);
      if (this.el.ovMem) this.el.ovMem.textContent = memCount;
      if (this.el.ovMode) this.el.ovMode.textContent = settings?.settings?.mode || this.state.mode;

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

    const inputWasVoice = this.state.lastInputWasVoice === true;
    this.state.lastInputWasVoice = false;

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

      if (this.el.voiceAutoSpeak?.checked === true && this.state.conversationActive === true) {
        this.voice.speak(reply, this.getVoiceSettingsFromUi());
      }

      if (inputWasVoice && this.state.voice.autoLearn === true) {
        await this.api('/training/example', 'POST', {
          characterId: this.state.selectedCharacter,
          mode: this.state.mode,
          source: 'voice-conversation-auto',
          accepted: true,
          user: message,
          assistant: reply,
          userOriginal: message,
          assistantOriginal: reply,
        }).catch(() => {});
      }
    } catch (error) {
      this.appendMessage('assistant', `Fehler: ${error.message}`, 'fehler');
    } finally {
      this.state.loading = false;
      this.saveCurrentCharacterMessages();
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
    if (!this.el.opsOut) return;
    this.el.opsOut.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  }

  handleVoiceEvent(eventPayload, isError = false) {
    const isObject = eventPayload && typeof eventPayload === 'object';
    const text = isObject
      ? String(eventPayload.text || '').trim()
      : String(eventPayload || '').trim();
    const stateFromPayload = isObject ? String(eventPayload.state || '').trim().toLowerCase() : '';
    const state = (stateFromPayload || (isError ? 'error' : 'idle'));

    this.showOps(text || eventPayload);
    this.setVoiceUiState(state, text || (isError ? 'Voice-Fehler.' : 'Voice bereit'));

    if (
      state === 'idle'
      && this.state.conversationActive
      && this.state.awaitingConversationResume
      && !this.state.loading
    ) {
      this.state.awaitingConversationResume = false;
      window.setTimeout(() => this.startConversationTurn(), 180);
    }
  }

  setVoiceUiState(state = 'idle', text = '') {
    const normalized = ['idle', 'listening', 'speaking', 'error'].includes(state) ? state : 'idle';
    const label = String(text || '').trim() || '🎙️ Voice bereit';

    if (this.el.voiceStatus) {
      this.el.voiceStatus.textContent = label;
      this.el.voiceStatus.classList.remove('idle', 'listening', 'speaking', 'error');
      this.el.voiceStatus.classList.add(normalized);
    }

    if (this.el.btnVoiceListen) {
      this.el.btnVoiceListen.classList.toggle('listening', normalized === 'listening');
      this.el.btnVoiceListen.classList.toggle('speaking', normalized === 'speaking');
    }

    if (this.el.btnConversation) {
      this.el.btnConversation.classList.toggle('active', this.state.conversationActive === true);
      this.el.btnConversation.classList.toggle('listening', normalized === 'listening');
      this.el.btnConversation.classList.toggle('speaking', normalized === 'speaking');
    }

    if (this.el.avatarBtn) {
      this.el.avatarBtn.classList.remove('idle', 'listening', 'speaking');
      const nextState = this.state.conversationActive ? normalized : 'idle';
      this.el.avatarBtn.classList.add(nextState === 'error' ? 'idle' : nextState);
    }

    if (this.el.chatView) {
      this.el.chatView.classList.toggle('conversation-active', this.state.conversationActive === true);
    }

    if (this.el.conversationPfp) {
      this.el.conversationPfp.classList.remove('idle', 'listening', 'speaking');
      const nextState = this.state.conversationActive ? normalized : 'idle';
      this.el.conversationPfp.classList.add(nextState === 'error' ? 'idle' : nextState);
    }

    if (this.el.conversationHint) {
      const hint = this.state.conversationActive
        ? (normalized === 'speaking' ? 'Luna spricht…' : normalized === 'listening' ? 'Luna hört zu…' : 'Gespräch aktiv')
        : 'Gesprächsmodus starten';
      this.el.conversationHint.textContent = hint;
    }
  }

  canUseVoiceFeatures(showHint = true) {
    if (this.state.conversationActive) return true;
    if (showHint) {
      this.setVoiceUiState('idle', '🎙️ Sprache ist nur im Gesprächsmodus aktiv');
      this.showOps('Sprache ist nur im Gesprächsmodus aktiv. Starte erst ◉ Gesprächsmodus.');
    }
    return false;
  }

  startConversationTurn() {
    if (this.state.loading) return;
    if (!this.state.conversationActive) return;
    this.state.liveTranscript = '';
    this.voice.startListening({
      lang: this.state.voice.lang || 'de-DE',
      onPartial: (text) => {
        this.state.liveTranscript = String(text || '').trim();
        this.renderMessages();
      },
      onTranscript: async (text) => {
        const finalText = String(text || '').trim();
        this.state.liveTranscript = '';
        if (!finalText) {
          this.renderMessages();
          return;
        }
        this.state.lastInputWasVoice = true;
        this.el.chatInput.value = finalText;
        this.autosizeInput();
        this.renderMessages();
        await this.sendMessage();

        if (this.state.conversationActive) {
          const shouldSpeak = this.el.voiceAutoSpeak?.checked === true;
          if (shouldSpeak) {
            this.state.awaitingConversationResume = true;
          } else {
            window.setTimeout(() => this.startConversationTurn(), 180);
          }
        }
      },
    });
  }

  toggleConversationMode() {
    this.state.conversationActive = !this.state.conversationActive;
    if (!this.state.conversationActive) {
      this.voice.stopListening();
      this.voice.stopSpeaking();
      this.state.awaitingConversationResume = false;
      this.state.liveTranscript = '';
      this.setVoiceUiState('idle', '🎙️ Gespräch pausiert');
      this.renderMessages();
      return;
    }

    this.toggleSettings(false);
    this.setVoiceUiState('listening', '🎙️ Gespräch aktiv: spreche jetzt mit Luna');
    this.startConversationTurn();
  }

  renderAdapterPaths(training = null) {
    const paths = training?.lora?.adapterPaths || {};
    const active = String(paths.activeAdapterPath || '').trim() || '(kein aktiver Adapter)';
    const latest = String(paths.latestExpectedAdapterPath || '').trim() || '(kein letzter erwarteter Pfad)';
    const canAutoTrain = Boolean(training?.canAutoTrain);

    if (this.el.adapterPathOut) {
      this.el.adapterPathOut.textContent = `Active Adapter Path: ${active}\nLatest Expected Path: ${latest}`;
    }
    if (this.el.adapterHintOut) {
      this.el.adapterHintOut.textContent = canAutoTrain
        ? 'Auto Train: bereit'
        : 'Auto Train: noch nicht bereit (curated < minCurated)';
    }
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

  getVoiceSettingsFromUi() {
    return {
      characterId: this.state.selectedCharacter,
      preset: String(this.el.voicePreset?.value || this.state.voice.preset || 'egirl-cute'),
      voiceName: String(this.el.voiceDevice?.value || this.state.voice.voiceName || ''),
      ttsProvider: String(this.el.voiceTtsProvider?.value || this.state.voice.ttsProvider || 'web-speech'),
      sttProvider: String(this.el.voiceSttProvider?.value || this.state.voice.sttProvider || 'web-speech'),
      avatarProfileImage: String(this.el.voiceAvatarUrl?.value || this.state.voice.avatarProfileImage || 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl'),
      lang: this.state.voice.lang || 'de-DE',
      rate: Number(this.el.voiceRate?.value || this.state.voice.rate || 1.0),
      pitch: Number(this.el.voicePitch?.value || this.state.voice.pitch || 1.15),
      volume: 1.0,
      autoSpeak: this.el.voiceAutoSpeak?.checked === true,
    };
  }

  applyVoiceSettingsToUi(voice = {}) {
    this.state.voice = {
      ...this.state.voice,
      ...(voice || {}),
      presets: Array.isArray(voice?.presets) ? voice.presets : this.state.voice.presets,
    };

    if (this.el.voiceRate) this.el.voiceRate.value = String(this.state.voice.rate || 1.0);
    if (this.el.voicePitch) this.el.voicePitch.value = String(this.state.voice.pitch || 1.15);
    if (this.el.voiceAutoSpeak) this.el.voiceAutoSpeak.checked = this.state.voice.autoSpeak === true;
    if (this.el.voiceAvatarUrl) this.el.voiceAvatarUrl.value = String(this.state.voice.avatarProfileImage || 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl');
    if (this.el.voiceTtsProvider) this.el.voiceTtsProvider.value = String(this.state.voice.ttsProvider || 'web-speech');
    if (this.el.voiceSttProvider) this.el.voiceSttProvider.value = String(this.state.voice.sttProvider || 'web-speech');
    const savedAutoLearn = window.localStorage.getItem('luna.voice.autoLearn');
    if (savedAutoLearn != null) {
      this.state.voice.autoLearn = savedAutoLearn === 'true';
    }
    if (this.el.voiceAutoLearn) this.el.voiceAutoLearn.checked = this.state.voice.autoLearn === true;

    if (this.el.voicePreset) {
      const presets = Array.isArray(this.state.voice.presets) ? this.state.voice.presets : [];
      this.el.voicePreset.innerHTML = presets.map((preset) => `
        <option value="${this.escapeHtml(preset.id)}">${this.escapeHtml(preset.label || preset.id)}</option>
      `).join('');
      this.el.voicePreset.value = String(this.state.voice.preset || 'egirl-cute');
    }

    this.applyAvatarProfileImage();
  }

  applyAvatarProfileImage() {
    const fallback = 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl';
    const imageUrl = String(this.state.voice.avatarProfileImage || '').trim() || fallback;

    if (this.el.avatarPreviewImage) {
      this.el.avatarPreviewImage.src = imageUrl;
    }

    if (this.el.conversationPfp) {
      this.el.conversationPfp.src = imageUrl;
    }

    if (this.el.avatarBtn) {
      this.el.avatarBtn.textContent = '';
      this.el.avatarBtn.style.backgroundImage = `url('${imageUrl.replaceAll("'", "\\'")}')`;
      this.el.avatarBtn.style.backgroundSize = 'cover';
      this.el.avatarBtn.style.backgroundPosition = 'center';
      this.el.avatarBtn.style.backgroundRepeat = 'no-repeat';
    }
  }

  async loadVoiceProviders() {
    try {
      const out = await this.api('/voice/providers', 'GET');
      const providers = out?.providers || { tts: [], stt: [] };
      this.state.voiceProviders = {
        tts: Array.isArray(providers.tts) ? providers.tts : [],
        stt: Array.isArray(providers.stt) ? providers.stt : [],
      };

      if (this.el.voiceTtsProvider) {
        this.el.voiceTtsProvider.innerHTML = this.state.voiceProviders.tts
          .map((item) => `<option value="${this.escapeHtml(item.id)}">${this.escapeHtml(item.label || item.id)}</option>`)
          .join('');
      }

      if (this.el.voiceSttProvider) {
        this.el.voiceSttProvider.innerHTML = this.state.voiceProviders.stt
          .map((item) => `<option value="${this.escapeHtml(item.id)}">${this.escapeHtml(item.label || item.id)}</option>`)
          .join('');
      }
    } catch {
      this.state.voiceProviders = {
        tts: [{ id: 'web-speech', label: 'Browser Web Speech' }, { id: 'google-cloud-tts', label: 'Google Cloud TTS' }],
        stt: [{ id: 'web-speech', label: 'Browser Web Speech' }, { id: 'google-cloud-stt', label: 'Google Cloud STT' }],
      };
      if (this.el.voiceTtsProvider) {
        this.el.voiceTtsProvider.innerHTML = this.state.voiceProviders.tts
          .map((item) => `<option value="${this.escapeHtml(item.id)}">${this.escapeHtml(item.label || item.id)}</option>`)
          .join('');
      }
      if (this.el.voiceSttProvider) {
        this.el.voiceSttProvider.innerHTML = this.state.voiceProviders.stt
          .map((item) => `<option value="${this.escapeHtml(item.id)}">${this.escapeHtml(item.label || item.id)}</option>`)
          .join('');
      }
    }
  }

  async loadAvatarCatalog() {
    try {
      const out = await this.api('/avatars/catalog', 'GET');
      this.state.avatarCatalog = Array.isArray(out?.avatars) ? out.avatars : [];
    } catch {
      this.state.avatarCatalog = [];
    }
  }

  async refreshDeviceVoiceList() {
    if (!this.el.voiceDevice) return;
    const voices = await this.voice.loadVoices();
    const options = (Array.isArray(voices) ? voices : []).map((voice) => {
      const name = String(voice?.name || 'unknown');
      const lang = String(voice?.lang || 'unknown');
      return `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)} (${this.escapeHtml(lang)})</option>`;
    }).join('');
    this.el.voiceDevice.innerHTML = options || '<option value="">(keine TTS-Stimme gefunden)</option>';
    if (this.state.voice.voiceName) {
      this.el.voiceDevice.value = this.state.voice.voiceName;
    }
  }

  async loadVoiceConfig() {
    try {
      await this.loadVoiceProviders();
      await this.loadAvatarCatalog();
      const out = await this.api(`/voice/config?characterId=${encodeURIComponent(this.state.selectedCharacter)}`, 'GET');
      this.applyVoiceSettingsToUi(out?.voice || {});
      await this.refreshDeviceVoiceList();
    } catch {
      this.applyVoiceSettingsToUi({
        preset: 'egirl-cute',
        rate: 1.03,
        pitch: 1.35,
        autoSpeak: false,
        ttsProvider: 'web-speech',
        sttProvider: 'web-speech',
        avatarProfileImage: 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl',
        presets: [
          { id: 'egirl-cute', label: 'Cute E-Girl' },
          { id: 'warm-coach', label: 'Warm Coach' },
          { id: 'clear-pro', label: 'Clear Pro' },
        ],
      });
      await this.refreshDeviceVoiceList();
    }
  }

  async saveVoiceSettings() {
    const payload = this.getVoiceSettingsFromUi();
    const out = await this.api('/voice/settings', 'POST', payload);
    this.applyVoiceSettingsToUi(out?.voice || payload);
    this.showOps('Voice-Settings gespeichert');
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

        const selectedProfile = String(this.el.trainingProfile?.value || 'auto').trim();
        this.showOps(await this.api('/training/lora/start-smart', 'POST', {
          characterId: this.state.selectedCharacter,
          mode: this.state.mode,
          profile: selectedProfile,
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
        await this.loadVoiceConfig();
        this.showOps('Settings + Training Status aktualisiert');
        return;
      }
      if (action === 'voiceSave') {
        await this.saveVoiceSettings();
        return;
      }
      if (action === 'voiceSpeak') {
        if (!this.canUseVoiceFeatures()) return;
        const text = String(this.state.lastAssistantText || '').trim();
        if (!text) {
          this.showOps('Keine Assistant-Antwort zum Vorlesen vorhanden.');
          return;
        }
        this.voice.speak(text, this.getVoiceSettingsFromUi());
        return;
      }
      if (action === 'voiceStop') {
        this.voice.stopSpeaking();
        return;
      }
      if (action === 'voiceListen') {
        if (!this.canUseVoiceFeatures()) return;
        this.state.liveTranscript = '';
        this.voice.startListening({
          lang: this.state.voice.lang || 'de-DE',
          onPartial: (text) => {
            this.state.liveTranscript = String(text || '').trim();
            this.renderMessages();
          },
          onTranscript: (text) => {
            this.state.liveTranscript = '';
            this.el.chatInput.value = String(text || '').trim();
            this.autosizeInput();
            this.renderMessages();
          },
        });
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

  openAvatarOverlay() {
    this.el.avatarOverlay?.classList.add('open');
  }

  closeAvatarOverlay() {
    this.el.avatarOverlay?.classList.remove('open');
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
      this.appendMessage(
        'assistant',
        this.state.mode === 'uncensored'
          ? 'Uncensored Mode aktiv.'
          : 'Zurück im Normalmodus.',
        'mode gewechselt',
      );
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

    bindClick(this.el.fab, () => this.togglePanel());
    bindClick(this.el.closeBtn, () => this.togglePanel(false));
    bindClick(this.el.settingsToggle, () => this.toggleSettings(true));
    bindClick(this.el.tabChat, () => this.toggleSettings(false));
    bindClick(this.el.tabSettings, () => this.toggleSettings(true));
    bindClick(this.el.modeToggle, () => this.toggleMode());
    bindClick(this.el.sendBtn, () => this.sendMessage());

    this.el.chatInput?.addEventListener('input', () => this.autosizeInput());
    this.el.chatInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.sendMessage();
      }
    });

    this.el.chatScroll?.addEventListener('click', (event) => {
      this.handleMessageAction(event.target);
    });

    bindClick(this.el.btnReset, () => this.runSettingsAction('reset'));
    bindClick(this.el.btnRefresh, () => this.runSettingsAction('refresh'));
    bindClick(this.el.btnDeleteDay, () => this.runSettingsAction('deleteDay'));
    bindClick(this.el.btnDelete7Days, () => this.runSettingsAction('delete7Days'));
    bindClick(this.el.btnDeleteMonth, () => this.runSettingsAction('deleteMonth'));
    bindClick(this.el.btnEnsureTrainer, () => this.runSettingsAction('ensureTrainer'));
    bindClick(this.el.btnVoiceSave, () => this.runSettingsAction('voiceSave'));
    bindClick(this.el.btnVoiceSpeak, () => this.runSettingsAction('voiceSpeak'));
    bindClick(this.el.btnVoiceStop, () => this.runSettingsAction('voiceStop'));
    bindClick(this.el.btnVoiceListen, () => this.runSettingsAction('voiceListen'));
    bindClick(this.el.btnConversation, () => this.toggleConversationMode());
    bindClick(this.el.btnExampleAdapter, () => this.runSettingsAction('exampleAdapter'));

    if (this.el.voicePreset) {
      this.el.voicePreset.addEventListener('change', () => {
        const selected = String(this.el.voicePreset.value || '').trim();
        const presets = Array.isArray(this.state.voice.presets) ? this.state.voice.presets : [];
        const match = presets.find((preset) => String(preset?.id || '') === selected);
        if (!match) return;
        if (this.el.voiceRate) this.el.voiceRate.value = String(match?.settings?.rate ?? this.el.voiceRate.value);
        if (this.el.voicePitch) this.el.voicePitch.value = String(match?.settings?.pitch ?? this.el.voicePitch.value);
      });
    }

    if (this.el.voiceAutoLearn) {
      this.el.voiceAutoLearn.addEventListener('change', () => {
        const enabled = this.el.voiceAutoLearn.checked === true;
        this.state.voice.autoLearn = enabled;
        window.localStorage.setItem('luna.voice.autoLearn', enabled ? 'true' : 'false');
        this.showOps(enabled ? '🧠 Auto-Learn Voice aktiv' : '🧠 Auto-Learn Voice pausiert');
      });
    }

    this.el.avatarBtn?.addEventListener('click', () => this.openAvatarOverlay());
    this.el.charNameBtn?.addEventListener('click', () => this.openCharacterOverlay());
    this.el.closeOverlay?.addEventListener('click', () => this.closeCharacterOverlay());
    this.el.closeAvatarOverlay?.addEventListener('click', () => this.closeAvatarOverlay());
    this.el.overlay?.addEventListener('click', (event) => {
      if (event.target === this.el.overlay) {
        this.closeCharacterOverlay();
      }
    });

    this.el.avatarOverlay?.addEventListener('click', (event) => {
      if (event.target === this.el.avatarOverlay) {
        this.closeAvatarOverlay();
      }
    });

    this.el.charGrid?.addEventListener('click', async (event) => {
      const item = event.target.closest('[data-char]');
      if (!item) return;

      this.state.selectedCharacter = item.getAttribute('data-char');
      this.applyCharacterUi();
      this.renderCharacters();
      this.closeCharacterOverlay();
      this.loadCurrentCharacterMessages();
      this.renderMessages();
      this.savePanelPrefs();
      await this.refreshModeAndStatus();
      await this.loadVoiceConfig();
    });
  }

  async init() {
    this.loadPanelPrefs();
    this.loadMessagesStore();
    this.wireEvents();
    this.togglePanel(this.state.open);
    this.setModeUi();
    this.applyCharacterUi();
    await this.loadCharacters();
    this.loadCurrentCharacterMessages();
    this.renderMessages();
    await this.refreshModeAndStatus();
    await this.refreshTrainingStatus();
    await this.refreshInfraStatus();
    await this.loadVoiceConfig();
    if (this.el.voiceAutoSpeak) this.el.voiceAutoSpeak.checked = true;
    if (this.el.voiceAutoLearn && this.el.voiceAutoLearn.checked == null) {
      this.el.voiceAutoLearn.checked = this.state.voice.autoLearn === true;
    }
    this.applyAvatarProfileImage();
    this.setVoiceUiState('idle', '🎙️ Voice bereit');

    if (!this.state.messages.length) {
      this.appendMessage('assistant', 'Hi ✨ Ich bin bereit. Tippe unten oder nutze 🎤 für Spracheingabe.', 'bereit');
    }
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
