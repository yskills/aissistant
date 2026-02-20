export function createLunaApiClient({ baseUrl = '/assistant' } = {}) {
  const root = String(baseUrl || '/assistant').replace(/\/+$/, '');

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${root}${path}`, {
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

  return {
    chatSend({ characterId = 'luna', mode = 'normal', message = '' } = {}) {
      return request('/chat', {
        method: 'POST',
        body: { characterId, mode, message: String(message || '') },
      });
    },

    settingsGet(characterId = 'luna') {
      return request(`/settings?characterId=${encodeURIComponent(characterId)}`);
    },

    modeGet(characterId = 'luna') {
      return request(`/mode?characterId=${encodeURIComponent(characterId)}`);
    },

    modeSet({ characterId = 'luna', mode = 'normal', password = '' } = {}) {
      return request('/mode', {
        method: 'POST',
        body: { characterId, mode, password },
      });
    },

    voiceConfig(characterId = 'luna') {
      return request(`/voice/config?characterId=${encodeURIComponent(characterId)}`);
    },

    voiceSettingsGet(characterId = 'luna') {
      return request(`/voice/settings?characterId=${encodeURIComponent(characterId)}`);
    },

    voiceSettingsSet(payload = {}) {
      return request('/voice/settings', {
        method: 'POST',
        body: payload,
      });
    },

    voiceProviders() {
      return request('/voice/providers');
    },

    avatarsCatalog() {
      return request('/avatars/catalog');
    },

    lunaPresets() {
      return request('/luna/presets');
    },

    applyLunaPreset(payload = {}) {
      return request('/luna/presets/apply', {
        method: 'POST',
        body: payload,
      });
    },

    webSearchPreview({ characterId = 'luna', message = '' } = {}) {
      return request('/web-search/preview', {
        method: 'POST',
        body: { characterId, message: String(message || '') },
      });
    },

    characters() {
      return request('/characters');
    },
  };
}
