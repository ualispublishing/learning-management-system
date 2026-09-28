import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import {
  DIAGNOSTIC_CONTEXTS,
  logDiagnosticError,
  logDiagnosticWarning,
} from '../src/lib/diagnosticLog';

test('production diagnostics emit fixed context without raw exception details', () => {
  const runtime = globalThis as typeof globalThis & { __DEV__?: boolean };
  const originalDev = Object.getOwnPropertyDescriptor(runtime, '__DEV__');
  const originalError = console.error;
  const originalWarn = console.warn;
  const errors: unknown[][] = [];
  const warnings: unknown[][] = [];

  try {
    runtime.__DEV__ = false;
    console.error = (...args: unknown[]) => { errors.push(args); };
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    const sensitive = new Error('Bearer secret-token from https://private.example/student/42');

    logDiagnosticError(DIAGNOSTIC_CONTEXTS.studySessionLoad, sensitive);
    logDiagnosticWarning(DIAGNOSTIC_CONTEXTS.cardVideoPlayback, sensitive);

    assert.deepEqual(errors, [[DIAGNOSTIC_CONTEXTS.studySessionLoad]]);
    assert.deepEqual(warnings, [[DIAGNOSTIC_CONTEXTS.cardVideoPlayback]]);

    runtime.__DEV__ = true;
    logDiagnosticError(DIAGNOSTIC_CONTEXTS.studySessionLoad, sensitive);
    assert.deepEqual(errors[1], [DIAGNOSTIC_CONTEXTS.studySessionLoad, sensitive]);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
    if (originalDev) Object.defineProperty(runtime, '__DEV__', originalDev);
    else delete runtime.__DEV__;
  }
});

test('application code routes console diagnostics through the privacy-safe helper', () => {
  const sourceRoot = join(process.cwd(), 'src');
  const directConsoleCalls: string[] = [];

  const inspect = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        inspect(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || entry.name === 'diagnosticLog.ts') continue;
      if (/console\.(?:error|warn|log|info|debug)\s*\(/.test(readFileSync(path, 'utf8'))) {
        directConsoleCalls.push(relative(process.cwd(), path));
      }
    }
  };

  inspect(sourceRoot);
  assert.deepEqual(directConsoleCalls, []);
});
