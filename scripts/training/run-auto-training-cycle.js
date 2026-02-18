import { spawnSync } from 'child_process';

const DEFAULT_MIN_CURATED = Number(process.env.TRAIN_MIN_CURATED || 20);
const projectRoot = process.cwd();

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
  const minCurated = parseMinCurated(process.argv.slice(2));

  const exportResult = run('npm', ['run', 'train:export']);
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
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: 'not-enough-curated-samples',
      minCurated,
      curatedCount,
      startedAt,
      finishedAt: new Date().toISOString(),
      next: `Collect at least ${minCurated} curated examples, then run again.`,
    }, null, 2));
    return;
  }

  const prepareResult = run('npm', ['run', 'train:prepare']);
  const prepareStdout = String(prepareResult.stdout || '').trim();
  const prepareStderr = String(prepareResult.stderr || '').trim();

  if (prepareResult.status !== 0) {
    console.error(prepareStdout);
    console.error(prepareStderr);
    throw new Error(`train:prepare failed with exit code ${prepareResult.status}`);
  }

  console.log(JSON.stringify({
    ok: true,
    skipped: false,
    minCurated,
    curatedCount,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: 'training-prepared',
  }, null, 2));
}

main();
