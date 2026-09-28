import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'docs', 'sbom.cdx.json');
const checkOnly = process.argv.includes('--check');
const lockBytes = await readFile(path.join(root, 'package-lock.json'));
const lockDigest = createHash('sha256').update(lockBytes).digest('hex');
const command = ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'];
const generated = spawnSync('npm', command, {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, NO_UPDATE_NOTIFIER: '1', NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
  maxBuffer: 100 * 1024 * 1024,
});

if (generated.status !== 0) {
  console.error(generated.stderr.trim() || 'npm sbom failed.');
  process.exit(1);
}

let sbom;
try {
  sbom = JSON.parse(generated.stdout);
} catch (error) {
  console.error(`npm sbom returned invalid JSON: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}

// npm intentionally emits a random serial number and wall-clock timestamp.
// Replace them with lockfile-derived identity so an unchanged dependency graph
// produces byte-identical checked output while retaining valid CycloneDX form.
const uuidBytes = Buffer.from(lockDigest.slice(0, 32), 'hex');
uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50;
uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
const uuidHex = uuidBytes.toString('hex');
sbom.serialNumber = `urn:uuid:${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20)}`;
if (sbom.metadata) {
  delete sbom.metadata.timestamp;
  const properties = Array.isArray(sbom.metadata.properties)
    ? sbom.metadata.properties.filter(property => !String(property?.name).startsWith('lms:'))
    : [];
  properties.push(
    { name: 'lms:generation-command', value: 'npm sbom --sbom-format cyclonedx --omit dev' },
    { name: 'lms:package-lock:sha256', value: lockDigest },
  );
  sbom.metadata.properties = properties.sort((left, right) => String(left.name).localeCompare(String(right.name)));
}
if (Array.isArray(sbom.components)) {
  sbom.components.sort((left, right) => String(left['bom-ref']).localeCompare(String(right['bom-ref'])));
}
if (Array.isArray(sbom.dependencies)) {
  for (const dependency of sbom.dependencies) {
    if (Array.isArray(dependency.dependsOn)) dependency.dependsOn.sort();
  }
  sbom.dependencies.sort((left, right) => String(left.ref).localeCompare(String(right.ref)));
}

const output = `${JSON.stringify(sbom, null, 2)}\n`;
if (checkOnly) {
  let current = '';
  try { current = await readFile(outputPath, 'utf8'); } catch {}
  if (current !== output) {
    console.error('docs/sbom.cdx.json is missing or stale. Run npm run sbom:generate after installing dependencies.');
    process.exitCode = 1;
  } else {
    console.log(`CycloneDX SBOM is current (${(sbom.components || []).length.toLocaleString('en-US')} components).`);
  }
} else {
  await writeFile(outputPath, output, 'utf8');
  console.log(`Wrote docs/sbom.cdx.json with ${(sbom.components || []).length.toLocaleString('en-US')} components.`);
}
