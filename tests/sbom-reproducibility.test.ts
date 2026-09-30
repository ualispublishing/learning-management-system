import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('SBOM identity and check output are independent of the checkout directory name', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lms-sbom-repro-'));
  try {
    const outputs = [];
    for (const dirname of ['developer-checkout', 'ci-job-123']) {
      const checkout = path.join(root, dirname);
      await mkdir(path.join(checkout, 'scripts'), { recursive: true });
      await mkdir(path.join(checkout, 'docs'));
      const manifest = { name: 'stable-app', version: '1.0.0', private: true };
      await writeFile(path.join(checkout, 'package.json'), JSON.stringify(manifest));
      await writeFile(path.join(checkout, 'package-lock.json'), JSON.stringify({
        name: manifest.name, version: manifest.version, lockfileVersion: 3,
        requires: true, packages: { '': manifest },
      }));
      await copyFile(new URL('../scripts/generate-sbom.mjs', import.meta.url), path.join(checkout, 'scripts/generate-sbom.mjs'));
      for (const args of [[], ['--check']]) {
        const result = spawnSync(process.execPath, ['scripts/generate-sbom.mjs', ...args], {
          cwd: checkout, encoding: 'utf8', timeout: 15_000,
          env: { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
        });
        assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
      }
      outputs.push(JSON.parse(await readFile(path.join(checkout, 'docs/sbom.cdx.json'), 'utf8')));
    }
    assert.equal(outputs[0].metadata.component.name, 'stable-app');
    assert.deepEqual(outputs[0], outputs[1]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
