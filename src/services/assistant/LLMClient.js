import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const WEB_SEARCH_TRIGGERS = [
  'aktuell', 'heute', 'news', 'neuigkeit', 'letzte', 'latest',
  'what happened', 'preis', 'kurs', 'market', 'märkte', 'fed', 'earnings',
  'internet', 'google', 'recherch', 'web', 'online',
  'wetter', 'weather', 'morgen', 'tomorrow', 'forecast', 'vorhersage',
];

const WEATHER_TRIGGERS = ['wetter', 'weather', 'forecast', 'vorhersage', 'temperatur'];

const WEB_CONTEXT_FETCH_FAILED = 'Web-Kontext: Websuche wurde angefragt, aber der Abruf ist fehlgeschlagen.';

const requireFromModule = createRequire(import.meta.url);

function buildRequireCandidates() {
  const candidates = [
    path.resolve(process.cwd(), 'package.json'),
    path.resolve(process.cwd(), 'backend', 'package.json'),
    path.resolve(process.cwd(), '..', 'backend', 'package.json'),
    path.resolve(process.cwd(), '..', 'package.json'),
  ];

  return candidates
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => createRequire(candidate));
}

const requireCandidates = buildRequireCandidates();

async function importFromHost(specifier = '') {
  const tryPaths = [];
  try {
    tryPaths.push(requireFromModule.resolve(specifier));
  } catch {
    // ignore
  }

  requireCandidates.forEach((resolver) => {
    try {
      tryPaths.push(resolver.resolve(specifier));
    } catch {
      // ignore
    }
  });

  for (const resolved of tryPaths) {
    try {
      return await import(resolved);
    } catch {
      // keep trying fallbacks
    }
  }

  throw new Error(`Cannot resolve module: ${specifier}`);
}

class LLMClient {
  constructor({
    provider,
    model,
    ollamaHost,
    openaiBaseUrl,
    openaiApiKey,
    buildSystemPrompt,
    temperature = 0.85,
    topP = 0.95,
    webSearchEnabled = false,
    webSearchCharacterIds = ['luna'],
    webSearchMaxItems = 3,
  } = {}) {
    this.provider = (provider || 'ollama').toLowerCase();
    this.model = model;
    this.ollamaHost = ollamaHost;
    this.openaiBaseUrl = openaiBaseUrl;
    this.openaiApiKey = openaiApiKey;
    this.buildSystemPrompt = buildSystemPrompt;
    this.temperature = temperature;
    this.topP = topP;
    this.webSearchEnabled = !!webSearchEnabled;
    this.webSearchCharacterIds = Array.isArray(webSearchCharacterIds)
      ? webSearchCharacterIds.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
      : ['luna'];
    this.webSearchMaxItems = Math.max(1, Number(webSearchMaxItems || 3));
    this.webSearchTimeoutMs = Math.max(3000, Number(process.env.ASSISTANT_WEB_SEARCH_TIMEOUT_MS || 9000));
  }

  isEnabled() {
    if (this.provider === 'ollama') {
      return true;
    }
    return !!this.openaiApiKey;
  }

  isWebSearchCharacterAllowed(user = null) {
    const characterId = String(user?.profile?.characterId || '').trim().toLowerCase();
    if (!this.webSearchCharacterIds.length) return true;
    if (this.webSearchCharacterIds.includes('*') || this.webSearchCharacterIds.includes('all')) return true;
    return !!characterId && this.webSearchCharacterIds.includes(characterId);
  }

  shouldUseWebSearch(message = '') {
    const text = String(message || '').toLowerCase();
    if (!text) return false;
    return WEB_SEARCH_TRIGGERS.some((trigger) => text.includes(trigger));
  }

  isWeatherQuery(message = '') {
    const text = String(message || '').toLowerCase();
    if (!text) return false;
    return WEATHER_TRIGGERS.some((trigger) => text.includes(trigger));
  }

  extractCityFromQuery(message = '') {
    const text = String(message || '').toLowerCase();
    const match = text.match(/(?:in|für|for)\s+([a-zäöüß\-\s]{2,40})/i);
    const city = String(match?.[1] || '').trim();
    if (!city) return 'Berlin';
    return city.replace(/\s+/g, ' ');
  }

  async fetchWeatherContext(message = '') {
    if (!this.isWeatherQuery(message)) return '';

    const city = this.extractCityFromQuery(message);
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=de&format=json`;
    const geoResponse = await fetch(geoUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!geoResponse.ok) return '';
    const geoData = await geoResponse.json();
    const location = Array.isArray(geoData?.results) ? geoData.results[0] : null;
    if (!location) return '';

    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(location.latitude)}&longitude=${encodeURIComponent(location.longitude)}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`;
    const weatherResponse = await fetch(forecastUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!weatherResponse.ok) return '';

    const weatherData = await weatherResponse.json();
    const daily = weatherData?.daily || {};
    const times = Array.isArray(daily.time) ? daily.time : [];
    const maxTemps = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
    const minTemps = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
    const rainProb = Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max : [];
    if (times.length < 2) return '';

    const idx = 1;
    return [
      `Wetter-Kontext (Open-Meteo) für ${location.name}, ${location.country}:`,
      `- Datum: ${times[idx]}`,
      `- Max: ${maxTemps[idx]}°C`,
      `- Min: ${minTemps[idx]}°C`,
      `- Regenwahrscheinlichkeit: ${rainProb[idx]}%`,
    ].join('\n');
  }

  previewWebSearch(user, message = '') {
    const query = String(message || '').trim();
    const enabled = !!this.webSearchEnabled;
    const explicitWebCommand = /\b(google|web|internet|recherch)\b/i.test(query);
    const characterAllowed = this.isWebSearchCharacterAllowed(user) || explicitWebCommand;
    const triggerMatched = this.shouldUseWebSearch(query);
    return {
      enabled,
      characterAllowed,
      triggerMatched,
      shouldSearch: enabled && characterAllowed && triggerMatched,
    };
  }

  normalizeWhitespace(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  stripHtml(value = '') {
    return this.normalizeWhitespace(String(value || '').replace(/<[^>]*>/g, ' '));
  }

  decodeHtmlEntities(value = '') {
    const input = String(value || '');
    const map = {
      '&amp;': '&',
      '&quot;': '"',
      '&#39;': "'",
      '&lt;': '<',
      '&gt;': '>',
      '&nbsp;': ' ',
    };
    const replaced = input.replace(/&(amp|quot|#39|lt|gt|nbsp);/g, (m) => map[m] || m);
    return replaced.replace(/&#(\d+);/g, (_m, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    });
  }

  normalizeDuckDuckGoUrl(url = '') {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, 'https://duckduckgo.com');
      const redirect = parsed.searchParams.get('uddg');
      if (redirect) return decodeURIComponent(redirect);
      return parsed.href;
    } catch {
      return raw;
    }
  }

  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.webSearchTimeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  parseDuckDuckGoHtml(html = '') {
    const source = String(html || '');
    if (!source) return [];

    const matches = [...source.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,1200}?<(?:a|div|span)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/gi)];
    return matches.slice(0, this.webSearchMaxItems).map((m) => {
      const link = this.normalizeDuckDuckGoUrl(this.decodeHtmlEntities(m[1] || ''));
      const title = this.stripHtml(this.decodeHtmlEntities(m[2] || ''));
      const snippet = this.stripHtml(this.decodeHtmlEntities(m[3] || ''));
      return {
        title,
        snippet,
        url: link,
      };
    }).filter((item) => item.title || item.snippet);
  }

  buildWebContextFromResults(results = [], sourceName = 'Web', query = '') {
    const nowUtc = new Date().toISOString();
    if (!Array.isArray(results) || !results.length) {
      return `Web-Kontext (${sourceName}):\n- Keine verwertbaren Live-Treffer für "${this.normalizeWhitespace(query)}".\n- Abrufzeit (UTC): ${nowUtc}`;
    }

    const lines = [`Web-Kontext (${sourceName}):`, `- Suchanfrage: ${this.normalizeWhitespace(query)}`, `- Abrufzeit (UTC): ${nowUtc}`];
    results.slice(0, this.webSearchMaxItems).forEach((item, idx) => {
      const title = this.normalizeWhitespace(item?.title || 'Ohne Titel');
      const snippet = this.normalizeWhitespace(item?.snippet || '');
      const url = this.normalizeWhitespace(item?.url || '');
      lines.push(`- [${idx + 1}] ${title}${snippet ? ` — ${snippet}` : ''}`);
      if (url) lines.push(`  Quelle: ${url}`);
    });
    return lines.join('\n');
  }

  async fetchWebContextFromDuckDuckGoHtml(message = '') {
    const query = this.normalizeWhitespace(String(message || '').slice(0, 280));
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) {
      throw new Error(`duckduckgo html failed: ${response.status}`);
    }
    const html = await response.text();
    const results = this.parseDuckDuckGoHtml(html);
    if (!results.length) {
      throw new Error('duckduckgo html yielded no parsed results');
    }
    return this.buildWebContextFromResults(results, 'DuckDuckGo HTML', query);
  }

  async fetchWebContextFromDuckDuckGoInstant(message = '') {
    const queryText = this.normalizeWhitespace(String(message || '').slice(0, 280));
    const query = encodeURIComponent(queryText);
    const url = `https://api.duckduckgo.com/?q=${query}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;

    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'KITradingAlpaca/assistant-web-context',
      },
    });

    if (!response.ok) {
      throw new Error(`duckduckgo instant failed: ${response.status}`);
    }

    const data = await response.json();
    const results = [];

    const heading = this.normalizeWhitespace(data?.Heading || '');
    const answer = this.normalizeWhitespace(data?.Answer || '');
    const abstract = this.normalizeWhitespace(data?.AbstractText || '');
    const sourceUrl = this.normalizeWhitespace(data?.AbstractURL || data?.Redirect || '');

    if (heading || answer || abstract) {
      results.push({
        title: heading || queryText,
        snippet: [answer, abstract].filter(Boolean).join(' '),
        url: sourceUrl,
      });
    }

    const topics = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [];
    for (const item of topics) {
      if (results.length >= this.webSearchMaxItems) break;
      const text = this.normalizeWhitespace(item?.Text || '');
      const firstUrl = this.normalizeWhitespace(item?.FirstURL || '');
      if (!text) continue;
      results.push({ title: text.slice(0, 96), snippet: text, url: firstUrl });
    }

    return this.buildWebContextFromResults(results, 'DuckDuckGo Instant API', queryText);
  }

  async fetchWebContext(message = '') {
    try {
      return await this.fetchWebContextFromDuckDuckGoHtml(message);
    } catch {
      return this.fetchWebContextFromDuckDuckGoInstant(message);
    }
  }

  async maybeGetWebContext(user, message) {
    const preview = this.previewWebSearch(user, message);
    if (!preview.shouldSearch) return '';

    try {
      const weatherContext = await this.fetchWeatherContext(message);
      if (weatherContext) return weatherContext;
      return await this.fetchWebContext(message);
    } catch {
      return WEB_CONTEXT_FETCH_FAILED;
    }
  }

  async chat(user, message, snapshot, recentHistory, mode = 'normal', transientSystemInstruction = '') {
    if (this.provider === 'ollama') {
      return this.callOllama(user, message, snapshot, recentHistory, mode, transientSystemInstruction);
    }
    return this.callOpenAICompatible(user, message, snapshot, recentHistory, mode, transientSystemInstruction);
  }

  async callOllama(user, message, snapshot, recentHistory, mode = 'normal', transientSystemInstruction = '') {
    let ollamaClient;
    try {
      const importCandidates = [
        () => requireFromModule('ollama'),
        ...requireCandidates.map((resolver) => () => resolver('ollama')),
      ];

      let imported = null;
      for (const load of importCandidates) {
        try {
          imported = load();
          if (imported) break;
        } catch {
          // try next
        }
      }

      ollamaClient = imported?.default || imported;
      if (!ollamaClient) {
        throw new Error('Ollama module unresolved');
      }
    } catch {
      throw new Error('Ollama package not installed. Run: npm i ollama in host project.');
    }

    process.env.OLLAMA_HOST = this.ollamaHost;
    const webContext = await this.maybeGetWebContext(user, message);

    const response = await ollamaClient.chat({
      model: this.model,
      messages: [
        { role: 'system', content: this.buildSystemPrompt(user, mode) },
        {
          role: 'system',
          content: `Kontext Snapshot: ${JSON.stringify(snapshot)}. User-Profil: ${JSON.stringify(user.profile)}.`,
        },
        ...(transientSystemInstruction ? [{ role: 'system', content: transientSystemInstruction }] : []),
        ...(webContext ? [{ role: 'system', content: webContext }] : []),
        ...recentHistory,
        { role: 'user', content: message },
      ],
      options: {
        temperature: this.temperature,
        top_p: this.topP,
      },
    });

    return {
      reply: response?.message?.content?.trim() || 'Ich habe gerade keine Antwort generieren können.',
      meta: {
        webSearchUsed: !!webContext,
      },
    };
  }

  async callOpenAICompatible(user, message, snapshot, recentHistory, mode = 'normal', transientSystemInstruction = '') {
    const webContext = await this.maybeGetWebContext(user, message);

    const payload = {
      model: this.model,
      temperature: this.temperature,
      messages: [
        { role: 'system', content: this.buildSystemPrompt(user, mode) },
        {
          role: 'system',
          content: `Kontext Snapshot: ${JSON.stringify(snapshot)}. User-Profil: ${JSON.stringify(user.profile)}.`,
        },
        ...(transientSystemInstruction ? [{ role: 'system', content: transientSystemInstruction }] : []),
        ...(webContext ? [{ role: 'system', content: webContext }] : []),
        ...recentHistory,
        { role: 'user', content: message },
      ],
    };

    const response = await fetch(`${this.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed with ${response.status}`);
    }

    const data = await response.json();
    return {
      reply: data?.choices?.[0]?.message?.content?.trim() || 'Ich habe gerade keine Antwort generieren können.',
      meta: {
        webSearchUsed: !!webContext,
      },
    };
  }
}

export default LLMClient;
