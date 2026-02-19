import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();

function safeRemove(targetPath) {
  if (!fs.existsSync(targetPath)) return false;
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function removePackageTarballs(baseDir) {
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.tgz')) continue;
    const filePath = path.join(baseDir, entry.name);
    fs.rmSync(filePath, { force: true });
    removed += 1;
  }
  return removed;
}

function main() {
  const removed = [];

  if (safeRemove(path.resolve(rootDir, '.cache'))) {
    removed.push('.cache/');
  }

  if (safeRemove(path.resolve(rootDir, 'coverage'))) {
    removed.push('coverage/');
  }

  const tarballs = removePackageTarballs(rootDir);
  if (tarballs > 0) {
    removed.push(`${tarballs} *.tgz`);
  }

  console.log(JSON.stringify({
    ok: true,
    removed,
    rootDir,
  }, null, 2));
}

main();
