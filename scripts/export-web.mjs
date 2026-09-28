import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expoExecutable = path.join(root, 'node_modules', '.bin', 'expo');
const result = spawnSync(expoExecutable, ['export', '--platform', 'web'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    LMS_ALLOW_INSECURE_LOCALHOST: '0',
  },
});

if (result.error) {
  console.error(`Expo web export could not start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
