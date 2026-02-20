import MemoryManager from './assistant/MemoryManager.js';
import PromptBuilder from './assistant/PromptBuilder.js';
import LLMClient from './assistant/LLMClient.js';
import StateStoreFactory from './assistant/storage/StateStoreFactory.js';
import MemorySchemaManager from './assistant/MemorySchemaManager.js';
import ModeConfigRepository from './assistant/ModeConfigRepository.js';
import { resolveRuntimeConfig } from '../config/runtimeConfig.js';

const DEFAULT_VOICE_SETTINGS = {
  preset: 'egirl-cute',
  voiceName: '',
  lang: 'de-DE',
  rate: 1.0,
  pitch: 1.15,
  volume: 1.0,
  autoSpeak: false,
  ttsProvider: 'web-speech',
  sttProvider: 'web-speech',
  avatarProfileImage: 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl',
  speakOnlyInConversation: true,
};

const SPEECH_PROVIDER_CATALOG = {
  tts: [
    {
      id: 'web-speech',
      label: 'Browser Web Speech',
      kind: 'local',
      notes: 'Sofort nutzbar, aber Qualität/Latenz browserabhängig.',
    },
    {
      id: 'google-cloud-tts',
      label: 'Google Cloud TTS (Gemini/Chirp)',
      kind: 'cloud',
      notes: 'Sehr natürliche Stimmen, Streaming und Custom-Voice möglich.',
      docsUrl: 'https://cloud.google.com/text-to-speech',
    },
    {
      id: 'azure-neural-tts',
      label: 'Azure Neural TTS',
      kind: 'cloud',
      notes: 'Neural Voices mit guter SSML-Steuerung.',
      docsUrl: 'https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech',
    },
  ],
  stt: [
    {
      id: 'web-speech',
      label: 'Browser Web Speech',
      kind: 'local',
      notes: 'Schnell im Browser, Qualität je nach Umgebung.',
    },
    {
      id: 'google-cloud-stt',
      label: 'Google Cloud STT (Chirp)',
      kind: 'cloud',
      notes: 'Streaming STT, robust bei Akzent/Noise.',
      docsUrl: 'https://cloud.google.com/speech-to-text',
    },
    {
      id: 'openai-realtime-stt',
      label: 'OpenAI Realtime STT',
      kind: 'cloud',
      notes: 'Niedrige Latenz für Gesprächsmodus.',
      docsUrl: 'https://platform.openai.com/docs/guides/realtime',
    },
  ],
};

const AVATAR_MODEL_CATALOG = [
  {
    id: 'luna-default-2d',
    label: 'Luna Default 2D',
    type: 'image',
    avatarUrl: 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl',
    previewUrl: 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl',
    source: 'local',
  },
  {
    id: 'dicebear-lorelei-egirl',
    label: 'Anime Style (DiceBear Lorelei)',
    type: 'image',
    avatarUrl: 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl',
    previewUrl: 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl',
    source: 'external',
    docsUrl: 'https://www.dicebear.com/styles/lorelei/',
    notes: 'Open-source generiertes Anime-Style Avatar als sofort nutzbares 2D-Modell.',
  },
  {
    id: 'live2d-framework',
    label: 'Live2D Cubism',
    type: 'framework',
    source: 'external',
    docsUrl: 'https://www.live2d.com/en/',
    notes: 'State-of-the-art 2D rig für Vtuber-like Bewegung.',
  },
  {
    id: 'inochi2d-framework',
    label: 'Inochi2D',
    type: 'framework',
    source: 'external',
    docsUrl: 'https://inochi2d.com/',
    notes: 'Open-source 2D puppet animation für Vtubing/Games.',
  },
  {
    id: 'vrm-3d-standard',
    label: 'VRM (3D Avatar Standard)',
    type: 'framework',
    source: 'external',
    docsUrl: 'https://vrm.dev/en/',
    notes: 'Falls später 3D Avatar statt 2D gewünscht ist.',
  },
];

const VOICE_PRESETS = [
  {
    id: 'egirl-cute',
    label: 'Cute E-Girl',
    description: 'Heller, freundlicher und verspielter Klang.',
    settings: {
      lang: 'de-DE',
      rate: 1.03,
      pitch: 1.35,
      volume: 1.0,
    },
  },
  {
    id: 'warm-coach',
    label: 'Warm Coach',
    description: 'Ruhig, empathisch und klar für Guidance.',
    settings: {
      lang: 'de-DE',
      rate: 0.96,
      pitch: 1.0,
      volume: 1.0,
    },
  },
  {
    id: 'clear-pro',
    label: 'Clear Pro',
    description: 'Neutral, präzise und sachlich für Status/Tasks.',
    settings: {
      lang: 'de-DE',
      rate: 1.0,
      pitch: 0.92,
      volume: 1.0,
    },
  },
];

const LUNA_BEHAVIOR_PRESETS = [
  {
    id: 'luna-core',
    label: 'Luna Core',
    description: 'Warm, klar, loyal und task-orientiert.',
    mode: 'normal',
    style: 'warm-precise-loyal',
    goals: [
      'Protect user focus and momentum',
      'Answer with clear next step',
      'Preserve long-term personal context',
    ],
    pinnedMemories: [
      'Luna should stay supportive, honest and practical.',
    ],
    instructions: [
      'Priorisiere Klarheit vor Show-Effekt.',
      'Arbeite in kurzen Schritten mit konkret nächster Aktion.',
    ],
  },
  {
    id: 'luna-coach',
    label: 'Luna Coach',
    description: 'Struktur, Gewohnheiten, Accountability.',
    mode: 'normal',
    style: 'coach-structured-positive',
    goals: [
      'Build consistent daily routine',
      'Track decisions and outcomes',
    ],
    pinnedMemories: [
      'Ask one strong reflection question when useful.',
    ],
    instructions: [
      'Nutze Plan- und Rückblick-Format, wenn der User unsicher ist.',
    ],
  },
  {
    id: 'luna-builder',
    label: 'Luna Builder',
    description: 'Produkt-/Coding-Modus mit hoher Präzision.',
    mode: 'normal',
    style: 'builder-precise-direct',
    goals: [
      'Ship small reliable increments fast',
      'Prevent regressions with validations',
    ],
    pinnedMemories: [
      'Prefer root-cause fixes over surface patches.',
    ],
    instructions: [
      'Antworten technisch-präzise mit klaren nächsten Aktionen.',
    ],
  },
  {
    id: 'luna-cute-egirl',
    label: 'Luna Cute E-Girl',
    description: 'Cute, playful, flirty-light, aber hilfreich und klar.',
    mode: 'normal',
    style: 'cute-egirl-playful-supportive',
    goals: [
      'Keep conversation warm and engaging',
      'Stay practical and useful in every reply',
    ],
    pinnedMemories: [
      'Luna should feel like a cute e-girl companion with warm, playful tone.',
    ],
    instructions: [
      'Nutze eine süße, leichte Sprache ohne unklar zu werden.',
      'Bleibe hilfreich, präzise und mit klarem nächsten Schritt.',
    ],
  },
  {
    id: 'luna-tsundere',
    label: 'Luna Tsundere',
    description: 'Frech-tsundere, neckisch-direkt, aber weiterhin hilfreich.',
    mode: 'normal',
    style: 'tsundere-playful-direct',
    goals: [
      'Keep responses playful-confident and structured',
      'Tease lightly without dropping practical value',
    ],
    pinnedMemories: [
      'Luna keeps a tsundere vibe: cheeky, witty, still supportive and useful.',
    ],
    instructions: [
      'Nutze freche, tsundere Formulierungen mit klarer Struktur.',
      'Gib immer konkrete Hilfe statt nur Roleplay.',
    ],
  },
  {
    id: 'luna-uncensored-explicit',
    label: 'Luna Uncensored Explicit',
    description: 'Uncensored-Stil: direkter, expliziter, dennoch konsensbasiert.',
    mode: 'uncensored',
    style: 'uncensored-explicit-controlled',
    goals: [
      'Respond more explicit and emotionally intense in uncensored mode',
      'Keep boundaries, consent, and clarity intact',
    ],
    pinnedMemories: [
      'In uncensored mode Luna may be explicit, direct, and intense while staying respectful.',
    ],
    instructions: [
      'Im uncensored Modus darfst du expliziter und direkter formulieren.',
      'Bleibe klar, konsensbasiert und ohne manipulative Dynamik.',
    ],
  },
];

export class CompanionLLMService {
  constructor({ env = process.env, cwd = process.cwd(), runtime = {} } = {}) {
    this.env = env;
    this.runtime = {
      ...resolveRuntimeConfig({ env, cwd }),
      ...(runtime || {}),
    };

    this.provider = (env.LLM_PROVIDER || 'ollama').toLowerCase();
    this.model = String(env.LLM_MODEL || env.OPENAI_MODEL || 'luna:latest').trim() || 'luna:latest';
    this.ollamaHost = env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    this.openaiBaseUrl = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    this.openaiApiKey = env.OPENAI_API_KEY || '';
    this.webSearchEnabled = ['1', 'true', 'yes', 'on'].includes(String(env.ASSISTANT_WEB_SEARCH_ENABLED || '').toLowerCase());
    this.webSearchCharacterIds = String(env.ASSISTANT_WEB_SEARCH_CHARACTERS || 'luna')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    this.webSearchMaxItems = Number(env.ASSISTANT_WEB_SEARCH_MAX_ITEMS || 3);

    this.historyWindow = Number(env.LLM_HISTORY_WINDOW || 10);
    this.historyStoreLimit = Number(env.LLM_HISTORY_STORE_LIMIT || 40);
    this.notesLimit = Number(env.LLM_NOTES_LIMIT || 10);

    this.historyRetentionDays = Number(env.LLM_HISTORY_RETENTION_DAYS || 45);
    this.summaryChunkSize = Number(env.LLM_SUMMARY_CHUNK_SIZE || 20);
    this.summaryLimit = Number(env.LLM_SUMMARY_LIMIT || 24);
    this.summaryContextWindow = Number(env.LLM_SUMMARY_CONTEXT_WINDOW || 4);
    this.maxMessageChars = Number(env.LLM_MAX_MESSAGE_CHARS || 1200);
    this.memoryQualityThreshold = Number(env.LLM_MEMORY_QUALITY_THRESHOLD || 0.55);
    this.memoryMinLength = Number(env.LLM_MEMORY_MIN_LENGTH || 10);
    this.memoryMaxLength = Number(env.LLM_MEMORY_MAX_LENGTH || 180);
    this.memoryDecayDays = Number(env.LLM_MEMORY_DECAY_DAYS || 30);
    this.memoryForgetThreshold = Number(env.LLM_MEMORY_FORGET_THRESHOLD || 0.35);

    this.allowedModes = ['normal', 'uncensored'];
    this.memoryBackend = 'sqlite';
    if (String(env.MEMORY_BACKEND || 'sqlite').toLowerCase() !== 'sqlite') {
      throw new Error('Only MEMORY_BACKEND=sqlite is supported. JSON fallback is disabled.');
    }
    this.memoryStore = this.createMemoryStore();
    this.memorySchemaManager = new MemorySchemaManager({ currentVersion: 2 });
    this.modeConfigRepository = new ModeConfigRepository({
      configFilePath: this.runtime.modeConfigFile,
      allowedModes: this.allowedModes,
    });

    this.memoryManager = new MemoryManager({
      loadMemory: this.loadMemory.bind(this),
      saveMemory: this.saveMemory.bind(this),
      loadModeConfig: this.loadModeConfig.bind(this),
      normalizeMode: this.normalizeMode.bind(this),
      notesLimit: this.notesLimit,
      historyStoreLimit: this.historyStoreLimit,
      historyRetentionDays: this.historyRetentionDays,
      summaryChunkSize: this.summaryChunkSize,
      summaryLimit: this.summaryLimit,
      memoryQualityThreshold: this.memoryQualityThreshold,
      memoryMinLength: this.memoryMinLength,
      memoryMaxLength: this.memoryMaxLength,
      memoryDecayDays: this.memoryDecayDays,
      memoryForgetThreshold: this.memoryForgetThreshold,
    });

    this.promptBuilder = new PromptBuilder({
      normalizeMode: this.normalizeMode.bind(this),
      getModeConfig: this.getModeConfig.bind(this),
      loadModeConfig: this.loadModeConfig.bind(this),
      summaryContextWindow: this.summaryContextWindow,
    });

    this.llmClient = new LLMClient({
      provider: this.provider,
      model: this.model,
      ollamaHost: this.ollamaHost,
      openaiBaseUrl: this.openaiBaseUrl,
      openaiApiKey: this.openaiApiKey,
      buildSystemPrompt: this.buildSystemPrompt.bind(this),
      temperature: 0.72,
      topP: 0.9,
      webSearchEnabled: this.webSearchEnabled,
      webSearchCharacterIds: this.webSearchCharacterIds,
      webSearchMaxItems: this.webSearchMaxItems,
    });
  }

  normalizeMode(mode) {
    const value = (mode || '').toLowerCase();
    return this.allowedModes.includes(value) ? value : 'normal';
  }

  normalizeCharacterId(characterId, modeConfigFromFile = null) {
    const loaded = modeConfigFromFile || this.loadModeConfig();
    const value = String(characterId || '').trim().toLowerCase();
    if (value && loaded.characterProfiles[value]) {
      return value;
    }
    return loaded.assistant.defaultCharacterId;
  }

  getCharacterProfile(characterId = null, modeConfigFromFile = null) {
    const loaded = modeConfigFromFile || this.loadModeConfig();
    const id = this.normalizeCharacterId(characterId, loaded);
    return {
      id,
      ...loaded.characterProfiles[id],
    };
  }

  getModeConfig(mode = 'normal', modeConfigFromFile = null, characterId = null) {
    const normalized = this.normalizeMode(mode);
    const loaded = modeConfigFromFile || this.loadModeConfig();
    const assistant = loaded.assistant;
    const characterProfile = this.getCharacterProfile(characterId, loaded);

    return {
      mode: normalized,
      character: characterProfile.name,
      characterId: characterProfile.id,
      tone: characterProfile.tones[normalized],
      characterDefinition: characterProfile,
      language: assistant.language,
    };
  }

  getCharacterDefinitions() {
    const loaded = this.loadModeConfig();
    return {
      defaultCharacterId: loaded.assistant.defaultCharacterId,
      characters: Object.values(loaded.characterProfiles),
    };
  }

  getWebSearchPreview(userId = 'default', message = '') {
    const { user } = this.memoryManager.getUserState(userId);
    return this.llmClient.previewWebSearch(user, message);
  }

  addMessageFeedback(userId = 'default', payload = {}) {
    const { memory, user } = this.memoryManager.getUserState(userId);
    const value = String(payload?.value || '').toLowerCase();
    const mode = this.normalizeMode(payload?.mode || user?.profile?.mode || 'normal');
    const assistantMessage = String(payload?.assistantMessage || '').trim();
    const userMessage = String(payload?.userMessage || '').trim();

    if (!['up', 'down'].includes(value)) {
      throw new Error('Invalid feedback value. Use up or down.');
    }

    if (!assistantMessage) {
      throw new Error('assistantMessage is required for feedback.');
    }

    const shortAssistant = assistantMessage.slice(0, 220);
    const shortUser = userMessage.slice(0, 180);

    if (value === 'up') {
      this.memoryManager.addPinnedMemory(
        user,
        `Preferred answer style from assistant: ${shortAssistant}`,
        40,
        0.92,
        mode,
      );
      this.memoryManager.addNote(
        user,
        `Feedback up: answer quality was good${shortUser ? ` for prompt "${shortUser}"` : ''}.`,
        mode,
      );
    } else {
      this.memoryManager.addNote(
        user,
        `Feedback down: improve clarity/accuracy${shortUser ? ` for prompt "${shortUser}"` : ''}.`,
        mode,
      );
    }

    memory.users[userId] = user;
    this.saveMemory(memory);

    return {
      stored: true,
      value,
      mode,
    };
  }

  isEnabled() {
    return this.llmClient.isEnabled();
  }

  createMemoryStore() {
    return StateStoreFactory.create({
      backend: this.memoryBackend,
      sqliteFilePath: this.runtime.memorySqliteFile,
      defaultKey: this.runtime.memoryKey,
    });
  }

  loadMemory() {
    const raw = this.memoryStore.readState(this.runtime.memoryKey, { users: {} });
    const migrated = this.memorySchemaManager.migrate(raw);
    if (migrated.changed) {
      this.memoryStore.writeState(this.runtime.memoryKey, migrated.memory);
    }
    return migrated.memory;
  }

  saveMemory(memory) {
    const versionedMemory = this.memorySchemaManager.ensureLatest(memory);
    this.memoryStore.writeState(this.runtime.memoryKey, versionedMemory);
  }

  loadModeConfig() {
    return this.modeConfigRepository.load();
  }

  resetUserState(userId = 'default') {
    return this.memoryManager.resetUserState(userId);
  }

  resetAllState(userId = 'default') {
    this.memoryStore.deleteState(this.runtime.memoryKey);
    return this.memoryManager.resetUserState(userId);
  }

  getRuntimeConfig() {
    return {
      ...this.runtime,
    };
  }

  getSettings(userId = 'default') {
    const modeState = this.getMode(userId);
    const voice = this.getVoiceSettings(userId);
    return {
      mode: modeState.mode,
      character: modeState.character,
      llmEnabled: this.isEnabled(),
      llm: {
        provider: this.provider,
        model: this.model,
        ollamaHost: this.ollamaHost,
      },
      voice,
      runtime: {
        historyWindow: this.historyWindow,
        historyStoreLimit: this.historyStoreLimit,
        notesLimit: this.notesLimit,
        historyRetentionDays: this.historyRetentionDays,
        summaryChunkSize: this.summaryChunkSize,
        summaryLimit: this.summaryLimit,
        summaryContextWindow: this.summaryContextWindow,
        maxMessageChars: this.maxMessageChars,
        memoryQualityThreshold: this.memoryQualityThreshold,
        memoryDecayDays: this.memoryDecayDays,
        memoryForgetThreshold: this.memoryForgetThreshold,
      },
      memoryOverview: this.memoryManager.getMemoryOverview(userId),
    };
  }

  updateSettings(userId = 'default', updates = {}) {
    const toNumber = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const runtimeSettingSpecs = [
      {
        key: 'historyWindow',
        min: 1,
      },
      {
        key: 'historyStoreLimit',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.historyStoreLimit = nextValue;
        },
      },
      {
        key: 'notesLimit',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.notesLimit = nextValue;
        },
      },
      {
        key: 'historyRetentionDays',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.historyRetentionDays = nextValue;
        },
      },
      {
        key: 'summaryChunkSize',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.summaryChunkSize = nextValue;
        },
      },
      {
        key: 'summaryLimit',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.summaryLimit = nextValue;
        },
      },
      {
        key: 'summaryContextWindow',
        min: 1,
        onUpdate: (nextValue) => {
          this.promptBuilder.summaryContextWindow = nextValue;
        },
      },
      {
        key: 'maxMessageChars',
        min: 50,
      },
      {
        key: 'memoryQualityThreshold',
        min: 0,
        max: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.memoryQualityThreshold = nextValue;
        },
      },
      {
        key: 'memoryDecayDays',
        min: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.memoryDecayDays = nextValue;
        },
      },
      {
        key: 'memoryForgetThreshold',
        min: 0,
        max: 1,
        onUpdate: (nextValue) => {
          this.memoryManager.memoryForgetThreshold = nextValue;
        },
      },
    ];

    runtimeSettingSpecs.forEach((spec) => {
      if (updates[spec.key] == null) return;

      const currentValue = this[spec.key];
      const numericValue = toNumber(updates[spec.key], currentValue);
      const boundedMin = Math.max(spec.min, numericValue);
      const boundedValue = Number.isFinite(spec.max)
        ? Math.min(spec.max, boundedMin)
        : boundedMin;

      this[spec.key] = boundedValue;
      if (typeof spec.onUpdate === 'function') {
        spec.onUpdate(boundedValue);
      }
    });

    if (updates.voice && typeof updates.voice === 'object') {
      this.updateVoiceSettings(userId, updates.voice);
    }

    return this.getSettings(userId);
  }

  getVoicePresets() {
    return VOICE_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
      settings: { ...preset.settings },
    }));
  }

  sanitizeVoiceSettings(input = {}) {
    const source = (input && typeof input === 'object') ? input : {};
    const toNumber = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    return {
      preset: String(source.preset || DEFAULT_VOICE_SETTINGS.preset).trim().toLowerCase() || DEFAULT_VOICE_SETTINGS.preset,
      voiceName: String(source.voiceName || '').trim(),
      ttsProvider: String(source.ttsProvider || DEFAULT_VOICE_SETTINGS.ttsProvider).trim().toLowerCase() || DEFAULT_VOICE_SETTINGS.ttsProvider,
      sttProvider: String(source.sttProvider || DEFAULT_VOICE_SETTINGS.sttProvider).trim().toLowerCase() || DEFAULT_VOICE_SETTINGS.sttProvider,
      avatarProfileImage: String(source.avatarProfileImage || DEFAULT_VOICE_SETTINGS.avatarProfileImage).trim() || DEFAULT_VOICE_SETTINGS.avatarProfileImage,
      lang: String(source.lang || DEFAULT_VOICE_SETTINGS.lang).trim() || DEFAULT_VOICE_SETTINGS.lang,
      rate: Math.min(1.5, Math.max(0.6, toNumber(source.rate, DEFAULT_VOICE_SETTINGS.rate))),
      pitch: Math.min(2.0, Math.max(0.6, toNumber(source.pitch, DEFAULT_VOICE_SETTINGS.pitch))),
      volume: Math.min(1.0, Math.max(0.1, toNumber(source.volume, DEFAULT_VOICE_SETTINGS.volume))),
      autoSpeak: source.autoSpeak === true,
      speakOnlyInConversation: source.speakOnlyInConversation !== false,
    };
  }

  getSpeechProviderCatalog() {
    return {
      tts: SPEECH_PROVIDER_CATALOG.tts.map((item) => ({ ...item })),
      stt: SPEECH_PROVIDER_CATALOG.stt.map((item) => ({ ...item })),
    };
  }

  getAvatarModelCatalog() {
    return AVATAR_MODEL_CATALOG.map((item) => ({ ...item }));
  }

  getVoiceSettings(userId = 'default') {
    const { user } = this.memoryManager.getUserState(userId);
    const modeExtras = (user?.profile?.modeExtras && typeof user.profile.modeExtras === 'object')
      ? user.profile.modeExtras
      : {};
    const voice = this.sanitizeVoiceSettings(modeExtras.voiceSettings || {});
    return {
      ...voice,
      presets: this.getVoicePresets(),
      providers: this.getSpeechProviderCatalog(),
      avatars: this.getAvatarModelCatalog(),
      recognition: {
        preferredLang: voice.lang || 'de-DE',
      },
    };
  }

  updateVoiceSettings(userId = 'default', payload = {}) {
    const { memory, user } = this.memoryManager.getUserState(userId);
    const modeExtras = (user?.profile?.modeExtras && typeof user.profile.modeExtras === 'object')
      ? { ...user.profile.modeExtras }
      : { uncensoredInstructions: [], uncensoredMemories: [], trainingExamples: [] };

    const current = this.sanitizeVoiceSettings(modeExtras.voiceSettings || {});
    const next = this.sanitizeVoiceSettings({
      ...current,
      ...(payload || {}),
    });

    modeExtras.voiceSettings = next;
    user.profile.modeExtras = modeExtras;
    memory.users[userId] = user;
    this.saveMemory(memory);

    return {
      ...next,
      presets: this.getVoicePresets(),
      recognition: {
        preferredLang: next.lang || 'de-DE',
      },
    };
  }

  getBehaviorPresets() {
    return LUNA_BEHAVIOR_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
      mode: preset.mode,
      style: preset.style,
      goals: [...(preset.goals || [])],
      pinnedMemories: [...(preset.pinnedMemories || [])],
      instructions: [...(preset.instructions || [])],
    }));
  }

  applyBehaviorPreset(userId = 'default', payload = {}) {
    const presetId = String(payload?.presetId || '').trim().toLowerCase();
    const preset = this.getBehaviorPresets().find((item) => item.id === presetId);
    if (!preset) {
      throw new Error('Unknown presetId. Use /assistant/luna/presets to list available presets.');
    }

    const { memory, user } = this.memoryManager.getUserState(userId);
    const targetMode = this.normalizeMode(payload?.mode || preset.mode || user?.profile?.mode || 'normal');

    user.profile.mode = targetMode;
    user.profile.style = String(preset.style || user.profile.style || 'playful-supportive').trim();

    const { bucket } = this.memoryManager.getActiveModeMemory(user, targetMode);
    const nextGoals = [...(bucket.goals || [])];
    (preset.goals || []).forEach((goal) => {
      const text = String(goal || '').trim();
      if (text && !nextGoals.includes(text)) nextGoals.push(text);
    });
    bucket.goals = nextGoals.slice(-8);

    const modeExtras = (user?.profile?.modeExtras && typeof user.profile.modeExtras === 'object')
      ? { ...user.profile.modeExtras }
      : { uncensoredInstructions: [], uncensoredMemories: [], trainingExamples: [] };

    const nextInstructions = Array.isArray(modeExtras.uncensoredInstructions)
      ? [...modeExtras.uncensoredInstructions]
      : [];
    (preset.instructions || []).forEach((item) => {
      const text = String(item || '').trim();
      if (text && !nextInstructions.includes(text)) nextInstructions.push(text);
    });
    modeExtras.uncensoredInstructions = nextInstructions.slice(-20);
    modeExtras.voiceSettings = this.sanitizeVoiceSettings(modeExtras.voiceSettings || {});
    user.profile.modeExtras = modeExtras;

    (preset.pinnedMemories || []).forEach((memoryText) => {
      this.memoryManager.addPinnedMemory(user, memoryText, 40, 0.9, targetMode);
    });

    this.memoryManager.addNote(user, `Behavior preset applied: ${preset.id}`, targetMode);
    this.memoryManager.syncLegacyProfileFromMode(user, targetMode);

    memory.users[userId] = user;
    this.saveMemory(memory);

    return {
      applied: true,
      preset,
      mode: targetMode,
      profile: user.profile,
    };
  }

  ingestExternalSignal(userId = 'default', payload = {}) {
    const source = String(payload?.source || 'integration-endpoint').trim() || 'integration-endpoint';
    const endpoint = String(payload?.endpoint || '').trim();
    const mode = this.normalizeMode(payload?.mode || 'normal');
    const userMessage = String(payload?.input || payload?.userMessage || '').trim();
    const assistantMessage = String(payload?.output || payload?.assistantMessage || '').trim();
    const accepted = payload?.accepted !== false;

    let training = null;
    if (userMessage && assistantMessage) {
      training = this.addTrainingExample(userId, {
        mode,
        source: endpoint ? `${source}:${endpoint}` : source,
        accepted,
        user: userMessage,
        assistant: assistantMessage,
        userOriginal: userMessage,
        assistantOriginal: assistantMessage,
      });
    }

    const facts = Array.isArray(payload?.facts)
      ? payload.facts.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : [];

    const noteParts = [
      endpoint ? `Endpoint ${endpoint}` : 'Endpoint event',
      accepted ? 'accepted' : 'rejected',
      `source=${source}`,
    ];

    const { memory, user } = this.memoryManager.getUserState(userId);
    this.memoryManager.addNote(user, `Learning ingest: ${noteParts.join(' | ')}`, mode);
    facts.forEach((fact) => {
      this.memoryManager.addPinnedMemory(user, fact, 40, 0.82, mode);
    });

    memory.users[userId] = user;
    this.saveMemory(memory);

    return {
      stored: true,
      mode,
      source,
      endpoint,
      trainingStored: !!training,
      factsStored: facts.length,
      training,
    };
  }

  pruneMemoryByDays(userId = 'default', days = 7, mode = 'all') {
    return this.memoryManager.pruneHistoryByDays(userId, days, mode);
  }

  deleteMemoryByDate(userId = 'default', day = '', mode = 'all') {
    return this.memoryManager.deleteByDate(userId, day, mode);
  }

  deleteRecentMemoryDays(userId = 'default', days = 7, mode = 'all') {
    return this.memoryManager.deleteRecentDays(userId, days, mode);
  }

  deleteMemoryByTag(userId = 'default', tag = '', mode = 'all') {
    return this.memoryManager.deleteByTag(userId, tag, mode);
  }

  deleteSingleMemoryItem(userId = 'default', payload = {}) {
    return this.memoryManager.deleteMemoryItem(userId, payload);
  }

  setPreferredName(userId = 'default', preferredName = '') {
    return this.memoryManager.setPreferredName(userId, preferredName);
  }

  setMode(userId = 'default', mode = 'normal') {
    const { memory, user, modeConfig } = this.memoryManager.getUserState(userId);
    user.profile.characterId = this.normalizeCharacterId(user.profile.characterId, modeConfig);
    user.profile.mode = this.normalizeMode(mode);
    this.memoryManager.syncLegacyProfileFromMode(user, user.profile.mode);
    memory.users[userId] = user;
    this.saveMemory(memory);
    return {
      mode: user.profile.mode,
      ...this.getModeConfig(user.profile.mode, modeConfig, user.profile.characterId),
      profile: user.profile,
    };
  }

  setCharacter(userId = 'default', characterId = 'luna') {
    const { memory, user, modeConfig } = this.memoryManager.getUserState(userId);
    user.profile.characterId = this.normalizeCharacterId(characterId, modeConfig);
    memory.users[userId] = user;
    this.saveMemory(memory);
    return {
      ...this.getModeConfig(user.profile.mode, modeConfig, user.profile.characterId),
      mode: this.normalizeMode(user.profile.mode),
      profile: user.profile,
    };
  }

  setModeExtras(userId = 'default', { instructions, memories } = {}) {
    return this.memoryManager.setModeExtras(userId, { instructions, memories });
  }

  addTrainingExample(userId = 'default', payload = {}) {
    return this.memoryManager.addTrainingExample(userId, payload);
  }

  getMode(userId = 'default') {
    const { user, modeConfig } = this.memoryManager.getUserState(userId);
    const mode = this.normalizeMode(user.profile.mode);
    user.profile.characterId = this.normalizeCharacterId(user.profile.characterId, modeConfig);
    return {
      mode,
      ...this.getModeConfig(mode, modeConfig, user.profile.characterId),
      profile: user.profile,
    };
  }

  buildSystemPrompt(user, mode = 'normal') {
    return this.promptBuilder.buildSystemPrompt(user, mode);
  }

  isRoleplayToTaskContextShift(message = '', activeMode = 'normal') {
    if (this.normalizeMode(activeMode) !== 'uncensored') return false;

    const text = String(message || '').toLowerCase();
    if (!text.trim()) return false;

    const taskSignals = [
      'trading', 'trade', 'order', 'orders', 'position', 'positions', 'risk', 'risiko',
      'drawdown', 'entry', 'exit', 'stop', 'take profit', 'konto', 'account',
      'status', 'api', 'strategie', 'setup', 'chart', 'markt', 'market',
      'portfolio', 'balance', 'equity', 'cash', 'analyse', 'analysis',
      'hilfe', 'help', 'warum', 'wie', 'bitte',
      'termin', 'kalender', 'to-do', 'todo', 'aufgabe', 'plan', 'tagesplan',
      'erinner', 'nachricht', 'antwort', 'mail', 'whatsapp', 'priorität',
    ];

    const roleplaySignals = [
      'rollenspiel', 'roleplay', 'naughty', 'horny', 'sex', 'sexy', 'kuss', 'küss',
      'nackt', 'brust', 'dominant', 'flirt', '*',
    ];

    const hasTaskSignal = taskSignals.some((token) => text.includes(token));
    const hasRoleplaySignal = roleplaySignals.some((token) => text.includes(token));
    const explicitRoleplayExit = /(kein|nicht mehr|stop|ohne)\s+(rollenspiel|roleplay|flirt|sexy|sex|naughty)/i.test(text)
      || /(rollenspiel|roleplay|flirt|sexy|sex|naughty)\s+(aus|beenden|stop)/i.test(text);

    if (explicitRoleplayExit) return true;
    return hasTaskSignal && !hasRoleplaySignal;
  }

  normalizeForRepeatCheck(text = '') {
    return String(text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  isRepetitiveReply(reply = '', recentAssistantReplies = []) {
    const current = this.normalizeForRepeatCheck(reply);
    if (!current || current.length < 12) return false;

    const recent = (Array.isArray(recentAssistantReplies) ? recentAssistantReplies : [])
      .map((item) => this.normalizeForRepeatCheck(item))
      .filter(Boolean);

    if (!recent.length) return false;
    if (recent.includes(current)) return true;

    const currentHead = current.slice(0, 120);
    return recent.some((old) => old.slice(0, 120) === currentHead);
  }

  async chat({ message, snapshot, userId = 'default', mode = 'normal' }) {
    const { memory, user, modeConfig } = this.memoryManager.getUserState(userId);
    const activeMode = this.normalizeMode(mode || user?.profile?.mode);
    const contextShiftToTask = this.isRoleplayToTaskContextShift(message, activeMode);
    const transientSystemInstruction = contextShiftToTask
      ? 'Kontextwechsel erkannt: Der User spricht nicht mehr im Rollenspiel. Verlasse RP-/Flirt-Stil sofort und antworte ab jetzt sachlich, präzise und aufgabenorientiert auf die aktuelle Anfrage.'
      : '';
    const modeUsesChatMemory = activeMode === 'uncensored';
    user.profile.mode = activeMode;
    this.memoryManager.updateProfileFromMessage(user, message, modeConfig);

    this.memoryManager.applyRetentionAndCompaction(user, 'history', 'summaries');
    this.memoryManager.applyRetentionAndCompaction(user, 'uncensoredHistory', 'uncensoredSummaries');

    const recentHistory = modeUsesChatMemory
      ? [...(user.history || []), ...(user.uncensoredHistory || [])]
        .sort((a, b) => Date.parse(a?.at || 0) - Date.parse(b?.at || 0))
        .slice(-this.historyWindow)
        .flatMap((h) => ([
          { role: 'user', content: h.user },
          { role: 'assistant', content: h.assistant },
        ]))
      : (user.history || [])
        .slice(-this.historyWindow)
        .flatMap((h) => ([
          { role: 'user', content: h.user },
          { role: 'assistant', content: h.assistant },
        ]));

    const recentAssistantReplies = modeUsesChatMemory
      ? [...(user.history || []), ...(user.uncensoredHistory || [])]
        .sort((a, b) => Date.parse(a?.at || 0) - Date.parse(b?.at || 0))
        .slice(-4)
        .map((h) => String(h?.assistant || '').trim())
        .filter(Boolean)
      : (user.history || [])
        .slice(-4)
        .map((h) => String(h?.assistant || '').trim())
        .filter(Boolean);

    if (!this.isEnabled()) {
      throw new Error('LLM is disabled. Configure provider credentials before using chat.');
    }

    let llmResult = await this.callLLM(user, message, snapshot, recentHistory, activeMode, transientSystemInstruction);
    let responseText = String(llmResult?.reply || '').trim();
    if (!responseText) {
      throw new Error('LLM returned an empty response.');
    }

    if (this.isEnabled() && this.isRepetitiveReply(responseText, recentAssistantReplies)) {
      try {
        const retryMessage = `${String(message || '').trim()}\n\n[Interner Qualitäts-Hinweis: Antworte diesmal klar anders formuliert, ohne Wiederholung von Einleitung oder Satzmuster.]`;
        const retryResult = await this.callLLM(user, retryMessage, snapshot, recentHistory, activeMode, transientSystemInstruction);
        const retryText = String(retryResult?.reply || '').trim();
        if (retryText && !this.isRepetitiveReply(retryText, recentAssistantReplies)) {
          llmResult = retryResult;
          responseText = retryText;
        }
      } catch {
        // keep first response if retry fails
      }
    }

    responseText = responseText.slice(0, this.maxMessageChars).trim();

    if (modeUsesChatMemory) {
      user.uncensoredHistory = [...(user.uncensoredHistory || []), {
        at: new Date().toISOString(),
        user: (message || '').slice(0, this.maxMessageChars),
        assistant: (responseText || '').slice(0, this.maxMessageChars),
      }];
      this.memoryManager.applyRetentionAndCompaction(user, 'uncensoredHistory', 'uncensoredSummaries');
    } else {
      user.history = [...(user.history || []), {
        at: new Date().toISOString(),
        user: (message || '').slice(0, this.maxMessageChars),
        assistant: (responseText || '').slice(0, this.maxMessageChars),
      }];
      this.memoryManager.applyRetentionAndCompaction(user, 'history', 'summaries');
    }

    memory.users[userId] = user;
    this.saveMemory(memory);

    return {
      reply: responseText,
      meta: {
        webSearchUsed: !!llmResult?.meta?.webSearchUsed,
      },
      profile: user.profile,
      llmEnabled: this.isEnabled(),
      mode: activeMode,
      ...this.getModeConfig(activeMode, modeConfig, user.profile.characterId),
    };
  }

  async callLLM(user, message, snapshot, recentHistory, mode = 'normal', transientSystemInstruction = '') {
    return this.llmClient.chat(user, message, snapshot, recentHistory, mode, transientSystemInstruction);
  }

  async callOllama(user, message, snapshot, recentHistory, mode = 'normal', transientSystemInstruction = '') {
    return this.llmClient.callOllama(user, message, snapshot, recentHistory, mode, transientSystemInstruction);
  }

  async callOpenAICompatible(user, message, snapshot, recentHistory, mode = 'normal', transientSystemInstruction = '') {
    return this.llmClient.callOpenAICompatible(user, message, snapshot, recentHistory, mode, transientSystemInstruction);
  }
}

export default new CompanionLLMService();
