import { spawnSync } from 'child_process';
import path from 'path';

const projectRoot = process.cwd();

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

  runStep('Eval gate', 'npm', ['run', 'eval:gate']);
  runStep('Export dataset', 'npm', ['run', 'train:export']);

  const finishedAt = new Date().toISOString();
  const mergedPath = path.resolve(projectRoot, 'data', 'training', 'assistant-sft.jsonl');
  const curatedPath = path.resolve(projectRoot, 'data', 'training', 'assistant-sft-curated.jsonl');

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
