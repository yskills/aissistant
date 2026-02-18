import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  assertFileExists,
  ensureDirectory,
  resolveRuntimeConfig,
} from '../../src/config/runtimeConfig.js';
import { LoraTrainingGateway } from '../../src/training/LoraTrainingGateway.js';

const runtime = resolveRuntimeConfig();

function parseBooleanFlag(argv = [], flag = '') {
  return argv.some((arg) => String(arg || '').trim().toLowerCase() === flag.toLowerCase());
}

function parseArgValue(argv = [], key = '', fallback = '') {
  const prefix = `${key}=`;
  const arg = argv.find((item) => String(item || '').startsWith(prefix));
  if (!arg) return fallback;
  return String(arg).slice(prefix.length).trim() || fallback;
}

function parseNumberArg(argv = [], key = '', fallback = 0, min = null) {
  const raw = parseArgValue(argv, key, '');
  if (String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (Number.isFinite(min)) return Math.max(min, parsed);
  return parsed;
}

function createTimestampToken(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function sanitizeName(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseBooleanOverride(argv = [], positiveFlag = '', negativeFlag = '', fallback = false) {
  if (parseBooleanFlag(argv, positiveFlag)) return true;
  if (parseBooleanFlag(argv, negativeFlag)) return false;
  return fallback;
}

function resolveAdapterName({
  explicitAdapterName = '',
  defaultAdapterName = 'luna-adapter',
  adapterStrategy = 'versioned',
  timestampToken = '',
} = {}) {
  const explicit = sanitizeName(explicitAdapterName);
  if (explicit) return explicit;

  const baseName = sanitizeName(defaultAdapterName) || 'luna-adapter';
  if (String(adapterStrategy || '').toLowerCase() === 'replace') {
    return baseName;
  }

  const token = sanitizeName(timestampToken) || createTimestampToken(new Date());
  return `${baseName}-${token}`;
}

function readJsonFileSafe(filePath, fallbackValue = {}) {
  if (!fs.existsSync(filePath)) return fallbackValue;
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return fallbackValue;
  }
}

function runStep(stepName, command, args = []) {
  const result = spawnSync(command, args, {
    cwd: runtime.scriptsWorkingDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(`${stepName} failed with exit code ${result.status}${stderr ? `: ${stderr.slice(-500)}` : stdout ? `: ${stdout.slice(-500)}` : ''}`);
  }

  return result;
}

function parseSummary(summaryPath) {
  assertFileExists(summaryPath, 'dataset summary file');
  const raw = fs.readFileSync(summaryPath, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function resolveDatasetByTier(summary = {}, datasetTier = 'curated') {
  const tier = String(datasetTier || 'curated').toLowerCase();
  const outputFiles = summary.outputFiles || {};
  const samples = summary.samples || {};

  if (tier === 'memory' || tier === 'memoryonly') {
    return {
      datasetTier: 'memoryOnly',
      datasetPath: outputFiles.memoryOnly,
      sampleCount: Number(samples.memoryOnly || 0),
    };
  }

  if (tier === 'merged' || tier === 'all') {
    return {
      datasetTier: 'merged',
      datasetPath: outputFiles.merged,
      sampleCount: Number(samples.merged || 0),
    };
  }

  return {
    datasetTier: 'curated',
    datasetPath: outputFiles.curated,
    sampleCount: Number(samples.curated || 0),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const startedAt = new Date().toISOString();

  const datasetTier = parseArgValue(args, '--datasetTier', runtime?.lora?.defaultDatasetTier || 'curated');
  const minCurated = parseNumberArg(args, '--minCurated', runtime.trainMinCurated || 20, 1);
  const skipEval = parseBooleanFlag(args, '--skipEval');
  const skipExport = parseBooleanFlag(args, '--skipExport');
  const dryRun = parseBooleanFlag(args, '--dryRun');

  const baseModel = parseArgValue(args, '--baseModel', runtime?.lora?.defaultBaseModel || '');
  const explicitAdapterName = parseArgValue(args, '--adapterName', '');
  const adapterStrategy = parseArgValue(args, '--adapterStrategy', runtime?.lora?.adapterStrategy || 'versioned');
  const autoPromote = parseBooleanOverride(args, '--promote', '--noPromote', Boolean(runtime?.lora?.autoPromote));
  const adapterName = resolveAdapterName({
    explicitAdapterName,
    defaultAdapterName: runtime?.lora?.defaultAdapterName || 'luna-adapter',
    adapterStrategy,
    timestampToken: createTimestampToken(new Date()),
  });

  const hyperparameters = {
    learningRate: parseNumberArg(args, '--learningRate', runtime?.lora?.learningRate || 0.0002),
    epochs: parseNumberArg(args, '--epochs', runtime?.lora?.epochs || 3, 1),
    batchSize: parseNumberArg(args, '--batchSize', runtime?.lora?.batchSize || 2, 1),
    rank: parseNumberArg(args, '--rank', runtime?.lora?.rank || 16, 1),
    alpha: parseNumberArg(args, '--alpha', runtime?.lora?.alpha || 32, 1),
    dropout: parseNumberArg(args, '--dropout', runtime?.lora?.dropout || 0.05, 0),
  };

  if (!skipEval) {
    runStep('Eval gate', runtime.npmCommand, ['run', 'eval:gate']);
  }

  if (!skipExport) {
    runStep('Dataset export', runtime.npmCommand, ['run', 'train:export']);
  }

  const summaryPath = path.resolve(runtime.trainingDir, 'assistant-sft-summary.json');
  const summary = parseSummary(summaryPath);
  const resolvedDataset = resolveDatasetByTier(summary, datasetTier);

  assertFileExists(resolvedDataset.datasetPath, `${resolvedDataset.datasetTier} dataset file`);

  const curatedCount = Number(summary?.samples?.curated || 0);
  if (curatedCount < minCurated) {
    const skipped = {
      ok: true,
      skipped: true,
      reason: 'not-enough-curated-samples',
      minCurated,
      curatedCount,
      datasetTier: resolvedDataset.datasetTier,
      datasetPath: resolvedDataset.datasetPath,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(skipped, null, 2));
    return;
  }

  if (resolvedDataset.sampleCount < 1) {
    throw new Error(`Dataset tier ${resolvedDataset.datasetTier} has no samples.`);
  }

  const gateway = new LoraTrainingGateway({ runtime });
  const adapterOutputDir = String(runtime?.lora?.outputDir || '').trim();
  const expectedAdapterPath = adapterOutputDir
    ? path.resolve(adapterOutputDir, adapterName)
    : '';

  const report = {
    ok: true,
    skipped: false,
    dryRun,
    startedAt,
    finishedAt: null,
    lora: {
      config: gateway.getPublicConfig(),
      datasetTier: resolvedDataset.datasetTier,
      datasetPath: resolvedDataset.datasetPath,
      sampleCount: resolvedDataset.sampleCount,
      baseModel,
      adapterName,
      adapterStrategy,
      autoPromote,
      expectedAdapterPath,
      hyperparameters,
      result: null,
    },
  };

  if (!dryRun) {
    const result = await gateway.startJob({
      datasetPath: resolvedDataset.datasetPath,
      datasetTier: resolvedDataset.datasetTier,
      baseModel,
      adapterName,
      hyperparameters,
      metadata: {
        curatedCount,
      },
    });
    report.lora.result = result;
  }

  report.finishedAt = new Date().toISOString();

  ensureDirectory(runtime.trainingReportsDir);
  const reportFile = path.resolve(runtime.trainingReportsDir, 'lora-latest.json');
  const registryFile = String(runtime?.lora?.registryFile || '').trim()
    || path.resolve(runtime.trainingReportsDir, 'lora-adapters.json');

  ensureDirectory(path.dirname(registryFile));

  const registry = readJsonFileSafe(registryFile, {
    updatedAt: null,
    activeAdapter: '',
    adapters: [],
  });

  const adapters = Array.isArray(registry.adapters) ? registry.adapters : [];
  const entry = {
    adapterName,
    expectedAdapterPath,
    datasetTier: resolvedDataset.datasetTier,
    sampleCount: resolvedDataset.sampleCount,
    curatedCount,
    baseModel,
    adapterStrategy,
    autoPromote,
    dryRun,
    startedAt,
    finishedAt: report.finishedAt,
    jobId: String(report?.lora?.result?.jobId || ''),
    reportFile,
  };

  const filtered = adapters.filter((item) => String(item?.adapterName || '') !== adapterName);
  filtered.unshift(entry);

  const activeAdapter = autoPromote && !dryRun ? adapterName : String(registry.activeAdapter || '');
  const nextRegistry = {
    updatedAt: report.finishedAt,
    activeAdapter,
    adapters: filtered.slice(0, 100),
  };

  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(registryFile, `${JSON.stringify(nextRegistry, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ...report,
    reportFile,
    registryFile,
    activeAdapter,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
