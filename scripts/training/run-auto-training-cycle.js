import { spawnSync } from 'child_process';
import { resolveRuntimeConfig } from '../../src/config/runtimeConfig.js';

const runtime = resolveRuntimeConfig();
const DEFAULT_MIN_CURATED = Number(process.env.TRAIN_MIN_CURATED || runtime.trainMinCurated || 20);
const projectRoot = runtime.scriptsWorkingDir;

function hasFlag(argv = [], flag = '') {
  return argv.some((item) => String(item || '').trim().toLowerCase() === flag.toLowerCase());
}

function findArg(argv = [], key = '') {
  const prefix = `${key}=`;
  return argv.find((item) => String(item || '').startsWith(prefix)) || '';
}

function parseArgValue(argv = [], key = '', fallback = '') {
  const found = findArg(argv, key);
  if (!found) return fallback;
  return String(found).slice(String(`${key}=`).length).trim() || fallback;
}

function parseMinCurated(argv = []) {
  const arg = argv.find((item) => String(item || '').startsWith('--minCurated='));
  if (!arg) return DEFAULT_MIN_CURATED;
  const value = Number(String(arg).split('=')[1]);
  return Number.isFinite(value) && value >= 1 ? value : DEFAULT_MIN_CURATED;
}

function run(command, args = []) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

function parseLastJsonObject(text = '') {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // continue
    }
  }
  return null;
}

function main() {
  const startedAt = new Date().toISOString();
  const args = process.argv.slice(2);
  const minCurated = parseMinCurated(args);
  const skipEval = hasFlag(args, '--skipEval');
  const skipLora = hasFlag(args, '--skipLora');
  const loraDryRun = hasFlag(args, '--loraDryRun') || hasFlag(args, '--dryRun');

  const loraDatasetTier = parseArgValue(args, '--datasetTier', runtime?.lora?.defaultDatasetTier || 'curated');
  const loraBaseModel = parseArgValue(args, '--baseModel', runtime?.lora?.defaultBaseModel || '');
  const loraAdapterNameArg = findArg(args, '--adapterName');
  const loraAdapterName = loraAdapterNameArg
    ? parseArgValue(args, '--adapterName', '')
    : '';
  const loraAdapterStrategy = parseArgValue(args, '--adapterStrategy', runtime?.lora?.adapterStrategy || 'versioned');

  const quality = {
    evaluated: false,
    skipped: Boolean(skipEval),
    reason: skipEval ? 'skipEval-flag' : '',
  };

  if (!skipEval) {
    const evalResult = run(runtime.npmCommand, ['run', 'eval:gate']);
    const evalStdout = String(evalResult.stdout || '').trim();
    const evalStderr = String(evalResult.stderr || '').trim();

    if (evalResult.status !== 0) {
      console.error(evalStdout);
      console.error(evalStderr);
      throw new Error(`eval:gate failed with exit code ${evalResult.status}`);
    }

    quality.evaluated = true;
  }

  const exportResult = run(runtime.npmCommand, ['run', 'train:export']);
  const exportStdout = String(exportResult.stdout || '').trim();
  const exportStderr = String(exportResult.stderr || '').trim();

  if (exportResult.status !== 0) {
    console.error(exportStdout);
    console.error(exportStderr);
    throw new Error(`train:export failed with exit code ${exportResult.status}`);
  }

  const parsedSummary = parseLastJsonObject(exportStdout);
  const curatedCount = Number(parsedSummary?.samples?.curated ?? 0);

  if (!Number.isFinite(curatedCount) || curatedCount < minCurated) {
    const loraEnabled = Boolean(runtime?.lora?.enabled);
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: 'not-enough-curated-samples',
      minCurated,
      curatedCount,
      quality,
      lora: {
        requested: loraEnabled,
        enabled: loraEnabled,
        skipped: true,
        reason: 'not-enough-curated-samples',
      },
      startedAt,
      finishedAt: new Date().toISOString(),
      next: `Collect at least ${minCurated} curated examples, then run again.`,
    }, null, 2));
    return;
  }

  const prepareResult = run(runtime.npmCommand, ['run', 'train:prepare']);
  const prepareStdout = String(prepareResult.stdout || '').trim();
  const prepareStderr = String(prepareResult.stderr || '').trim();

  if (prepareResult.status !== 0) {
    console.error(prepareStdout);
    console.error(prepareStderr);
    throw new Error(`train:prepare failed with exit code ${prepareResult.status}`);
  }

  const loraEnabled = Boolean(runtime?.lora?.enabled);
  const loraRequested = loraEnabled && !skipLora;
  const lora = {
    requested: loraRequested,
    enabled: loraEnabled,
    skipped: false,
    reason: '',
    dryRun: loraDryRun,
    datasetTier: loraDatasetTier,
    adapterName: loraAdapterName || runtime?.lora?.defaultAdapterName || 'luna-adapter',
    adapterStrategy: loraAdapterStrategy,
    baseModel: loraBaseModel || runtime?.lora?.defaultBaseModel || '',
    reportFile: '',
  };

  if (loraEnabled && skipLora) {
    lora.skipped = true;
    lora.reason = 'skipLora-flag';
  }

  if (!loraEnabled) {
    lora.skipped = true;
    lora.reason = 'lora-disabled';
  }

  if (loraRequested) {
    const loraArgs = ['run', 'train:lora', '--', '--skipEval', '--skipExport', `--minCurated=${minCurated}`, `--datasetTier=${loraDatasetTier}`];

    if (loraAdapterName) {
      loraArgs.push(`--adapterName=${loraAdapterName}`);
    }

    if (loraAdapterStrategy) {
      loraArgs.push(`--adapterStrategy=${loraAdapterStrategy}`);
    }

    if (loraBaseModel) {
      loraArgs.push(`--baseModel=${loraBaseModel}`);
    }

    const passthroughKeys = ['--learningRate', '--epochs', '--batchSize', '--rank', '--alpha', '--dropout'];
    for (const key of passthroughKeys) {
      const raw = findArg(args, key);
      if (raw) loraArgs.push(raw);
    }

    if (loraDryRun) {
      loraArgs.push('--dryRun');
    }

    const loraResult = run(runtime.npmCommand, loraArgs);
    const loraStdout = String(loraResult.stdout || '').trim();
    const loraStderr = String(loraResult.stderr || '').trim();

    if (loraResult.status !== 0) {
      console.error(loraStdout);
      console.error(loraStderr);
      throw new Error(`train:lora failed with exit code ${loraResult.status}`);
    }

    const loraSummary = parseLastJsonObject(loraStdout);
    lora.reportFile = String(loraSummary?.reportFile || '').trim();
    lora.skipped = Boolean(loraSummary?.skipped);
    lora.reason = String(loraSummary?.reason || '').trim();
    lora.jobId = String(loraSummary?.lora?.result?.jobId || '').trim();
  }

  console.log(JSON.stringify({
    ok: true,
    skipped: false,
    minCurated,
    curatedCount,
    quality,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: loraRequested ? 'training-and-lora-submitted' : 'training-prepared',
    lora,
  }, null, 2));
}

main();
