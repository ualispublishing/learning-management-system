import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const failures = [];
const files = [];

const walk = async directory => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else if (entry.isFile()) files.push(fullPath);
  }
};

try {
  if (!(await stat(path.join(dist, 'index.html'))).isFile()) failures.push('dist/index.html is missing.');
  await walk(dist);
} catch {
  failures.push('The web export directory does not exist; run npm run build:web first.');
}

if (files.some(file => file.endsWith('.map'))) failures.push('Production export contains source-map files.');
const indexHtml = files.length ? await readFile(path.join(dist, 'index.html'), 'utf8') : '';
if (!/<script\s+src="\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js"\s+defer><\/script>/.test(indexHtml)) {
  failures.push('index.html does not load a hashed deferred Expo entry bundle.');
}
if (/<script(?!\s+src=)[^>]*>\s*[^<\s]/i.test(indexHtml)) failures.push('index.html contains executable inline script.');

for (const file of files.filter(file => /\.(?:html|js|json)$/i.test(file))) {
  const content = await readFile(file, 'utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(content)) failures.push(`${path.relative(root, file)} contains a private-key marker.`);
  if (/\bEXPO_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CREDENTIAL|API_KEY)[A-Z0-9_]*\b/.test(content)) failures.push(`${path.relative(root, file)} contains a publicly bundled secret variable name.`);
  if (/sourceMappingURL=data:/i.test(content)) failures.push(`${path.relative(root, file)} embeds a source map.`);
}

if (failures.length) {
  console.error(`Web build verification failed:\n- ${[...new Set(failures)].join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Web build verification passed (${files.length.toLocaleString()} files, no source maps or high-confidence secret markers).`);
}
