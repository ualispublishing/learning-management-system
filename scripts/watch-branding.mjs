import { watchFile, unwatchFile } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Poll only the four inputs: tolerates atomic replacements and OS watcher limits. */
export function watchBranding(root = process.cwd()) {
  const files = ['institution-logo.png', 'institution-primary.png', 'institution-secondary.png', 'institution.json'].map(name => path.join(root, name));
  let timer, child, pending = false, closed = false;
  const run = () => {
    if (closed) return;
    if (child) { pending = true; return; }
    child = spawn(process.execPath, ['scripts/sync-branding.mjs'], { cwd: root, stdio: 'inherit' });
    child.on('error', error => console.error(`Branding refresh could not start: ${error.message}`));
    child.on('close', () => { child = undefined; if (pending) { pending = false; run(); } });
  };
  const onChange = () => {
    clearTimeout(timer); timer = setTimeout(run, 500);
  };
  files.forEach(file => watchFile(file, { interval: 750 }, onChange));
  return () => { closed = true; clearTimeout(timer); files.forEach(file => unwatchFile(file, onChange)); child?.kill('SIGTERM'); };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stop = watchBranding();
  console.log('Watching institution logo, colour swatches and name. Save files to refresh branding.');
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });
}
