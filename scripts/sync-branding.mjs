import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPngInfo, generateImageAsync, generateImageBackgroundAsync, compositeImagesAsync } from '@expo/image-utils';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['institution-logo.png', 'institution-primary.png', 'institution-secondary.png'];
const hash = value => createHash('sha256').update(value).digest('hex');

async function readPng(root, name, maxDimension) {
  const file = path.join(root, name);
  const size = (await stat(file).catch(() => { throw new Error(`Missing ${name}. Put that PNG file in the app's main folder.`); })).size;
  if (size > 8 * 1024 * 1024) throw new Error(`${name} must be smaller than 8 MiB.`);
  const buffer = await readFile(file);
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${name} must be a PNG image, not a renamed JPEG/SVG.`);
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height || width > maxDimension || height > maxDimension) throw new Error(`${name} must be between 1 and ${maxDimension} pixels on each side.`);
  return { file, buffer, image: await getPngInfo(file) };
}
export function swatchColor(image, name) {
  const counts = new Map(); let opaque = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] === 0) continue;
    if (image.data[i + 3] !== 255) throw new Error(`${name}: use a solid, fully opaque colour swatch.`);
    const key = `#${image.data.subarray(i, i + 3).toString('hex').toUpperCase()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1); opaque++;
  }
  const dominant = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (!dominant || dominant[1] / opaque < 0.9) throw new Error(`${name}: at least 90% of visible pixels must be one solid colour. Use a swatch, not a photo or gradient.`);
  return dominant[0];
}
export async function syncBranding(root = projectRoot, { check = false } = {}) {
  // Fix the image renderer so output does not depend on optional global Sharp installs.
  process.env.EXPO_IMAGE_UTILS_NO_SHARP = '1';
  const files = await Promise.all(names.map((name, index) => readPng(root, name, index === 0 ? 2048 : 512)));
  if (!files[0].image.data.some((channel, index) => index % 4 === 3 && channel > 0)) throw new Error('institution-logo.png is completely transparent.');
  const configFile = path.join(root, 'institution.json');
  let configText;
  try { configText = await readFile(configFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; configText = '{}'; }
  const config = JSON.parse(configText);
  if (!config || Array.isArray(config) || typeof config !== 'object' || Object.keys(config).some(key => !['name', 'tagline'].includes(key))) throw new Error('institution.json supports only name and tagline.');
  const name = config.name ?? 'Learning Management System', tagline = config.tagline ?? 'Learning, together.';
  for (const [label, value, maximum] of [['name', name, 80], ['tagline', tagline, 160]]) {
    if (typeof value !== 'string' || value.trim() !== value || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Institution ${label} must be nonempty text, at most ${maximum} characters.`);
  }
  const primary = swatchColor(files[1].image, names[1]), secondary = swatchColor(files[2].image, names[2]);
  const revision = hash(Buffer.concat([Buffer.from(JSON.stringify({ name, tagline, version: 1 })), ...files.map(f => f.buffer)]));
  let brightness = 0, visible = 0;
  for (let i = 0; i < files[0].image.data.length; i += 4) {
    const pixels = files[0].image.data, alpha = pixels[i + 3] / 255;
    brightness += alpha * (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]); visible += alpha;
  }
  const logoBackground = brightness / visible > 210 ? '#0F172A' : '#FFFFFF';
  const logoAspect = files[0].image.width / files[0].image.height;
  const manifest = { name, tagline, primary, secondary, logoBackground, logoAspect, revision };
  const outputs = new Map();
  const resize = async (size, backgroundColor = 'transparent') => (await generateImageAsync({ projectRoot: root }, { src: files[0].file, width: size, height: size, resizeMode: 'contain', backgroundColor })).source;
  outputs.set('assets/brand/institution-logo.png', (await generateImageAsync({ projectRoot: root }, {
    src: files[0].file, resizeMode: 'contain', width: Math.max(1, Math.round(512 * Math.min(1, logoAspect))), height: Math.max(1, Math.round(512 / Math.max(1, logoAspect))),
  })).source);
  // A neutral canvas preserves logos in both light/dark UI, including white marks.
  // Padding keeps arbitrary aspect ratios intact and marks clear of icon masks.
  const iconBackground = await generateImageBackgroundAsync({ width: 1024, height: 1024, resizeMode: 'contain', backgroundColor: logoBackground });
  outputs.set('assets/brand/institution-icon.png', await compositeImagesAsync({ foreground: await resize(768), background: iconBackground, x: 128, y: 128 }));
  const clearBackground = await generateImageBackgroundAsync({ width: 1024, height: 1024, resizeMode: 'contain', backgroundColor: 'transparent' });
  outputs.set('assets/brand/institution-adaptive.png', await compositeImagesAsync({ foreground: await resize(600), background: clearBackground, x: 212, y: 212 }));
  outputs.set('assets/brand/institution-favicon.png', await resize(64, logoBackground));
  outputs.set('assets/brand/institution-splash.png', await resize(512, logoBackground));
  outputs.set('src/lib/branding.generated.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  for (const [relative, contents] of outputs) {
    const file = path.join(root, relative);
    const current = await readFile(file).catch(() => null);
    if (current?.equals(contents)) continue;
    if (check) throw new Error(`Branding output is stale: ${relative}. Run npm run brand:sync.`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const brand = await syncBranding(projectRoot, { check: process.argv.includes('--check') });
    console.log(`Institution branding ${process.argv.includes('--check') ? 'verified' : 'ready'}: ${brand.name} · ${brand.primary} / ${brand.secondary}`);
  } catch (error) { console.error(`Branding could not be prepared: ${error.message}`); process.exitCode = 1; }
}
