import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateImageBackgroundAsync, generateImageAsync, getPngInfo } from '@expo/image-utils';
import { applyInstitutionColors } from '../src/lib/brandingPalette';
import { hasAccessibleTextContrast } from '../src/lib/color';
import { colors } from '../src/lib/theme';

interface BrandingTools {
  syncBranding(root: string, options?: { check?: boolean }): Promise<{ primary: string; secondary: string; name: string; revision: string; logoBackground: string; logoAspect: number }>;
  swatchColor(image: { data: Buffer }, name: string): string;
}
let syncBranding: BrandingTools['syncBranding'];
let swatchColor: BrandingTools['swatchColor'];
test.before(async () => { ({ syncBranding, swatchColor } = await import(new URL('../scripts/sync-branding.mjs', import.meta.url).href)); });
process.env.EXPO_IMAGE_UTILS_NO_SHARP = '1';
const png = (backgroundColor: string, width = 8, height = 8) => generateImageBackgroundAsync({ width, height, resizeMode: 'contain', backgroundColor });

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'lms-branding-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(root, 'institution-logo.png'), await png('#FFFFFF', 16, 8)),
    writeFile(path.join(root, 'institution-primary.png'), await png('#800020')),
    writeFile(path.join(root, 'institution-secondary.png'), await png('#FFD700')),
    writeFile(path.join(root, 'institution.json'), JSON.stringify({ name: 'Sample College', tagline: 'Learn together.' })),
  ]);
  const logoFile = path.join(root, 'institution-logo.png');
  const wideLogo = await generateImageAsync({ projectRoot: root }, { src: logoFile, width: 16, height: 8, resizeMode: 'cover' });
  await writeFile(logoFile, wideLogo.source);
  return root;
}

test('replacing root branding files regenerates a complete consistent institution without touching source code', async t => {
  const root = await fixture(t);
  const first = await syncBranding(root);
  assert.equal(first.name, 'Sample College'); assert.equal(first.primary, '#800020'); assert.equal(first.secondary, '#FFD700');
  assert.equal(first.logoBackground, '#0F172A'); assert.equal(first.logoAspect, 2);
  const logo = await getPngInfo(path.join(root, 'assets/brand/institution-logo.png'));
  assert.equal(logo.width / logo.height, 2);
  const icon = await getPngInfo(path.join(root, 'assets/brand/institution-icon.png'));
  assert.equal(icon.width, 1024); assert.equal(icon.height, 1024);
  assert.equal(icon.data[3], 255);
  assert.equal((await getPngInfo(path.join(root, 'assets/brand/institution-favicon.png'))).width, 64);
  await syncBranding(root, { check: true });
  await writeFile(path.join(root, 'institution-primary.png'), await png('#006747'));
  await assert.rejects(syncBranding(root, { check: true }), /stale/);
  const second = await syncBranding(root);
  assert.equal(second.primary, '#006747'); assert.notEqual(second.revision, first.revision);
  await syncBranding(root, { check: true });
});

test('malformed branding fails before replacing the last usable generated set', async t => {
  const root = await fixture(t); await syncBranding(root);
  const manifestFile = path.join(root, 'src/lib/branding.generated.json');
  const before = await readFile(manifestFile, 'utf8');
  await writeFile(path.join(root, 'institution-secondary.png'), 'not a PNG');
  await assert.rejects(syncBranding(root), /must be a PNG/);
  assert.equal(await readFile(manifestFile, 'utf8'), before);
  await rm(path.join(root, 'institution-logo.png'));
  await assert.rejects(syncBranding(root), /Missing institution-logo.png/);
});

test('swatches reject ambiguous gradients, semitransparency and empty pixels instead of guessing a colour', () => {
  assert.throws(() => swatchColor({ data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) }, 'primary'), /90%/);
  assert.throws(() => swatchColor({ data: Buffer.from([255, 0, 0, 128]) }, 'primary'), /opaque/);
  assert.throws(() => swatchColor({ data: Buffer.alloc(8) }, 'primary'), /90%/);
  assert.equal(swatchColor({ data: Buffer.from([0, 103, 71, 255, 0, 0, 0, 0]) }, 'primary'), '#006747');
});

test('institution palettes preserve source accents and keep key text/button pairs readable in both appearances', () => {
  for (const dark of [false, true]) for (const primary of ['#FFFFFF', '#000000', '#FFFF00', '#800020', '#006747']) for (const secondary of ['#001E62', '#FFD700', '#FFFFFF']) {
    const palette = applyInstitutionColors(colors[dark ? 'dark' : 'light'], primary, secondary, dark);
    assert.equal(palette.brandPrimary, primary); assert.equal(palette.secondary, secondary);
    assert.equal(palette.brandSecondary, secondary);
    for (const surface of [palette.background, palette.card, palette.navBg, palette.navBgEnd]) {
      assert.ok(hasAccessibleTextContrast(palette.primary, surface));
      assert.ok(hasAccessibleTextContrast(palette.textSecondary, surface));
      assert.ok(hasAccessibleTextContrast(palette.text, surface));
    }
    assert.ok(hasAccessibleTextContrast(palette.buttonText, palette.buttonBackground));
    assert.ok(hasAccessibleTextContrast(palette.onSecondary, palette.secondary));
  }
});
