import { spawnSync } from 'child_process';
import path from 'path';
import { resolveRuntimeConfig } from '../../src/config/runtimeConfig.js';

const runtime = resolveRuntimeConfig();
const projectRoot = runtime.scriptsWorkingDir;

function runStep(stepName, command, args = []) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    throw new Error(`${stepName} failed with exit code ${result.status}`);
  }
}

function main() {
  const startedAt = new Date().toISOString();

  runStep('Eval gate', runtime.npmCommand, ['run', 'eval:gate']);
  runStep('Export dataset', runtime.npmCommand, ['run', 'train:export']);

  const finishedAt = new Date().toISOString();
  const mergedPath = path.resolve(runtime.trainingDir, 'assistant-sft.jsonl');
  const curatedPath = path.resolve(runtime.trainingDir, 'assistant-sft-curated.jsonl');

  console.log(JSON.stringify({
    ok: true,
    startedAt,
    finishedAt,
    nextStep: 'Use assistant-sft-curated.jsonl for high-quality fine-tuning first.',
    files: {
      curated: curatedPath,
      merged: mergedPath,
    },
  }, null, 2));
}

main();
