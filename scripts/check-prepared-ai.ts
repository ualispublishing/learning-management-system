import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPreparedAIDemo } from '../src/lib/testing/preparedAIDemoServer';

async function main() {
const root = path.resolve('demo/ai');
await createPreparedAIDemo(root);
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const report = {
  version: 1,
  mode: 'prepared-demo',
  status: 'passed',
  checks: ['Source file byte length and SHA-256', 'Extracted text SHA-256', 'Result SHA-256 and saved reference equality', 'Strict response shape and field limits', 'Exact evidence quotations at matching source locations', 'Evidence present in canonical source text', 'Required syllabus field evidence', 'Timestamp citations for audio and video', 'Card count, duplicate detection, and fresh unverified review state'],
  sources: manifest.entries.map((entry: { id: string; sha256: string; resultSha256: string }) => ({ id: entry.id, sourceSha256: entry.sha256, resultSha256: entry.resultSha256 })),
  limitations: ['A saved reference is a regression baseline, not independent expert verification.', 'These checks do not prove factual accuracy, pedagogical quality, or completeness.', 'No live AI provider is invoked. Human review is required before publishing.', 'MIT OCW commercial permission is not included.'],
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes('--write')) await writeFile(path.join(root, 'checks.json'), serialized);
else if (await readFile(path.join(root, 'checks.json'), 'utf8') !== serialized) throw new Error('Prepared check report is stale. Review the pack, then run npm run demo:ai:check -- --write.');
console.log(`Prepared AI pack passed: ${manifest.entries.length} files; no live AI calls. Human review still required.`);
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Prepared pack check failed.'); process.exitCode = 1; });
