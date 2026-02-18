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

    getMode(characterId = 'luna') {
      return request(`/mode${buildQuery({ characterId })}`);
    },

    setMode({ characterId = 'luna', mode = 'normal', password = '' } = {}) {
      return request('/mode', { method: 'POST', body: { characterId, mode, password } });
    },

    async toggleMode({ characterId = 'luna', password = '' } = {}) {
      const current = await this.getMode(characterId);
      const nextMode = current?.mode === 'normal' ? 'uncensored' : 'normal';
      return this.setMode({ characterId, mode: nextMode, password });
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

    trainLoraStart(payload = {}) {
      return request('/training/lora/start', { method: 'POST', body: payload || {} });
    },

    trainLoraStatus(jobId = '') {
      return request(`/training/lora/status${buildQuery({ jobId })}`);
    },

    createExampleAdapter(payload = {}) {
      return request('/training/lora/example-adapter', { method: 'POST', body: payload || {} });
    },
  };
}

export default createAssistantApiClient;
