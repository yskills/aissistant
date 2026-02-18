import fs from 'fs';
import path from 'path';

function resolvePath(baseDir, maybePath, fallbackSegments = []) {
  const candidate = String(maybePath || '').trim();
  if (candidate) {
    return path.isAbsolute(candidate)
      ? candidate
      : path.resolve(baseDir, candidate);
  }
  return path.resolve(baseDir, ...fallbackSegments);
}

function toNumber(value, fallback, { min = null, max = null } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const minBound = Number.isFinite(min) ? Math.max(min, parsed) : parsed;
  return Number.isFinite(max) ? Math.min(max, minBound) : minBound;
}

function toBoolean(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function resolveRuntimeConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const rootDir = path.resolve(cwd, String(env.ASSISTANT_BASE_DIR || '.'));
  const memoryDir = resolvePath(rootDir, env.ASSISTANT_MEMORY_DIR, ['data']);
  const reportsDir = resolvePath(rootDir, env.ASSISTANT_REPORTS_DIR, ['reports']);
  const evalReportsDir = resolvePath(rootDir, env.ASSISTANT_EVAL_REPORT_DIR, ['reports', 'eval']);
  const trainingReportsDir = resolvePath(rootDir, env.ASSISTANT_TRAINING_REPORT_DIR, ['reports', 'training']);
  const trainingDir = resolvePath(rootDir, env.ASSISTANT_TRAINING_DIR, ['data', 'training']);
  const loraOutputDir = resolvePath(rootDir, env.ASSISTANT_LORA_OUTPUT_DIR, ['data', 'adapters']);
  const loraRegistryFile = resolvePath(rootDir, env.ASSISTANT_LORA_REGISTRY_FILE, ['reports', 'training', 'lora-adapters.json']);

  const localConfigPath = path.resolve(rootDir, 'config', 'assistant-mode-config.local.json');
  const defaultConfigPath = path.resolve(rootDir, 'config', 'assistant-mode-config.example.json');
  const fallbackConfigPath = fs.existsSync(localConfigPath) ? localConfigPath : defaultConfigPath;

  const modeConfigFile = resolvePath(rootDir, env.ASSISTANT_MODE_CONFIG_FILE, [path.relative(rootDir, fallbackConfigPath)]);

  return {
    rootDir,
    memoryDir,
    memorySqliteFile: resolvePath(rootDir, env.ASSISTANT_MEMORY_FILE, [path.relative(rootDir, memoryDir), 'assistant-memory.sqlite']),
    memoryKey: String(env.ASSISTANT_MEMORY_KEY || 'assistant-memory').trim() || 'assistant-memory',
    modeConfigFile,
    evalConfigFile: resolvePath(rootDir, env.ASSISTANT_EVAL_CONFIG_FILE, ['config', 'eval', 'gate.config.json']),
    reportsDir,
    evalReportsDir,
    trainingReportsDir,
    trainingDir,
    npmCommand: String(env.ASSISTANT_NPM_COMMAND || 'npm').trim() || 'npm',
    scriptsWorkingDir: resolvePath(rootDir, env.ASSISTANT_WORKING_DIR, ['.']),
    trainMinCurated: toNumber(env.TRAIN_MIN_CURATED, 20, { min: 1 }),
    lora: {
      enabled: toBoolean(env.ASSISTANT_LORA_ENABLED, false),
      provider: String(env.ASSISTANT_LORA_PROVIDER || 'generic-http').trim().toLowerCase(),
      apiBaseUrl: String(env.ASSISTANT_LORA_API_BASE_URL || '').trim(),
      apiKey: String(env.ASSISTANT_LORA_API_KEY || '').trim(),
      startPath: String(env.ASSISTANT_LORA_START_PATH || '/jobs').trim() || '/jobs',
      statusPathTemplate: String(env.ASSISTANT_LORA_STATUS_PATH_TEMPLATE || '/jobs/{jobId}').trim() || '/jobs/{jobId}',
      outputDir: loraOutputDir,
      registryFile: loraRegistryFile,
      adapterStrategy: String(env.ASSISTANT_LORA_ADAPTER_STRATEGY || 'versioned').trim().toLowerCase(),
      autoPromote: toBoolean(env.ASSISTANT_LORA_AUTO_PROMOTE, true),
      defaultBaseModel: String(env.ASSISTANT_LORA_BASE_MODEL || '').trim(),
      defaultAdapterName: String(env.ASSISTANT_LORA_ADAPTER_NAME || 'luna-adapter').trim() || 'luna-adapter',
      defaultDatasetTier: String(env.ASSISTANT_LORA_DATASET_TIER || 'curated').trim().toLowerCase(),
      learningRate: toNumber(env.ASSISTANT_LORA_LEARNING_RATE, 0.0002, { min: 0.0000001 }),
      epochs: toNumber(env.ASSISTANT_LORA_EPOCHS, 3, { min: 1 }),
      batchSize: toNumber(env.ASSISTANT_LORA_BATCH_SIZE, 2, { min: 1 }),
      rank: toNumber(env.ASSISTANT_LORA_RANK, 16, { min: 1 }),
      alpha: toNumber(env.ASSISTANT_LORA_ALPHA, 32, { min: 1 }),
      dropout: toNumber(env.ASSISTANT_LORA_DROPOUT, 0.05, { min: 0, max: 1 }),
    },
  };
}

export function assertFileExists(filePath, label = 'file') {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

export function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
