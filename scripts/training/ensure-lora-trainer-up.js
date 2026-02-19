import { spawnSync } from 'child_process';

function parseTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function hasDocker() {
  const result = spawnSync('docker', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return Number(result.status) === 0;
}

function runDockerComposeUp({ withBuild = false } = {}) {
  const args = ['compose', '-f', 'docker-compose.lora-trainer.yml', 'up', '-d'];
  if (withBuild) {
    args.push('--build');
  }
  return spawnSync('docker', args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
}

function main() {
  if (parseTruthy(process.env.ASSISTANT_SKIP_TRAINER_AUTOSTART)) {
    console.log('[lora:trainer:ensure] ASSISTANT_SKIP_TRAINER_AUTOSTART=true -> überspringe Trainer-Autostart.');
    process.exit(0);
  }

  if (!hasDocker()) {
    console.warn('[lora:trainer:ensure] Docker nicht gefunden. Überspringe Trainer-Start; Dev UI startet trotzdem.');
    process.exit(0);
  }

  const withBuild = parseTruthy(process.env.ASSISTANT_TRAINER_BUILD_ON_START);
  const result = runDockerComposeUp({ withBuild });
  if (Number(result.status) !== 0) {
    console.warn('[lora:trainer:ensure] Docker Compose konnte nicht gestartet werden. Dev UI startet trotzdem.');
    process.exit(0);
  }

  console.log(`[lora:trainer:ensure] LoRA Trainer läuft (docker compose up -d${withBuild ? ' --build' : ''}).`);
}

main();
