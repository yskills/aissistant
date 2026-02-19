import { spawnSync } from 'child_process';
import { resolveRuntimeConfig } from '../../src/config/runtimeConfig.js';

const runtime = resolveRuntimeConfig();

function hasFlag(argv = [], flag = '') {
  return argv.some((item) => String(item || '').trim().toLowerCase() === flag.toLowerCase());
}

function hasArgWithPrefix(argv = [], key = '') {
  const prefix = `${key}=`;
  return argv.some((item) => String(item || '').startsWith(prefix));
}

function run(command, args = []) {
  return spawnSync(command, args, {
    cwd: runtime.scriptsWorkingDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

function runOrThrow(stepName, command, args = []) {
  const result = run(command, args);
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();

  if (result.status !== 0) {
    if (stdout) console.error(stdout);
    if (stderr) console.error(stderr);
    throw new Error(`${stepName} failed with exit code ${result.status}`);
  }

  if (stdout) process.stdout.write(`${stdout}\n`);
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const ensureTrainer = hasFlag(args, '--ensureTrainer');

  if (ensureTrainer) {
    runOrThrow('lora:trainer:ensure', runtime.npmCommand, ['run', 'lora:trainer:ensure']);
  }

  const forwardArgs = [...args].filter((arg) => String(arg || '').trim().toLowerCase() !== '--ensuretrainer');

  if (!hasArgWithPrefix(forwardArgs, '--adapterName')) {
    forwardArgs.push('--adapterName=luna-adapter');
  }

  if (!hasArgWithPrefix(forwardArgs, '--adapterStrategy')) {
    forwardArgs.push('--adapterStrategy=versioned');
  }

  if (!hasArgWithPrefix(forwardArgs, '--datasetTier')) {
    forwardArgs.push('--datasetTier=curated');
  }

  const trainArgs = ['run', 'train:auto', '--', ...forwardArgs];
  runOrThrow('train:auto', runtime.npmCommand, trainArgs);
}

main();