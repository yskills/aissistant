import { resolveRuntimeConfig } from '../config/runtimeConfig.js';

function trimTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function trimLeadingSlash(value = '') {
  return String(value || '').replace(/^\/+/, '');
}

function parseJsonSafe(raw, fallbackValue = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

export class LoraTrainingGateway {
  constructor({ env = process.env, cwd = process.cwd(), runtime = null } = {}) {
    this.runtime = runtime || resolveRuntimeConfig({ env, cwd });
    this.config = this.runtime.lora || {};
  }

  getPublicConfig() {
    return {
      enabled: !!this.config.enabled,
      provider: this.config.provider || 'generic-http',
      apiBaseUrl: this.config.apiBaseUrl || '',
      startPath: this.config.startPath || '/jobs',
      statusPathTemplate: this.config.statusPathTemplate || '/jobs/{jobId}',
      outputDir: this.config.outputDir || '',
      defaultBaseModel: this.config.defaultBaseModel || '',
      defaultAdapterName: this.config.defaultAdapterName || 'luna-adapter',
      defaultDatasetTier: this.config.defaultDatasetTier || 'curated',
      defaults: {
        learningRate: Number(this.config.learningRate || 0.0002),
        epochs: Number(this.config.epochs || 3),
        batchSize: Number(this.config.batchSize || 2),
        rank: Number(this.config.rank || 16),
        alpha: Number(this.config.alpha || 32),
        dropout: Number(this.config.dropout || 0.05),
      },
    };
  }

  validateReady() {
    if (!this.config.enabled) {
      throw new Error('LoRA interface disabled. Set ASSISTANT_LORA_ENABLED=true.');
    }
    if (!this.config.apiBaseUrl) {
      throw new Error('Missing ASSISTANT_LORA_API_BASE_URL for LoRA interface.');
    }
  }

  buildUrl(pathValue = '') {
    const base = trimTrailingSlash(this.config.apiBaseUrl || '');
    const localPath = trimLeadingSlash(pathValue || '');
    return `${base}/${localPath}`;
  }

  buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  defaultHyperparameters() {
    return {
      learningRate: Number(this.config.learningRate || 0.0002),
      epochs: Number(this.config.epochs || 3),
      batchSize: Number(this.config.batchSize || 2),
      rank: Number(this.config.rank || 16),
      alpha: Number(this.config.alpha || 32),
      dropout: Number(this.config.dropout || 0.05),
    };
  }

  async startJob({
    datasetPath,
    datasetTier = null,
    baseModel = '',
    adapterName = '',
    hyperparameters = {},
    metadata = {},
  } = {}) {
    this.validateReady();

    const payload = {
      provider: this.config.provider || 'generic-http',
      datasetPath: String(datasetPath || '').trim(),
      datasetTier: String(datasetTier || this.config.defaultDatasetTier || 'curated').toLowerCase(),
      baseModel: String(baseModel || this.config.defaultBaseModel || '').trim(),
      adapterName: String(adapterName || this.config.defaultAdapterName || 'luna-adapter').trim(),
      outputDir: String(this.config.outputDir || '').trim(),
      hyperparameters: {
        ...this.defaultHyperparameters(),
        ...(hyperparameters || {}),
      },
      metadata: {
        source: '@luna/assistant-core',
        timestamp: new Date().toISOString(),
        adapterOutputDir: String(this.config.outputDir || '').trim(),
        ...(metadata || {}),
      },
    };

    if (!payload.datasetPath) {
      throw new Error('LoRA start requires datasetPath.');
    }

    const url = this.buildUrl(this.config.startPath || '/jobs');
    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    const responseJson = parseJsonSafe(responseText, null);

    if (!response.ok) {
      throw new Error(`LoRA job start failed (${response.status}): ${responseText.slice(0, 500)}`);
    }

    const jobId = String(
      responseJson?.jobId
      || responseJson?.id
      || responseJson?.job_id
      || '',
    ).trim();

    return {
      ok: true,
      request: payload,
      response: responseJson || { raw: responseText },
      jobId,
    };
  }

  async getJobStatus(jobId = '') {
    this.validateReady();

    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) {
      throw new Error('LoRA status requires jobId.');
    }

    const template = this.config.statusPathTemplate || '/jobs/{jobId}';
    const statusPath = template.replace('{jobId}', encodeURIComponent(normalizedJobId));
    const url = this.buildUrl(statusPath);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    const responseText = await response.text();
    const responseJson = parseJsonSafe(responseText, null);

    if (!response.ok) {
      throw new Error(`LoRA status failed (${response.status}): ${responseText.slice(0, 500)}`);
    }

    return {
      ok: true,
      jobId: normalizedJobId,
      response: responseJson || { raw: responseText },
    };
  }
}

export default LoraTrainingGateway;
