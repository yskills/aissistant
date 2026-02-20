function ensureTrailingSlashless(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function createAssistantApiClient({
  baseUrl = '/assistant',
  fetchImpl = globalThis.fetch,
  defaultHeaders = {},
} = {}) {
  const root = ensureTrailingSlashless(baseUrl || '/assistant');

  if (typeof fetchImpl !== 'function') {
    throw new Error('createAssistantApiClient requires a fetch implementation.');
  }

  async function request(path, { method = 'GET', body = null, headers = {} } = {}) {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...defaultHeaders,
        ...(headers || {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok === false) {
      throw new Error(json?.error?.message || `HTTP ${response.status}`);
    }
    return json;
  }

  return {
    request,

    getBrief(characterId = 'luna') {
      return request(`/brief${buildQuery({ characterId })}`);
    },

    reset(characterId = 'luna') {
      return request('/reset', { method: 'POST', body: { characterId } });
    },

    getSettings(characterId = 'luna') {
      return request(`/settings${buildQuery({ characterId })}`);
    },

    updateSettings({ characterId = 'luna', patch = {} } = {}) {
      return request('/settings', { method: 'POST', body: { characterId, ...(patch || {}) } });
    },

    setProfile({ characterId = 'luna', preferredName = '' } = {}) {
      return request('/profile', { method: 'POST', body: { characterId, preferredName } });
    },

    getMode(characterId = 'luna') {
      return request(`/mode${buildQuery({ characterId })}`);
    },

    setMode({ characterId = 'luna', mode = 'normal', password = '' } = {}) {
      return request('/mode', { method: 'POST', body: { characterId, mode, password } });
    },

    getModeExtras(characterId = 'luna') {
      return request(`/mode-extras${buildQuery({ characterId })}`);
    },

    setModeExtras({ characterId = 'luna', instructions = [], memories = [] } = {}) {
      return request('/mode-extras', {
        method: 'POST',
        body: { characterId, instructions, memories },
      });
    },

    async toggleMode({ characterId = 'luna', password = '' } = {}) {
      const current = await this.getMode(characterId);
      const nextMode = current?.mode === 'normal' ? 'uncensored' : 'normal';
      return this.setMode({ characterId, mode: nextMode, password });
    },

    webSearchPreview({ characterId = 'luna', message = '' } = {}) {
      return request('/web-search/preview', {
        method: 'POST',
        body: { characterId, message },
      });
    },

    addFeedback(payload = {}) {
      return request('/feedback', { method: 'POST', body: payload || {} });
    },

    addTrainingExample(payload = {}) {
      return request('/training/example', { method: 'POST', body: payload || {} });
    },

    pruneMemory(payload = {}) {
      return request('/memory/prune', { method: 'POST', body: payload || {} });
    },

    deleteMemoryByDate(payload = {}) {
      return request('/memory/delete-date', { method: 'POST', body: payload || {} });
    },

    deleteMemoryRecent(payload = {}) {
      return request('/memory/delete-recent', { method: 'POST', body: payload || {} });
    },

    deleteMemoryByTag(payload = {}) {
      return request('/memory/delete-tag', { method: 'POST', body: payload || {} });
    },

    deleteMemoryItem(payload = {}) {
      return request('/memory/delete-item', { method: 'POST', body: payload || {} });
    },

    chat(payload = {}) {
      return request('/chat', { method: 'POST', body: payload || {} });
    },

    getCharacters() {
      return request('/characters');
    },

    getVoiceConfig(characterId = 'luna') {
      return request(`/voice/config${buildQuery({ characterId })}`);
    },

    getVoiceSettings(characterId = 'luna') {
      return request(`/voice/settings${buildQuery({ characterId })}`);
    },

    setVoiceSettings(payload = {}) {
      return request('/voice/settings', { method: 'POST', body: payload || {} });
    },

    getLunaPresets() {
      return request('/luna/presets');
    },

    applyLunaPreset(payload = {}) {
      return request('/luna/presets/apply', { method: 'POST', body: payload || {} });
    },

    ingestLunaSignal(payload = {}) {
      return request('/luna/ingest', { method: 'POST', body: payload || {} });
    },

    trainPrepare() {
      return request('/training/prepare', { method: 'POST', body: {} });
    },

    trainAuto(minCurated = 20) {
      return request('/training/auto', { method: 'POST', body: { minCurated } });
    },

    trainStatus(minCurated = 20) {
      return request(`/training/status${buildQuery({ minCurated })}`);
    },

    trainLoraConfig() {
      return request('/training/lora/config');
    },

    trainLoraProviderHealth() {
      return request('/training/lora/provider-health');
    },

    trainLoraProfiles() {
      return request('/training/lora/profiles');
    },

    trainLoraEnsureTrainer(payload = {}) {
      return request('/training/lora/trainer/ensure', { method: 'POST', body: payload || {} });
    },

    trainLoraStart(payload = {}) {
      return request('/training/lora/start', { method: 'POST', body: payload || {} });
    },

    trainLoraStartSmart(payload = {}) {
      return request('/training/lora/start-smart', { method: 'POST', body: payload || {} });
    },

    trainLoraStatus(jobId = '') {
      return request(`/training/lora/status${buildQuery({ jobId })}`);
    },

    createExampleAdapter(payload = {}) {
      return request('/training/lora/example-adapter', { method: 'POST', body: payload || {} });
    },

    trainLoraQuickStart(payload = {}) {
      return request('/training/lora/quick-start', { method: 'POST', body: payload || {} });
    },
  };
}

export default createAssistantApiClient;
