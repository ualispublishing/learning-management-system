import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes('--check');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const digest = createHash('sha256').update(await readFile(join(root, 'package-lock.json'))).digest('hex');
const run = args => execFileSync('npm', args, { cwd: root, encoding: 'utf8', maxBuffer: 10_000_000 });
const bom = JSON.parse(run(['sbom', '--sbom-format', 'cyclonedx', '--omit=dev']));
delete bom.serialNumber;
delete bom.metadata.timestamp;
bom.metadata.component.name = manifest.name;
bom.metadata.properties = [{ name: 'lms:package-lock:sha256', value: digest }];
bom.components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));
bom.dependencies.forEach(entry => entry.dependsOn?.sort());
bom.dependencies.sort((a, b) => a.ref.localeCompare(b.ref));

const directories = run(['ls', '--parseable', '--all', '--omit=dev']).trim().split('\n').filter(directory => directory !== root);
const notices = [];
for (const directory of directories) {
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  let license;
  for (const filename of ['LICENSE.md', 'LICENSE', 'LICENSE.txt']) {
    try { license = await readFile(join(directory, filename), 'utf8'); break; } catch { /* Try the next known filename. */ }
  }
  if (!license) throw new Error(`Missing license text for ${pkg.name}@${pkg.version}; resolve provenance before packaging.`);
  notices.push({ name: `${pkg.name}@${pkg.version}`, text: `## ${pkg.name}@${pkg.version}\n\nDeclared license: ${pkg.license}\n\n${license.trim()}\n` });
}
notices.sort((a, b) => a.name.localeCompare(b.name));
const outputs = {
  'sbom.cdx.json': JSON.stringify(bom, null, 2) + '\n',
  'THIRD_PARTY_NOTICES.md': '# Authentication server dependency notices\n\nGenerated from the installed production dependency tree. Inventory is not legal approval.\n\n' + notices.map(notice => notice.text).join('\n'),
};
for (const [name, text] of Object.entries(outputs)) {
  if (check) {
    const existing = await readFile(join(root, name), 'utf8').catch(() => '');
    if (existing !== text) throw new Error(`${name} is missing or stale; run npm --prefix server run metadata:generate.`);
  } else await writeFile(join(root, name), text);
}
console.log(`Authentication server metadata ${check ? 'verified' : 'generated'} (${bom.components.length} runtime dependencies).`);
