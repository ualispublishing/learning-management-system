import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const outputPath = path.join(root, 'THIRD_PARTY_NOTICES.md');
const sourceManifestPath = path.join(root, 'third_party', 'license-sources.json');
const sourceManifestBytes = await readFile(sourceManifestPath);
const sourceManifest = JSON.parse(sourceManifestBytes.toString('utf8'));
const sourceRoot = path.dirname(sourceManifestPath);
const checkOnly = process.argv.includes('--check');
const licenseName = /^(?:licen[cs]e|unlicen[cs]e|copying|notice|copyright)(?:$|[._-])/i;
const skippedDirectories = new Set(['.git', 'examples', 'example', 'node_modules', 'test', 'tests']);
const components = new Map();
const sbomResult = spawnSync('npm', ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, NO_UPDATE_NOTIFIER: '1', NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
  maxBuffer: 100 * 1024 * 1024,
});
if (sbomResult.status !== 0) {
  console.error(sbomResult.stderr.trim() || 'npm sbom failed while resolving the production notice graph.');
  process.exit(1);
}
const productionSbom = JSON.parse(sbomResult.stdout);
const productionComponents = new Set((productionSbom.components || []).map(component => `${component.name}@${component.version}`));

if (sourceManifest.schemaVersion !== 1 || !Array.isArray(sourceManifest.sources)) {
  console.error('third_party/license-sources.json must use schemaVersion 1 and contain a sources array.');
  process.exit(1);
}

const declaredLicense = manifest => {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license && typeof manifest.license.type === 'string') return manifest.license.type;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map(entry => typeof entry === 'string' ? entry : entry?.type).filter(Boolean).join(' OR ');
  }
  return 'NOT DECLARED';
};

const findLicenseFiles = async (packageRoot, directory = packageRoot, depth = 0) => {
  if (depth > 8) return [];
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) matches.push(...await findLicenseFiles(packageRoot, fullPath, depth + 1));
      continue;
    }
    if (!entry.isFile() || !licenseName.test(entry.name)) continue;
    const fileStats = await stat(fullPath);
    if (fileStats.size === 0 || fileStats.size > 1024 * 1024) continue;
    const bytes = await readFile(fullPath);
    if (bytes.includes(0)) continue;
    matches.push({
      relativePath: path.relative(packageRoot, fullPath),
      bytes,
    });
  }
  return matches;
};

const addText = (component, bytes, origin) => {
  const digest = createHash('sha256').update(bytes).digest('hex');
  const existing = component.texts.get(digest) || {
    bytes,
    installedPaths: new Set(),
    upstreamSources: [],
  };
  if (origin.installedPath) existing.installedPaths.add(origin.installedPath);
  if (origin.upstreamSource) existing.upstreamSources.push(origin.upstreamSource);
  component.texts.set(digest, existing);
};

for (const [lockPath, entry] of Object.entries(lock.packages || {})) {
  if (!lockPath.startsWith('node_modules/') || entry.dev === true || entry.link === true) continue;
  const packageRoot = path.join(root, lockPath);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  const name = typeof manifest.name === 'string' ? manifest.name : lockPath.split('node_modules/').at(-1);
  const version = typeof manifest.version === 'string' ? manifest.version : entry.version;
  if (!name || !version) continue;
  const key = `${name}@${version}`;
  if (!productionComponents.has(key)) continue;
  let component = components.get(key);
  if (!component) {
    component = {
      key,
      license: declaredLicense(manifest) || declaredLicense(entry),
      paths: new Set(),
      texts: new Map(),
    };
    components.set(key, component);
  }
  component.paths.add(lockPath);
  for (const file of await findLicenseFiles(packageRoot)) {
    addText(component, file.bytes, { installedPath: file.relativePath });
  }
}

const missingComponents = [...productionComponents].filter(key => !components.has(key));
if (missingComponents.length) {
  console.error(`Installed package metadata was not found for: ${missingComponents.sort().join(', ')}`);
  process.exit(1);
}

const sortedComponents = [...components.values()].sort((left, right) => left.key.localeCompare(right.key));
const missingBundledText = new Set(sortedComponents.filter(component => component.texts.size === 0).map(component => component.key));
const sourceIds = new Set();

for (const source of sourceManifest.sources) {
  if (!source || typeof source.id !== 'string' || !source.id || sourceIds.has(source.id)) {
    console.error('Every pinned license source must have a unique non-empty id.');
    process.exit(1);
  }
  sourceIds.add(source.id);
  if (!Array.isArray(source.components) || source.components.length === 0 || new Set(source.components).size !== source.components.length) {
    console.error(`Pinned source ${source.id} must list at least one unique exact package@version component.`);
    process.exit(1);
  }
  if (typeof source.file !== 'string' || typeof source.sha256 !== 'string') {
    console.error(`Pinned source ${source.id} must declare file and sha256.`);
    process.exit(1);
  }
  const sourceFile = path.resolve(sourceRoot, source.file);
  if (!sourceFile.startsWith(`${sourceRoot}${path.sep}`)) {
    console.error(`Pinned source ${source.id} escapes the third_party source directory.`);
    process.exit(1);
  }
  let bytes;
  try {
    bytes = await readFile(sourceFile);
  } catch {
    console.error(`Pinned source ${source.id} file is missing: ${source.file}`);
    process.exit(1);
  }
  if (bytes.length === 0 || bytes.length > 1024 * 1024 || bytes.includes(0)) {
    console.error(`Pinned source ${source.id} must be a non-empty text file no larger than 1 MiB.`);
    process.exit(1);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(source.sha256) || digest !== source.sha256) {
    console.error(`Pinned source ${source.id} digest mismatch: expected ${source.sha256}, received ${digest}.`);
    process.exit(1);
  }
  if (
    typeof source.repository !== 'string'
    || typeof source.revision !== 'string'
    || typeof source.sourcePath !== 'string'
    || !source.sourcePath
    || typeof source.sourceUrl !== 'string'
    || typeof source.evidenceUrl !== 'string'
    || typeof source.evidence !== 'string'
    || !source.evidence
  ) {
    console.error(`Pinned source ${source.id} must declare repository, revision, sourcePath, sourceUrl, evidenceUrl, and evidence provenance.`);
    process.exit(1);
  }
  if (!/^[a-f0-9]{40}$/.test(source.revision)) {
    console.error(`Pinned source ${source.id} revision must be a full lowercase Git commit hash.`);
    process.exit(1);
  }
  let repositoryUrl;
  let upstreamUrl;
  let evidenceUrl;
  try {
    repositoryUrl = new URL(source.repository);
    upstreamUrl = new URL(source.sourceUrl);
    evidenceUrl = new URL(source.evidenceUrl);
  } catch {
    console.error(`Pinned source ${source.id} has an invalid provenance URL.`);
    process.exit(1);
  }
  const repositoryPath = repositoryUrl.pathname.replace(/\.git$/, '').replace(/\/$/, '');
  const upstreamParts = upstreamUrl.pathname.split('/').filter(Boolean);
  if (
    repositoryUrl.protocol !== 'https:'
    || repositoryUrl.hostname !== 'github.com'
    || upstreamUrl.protocol !== 'https:'
    || upstreamUrl.hostname !== 'raw.githubusercontent.com'
    || upstreamParts.length < 4
    || `/${upstreamParts[0]}/${upstreamParts[1]}` !== repositoryPath
    || upstreamParts[2] !== source.revision
    || evidenceUrl.protocol !== 'https:'
    || evidenceUrl.hostname !== 'registry.npmjs.org'
  ) {
    console.error(`Pinned source ${source.id} must use an exact-commit raw file from its declared official GitHub repository.`);
    process.exit(1);
  }

  for (const key of source.components) {
    const component = components.get(key);
    if (!component) {
      console.error(`Pinned source ${source.id} references a component outside the exact production graph: ${key}`);
      process.exit(1);
    }
    if (!missingBundledText.has(key)) {
      console.error(`Pinned source ${source.id} is stale because ${key} now distributes a bundled license/notice file.`);
      process.exit(1);
    }
    if (source.declaredLicense !== component.license) {
      console.error(`Pinned source ${source.id} license mismatch for ${key}: expected ${component.license}, received ${source.declaredLicense}.`);
      process.exit(1);
    }
    addText(component, bytes, {
      upstreamSource: {
        id: source.id,
        repository: source.repository,
        revision: source.revision,
        sourcePath: source.sourcePath,
        sourceUrl: source.sourceUrl,
        evidenceUrl: source.evidenceUrl,
        evidence: source.evidence,
      },
    });
  }
}

const unresolved = sortedComponents.filter(component => component.texts.size === 0);
const upstreamResolved = sortedComponents.filter(component => missingBundledText.has(component.key) && component.texts.size > 0);
const lockDigest = createHash('sha256').update(await readFile(path.join(root, 'package-lock.json'))).digest('hex');
const sourceManifestDigest = createHash('sha256').update(sourceManifestBytes).digest('hex');
const lines = [
  '# Third-Party Notices',
  '',
  'This file is generated from the installed production dependency graph. License and notice wording below is copied either from files distributed inside the corresponding installed package or from exact-commit files in the package publisher\'s official repository recorded in `third_party/license-sources.json`. Only a UTF-8 byte-order mark and trailing whitespace are removed for Markdown presentation. Package metadata is informational and does not replace license text.',
  '',
  `- Package-lock SHA-256: \`${lockDigest}\``,
  `- Pinned license-source manifest SHA-256: \`${sourceManifestDigest}\``,
  `- Unique runtime package versions: ${sortedComponents.length.toLocaleString('en-US')}`,
  `- Packages resolved from pinned official upstream sources: ${upstreamResolved.length.toLocaleString('en-US')}`,
  `- Packages without bundled or pinned official license text: ${unresolved.length.toLocaleString('en-US')}`,
  '',
  'Regenerate with `npm run notices:generate` after every dependency change and verify with `npm run notices:check`. Legal review must resolve every package listed in the unresolved section, validate the publisher/release binding of every pinned source, and confirm that mobile/web binary asset notices and store disclosures are complete.',
  '',
  '## Packages without bundled or pinned official license text',
  '',
];

if (unresolved.length === 0) {
  lines.push('None.', '');
} else {
  for (const component of unresolved) lines.push(`- ${component.key} — declared license: ${component.license}`);
  lines.push('');
}

lines.push('## Resolved package notices', '');
for (const component of sortedComponents) {
  if (component.texts.size === 0) continue;
  lines.push(`### ${component.key}`, '', `Declared license: ${component.license}`, '');
  const packagePaths = [...component.paths].sort();
  if (packagePaths.length > 1) lines.push(`Installed copies: ${packagePaths.length.toLocaleString('en-US')}`, '');
  const texts = [...component.texts.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [digest, text] of texts) {
    const sourcePaths = [...text.installedPaths].sort().join(', ');
    const content = text.bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\s+$/, '');
    const longestFence = Math.max(3, ...[...content.matchAll(/`+/g)].map(match => match[0].length + 1));
    const fence = '`'.repeat(longestFence);
    if (sourcePaths) lines.push(`Installed source file(s): ${sourcePaths}`);
    for (const source of text.upstreamSources.sort((left, right) => left.id.localeCompare(right.id))) {
      lines.push(
        `Pinned official source: [${source.repository.replace('https://github.com/', '')}@${source.revision.slice(0, 12)} — ${source.sourcePath}](${source.sourceUrl})`,
        `Publisher/version evidence: [official npm metadata](${source.evidenceUrl}) — ${source.evidence}`,
      );
    }
    lines.push(`SHA-256: \`${digest}\``, '', `${fence}text`, content, fence, '');
  }
}

const output = `${lines.join('\n')}\n`;
if (checkOnly) {
  let current = '';
  try { current = await readFile(outputPath, 'utf8'); } catch {}
  if (current !== output) {
    console.error('THIRD_PARTY_NOTICES.md is missing or stale. Run npm run notices:generate after installing dependencies.');
    process.exitCode = 1;
  } else {
    console.log(`Third-party notices are current (${sortedComponents.length.toLocaleString('en-US')} runtime package versions; ${upstreamResolved.length.toLocaleString('en-US')} pinned upstream; ${unresolved.length.toLocaleString('en-US')} unresolved).`);
  }
} else {
  await writeFile(outputPath, output, 'utf8');
  console.log(`Wrote THIRD_PARTY_NOTICES.md for ${sortedComponents.length.toLocaleString('en-US')} runtime package versions (${upstreamResolved.length.toLocaleString('en-US')} pinned upstream; ${unresolved.length.toLocaleString('en-US')} unresolved).`);
}
