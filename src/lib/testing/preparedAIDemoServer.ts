/** Loopback-only, allow-listed source replay. No external model calls or arbitrary uploads. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runAIProvider, sha256, type AIProvider, type ExtractedAISource } from '../ai/providerAdapter.server';
import { FLASHCARD_PROMPT_VERSION, SYLLABUS_PROMPT_VERSION } from '../ai/prompts';
import type { PreparedDemoGeneration, PreparedDemoSource } from '../ai/preparedDemo';
import { validateCards, validateInstitutionSyllabusResult } from '../ai/service';
import { preparedExport, type PreparedExportFormat, type PreparedShowcaseResult } from '../ai/preparedExports';
import { readPreparedGeneration } from '../ai/generationAttribution';

interface Entry extends PreparedDemoSource { source: string; extracted: string; result: string; reference: string; resultSha256: string; extractedSha256: string }
export async function createPreparedAIDemo(root: string) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')) as { entries: Entry[]; generation?: PreparedDemoGeneration; promptVersions: { syllabus: string; flashcards: string } };
  if (manifest.promptVersions?.syllabus !== SYLLABUS_PROMPT_VERSION || manifest.promptVersions?.flashcards !== FLASHCARD_PROMPT_VERSION) throw new Error('Prepared pack prompt versions are stale. Review the results against the current prompts.');
  const files = new Map<string, { entry: Entry; bytes: Buffer; source: ExtractedAISource; result: Record<string, unknown> }>();
  const localPath = (relative: string) => {
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Prepared pack paths must remain in its folder.');
    return resolved;
  };
  if (manifest.generation?.record) {
    const recordBytes = await readFile(localPath(manifest.generation.record));
    if (sha256(recordBytes) !== manifest.generation.recordSha256) throw new Error('Prepared generation record changed. Review the attribution and results.');
    const record = JSON.parse(recordBytes.toString()) as { generation: PreparedDemoGeneration; files: { sourceSha256: string; extractedSha256: string; resultSha256: string }[] };
    for (const key of ['authoringTool', 'preparedOn', 'model', 'reasoningEffort', 'contextMode', 'enrichmentNote'] as const) {
      if (record.generation[key] !== manifest.generation[key]) throw new Error('Prepared attribution does not match its generation record.');
    }
    if (record.files.length !== manifest.entries.length || manifest.entries.some(entry => !record.files.some(file => file.sourceSha256 === entry.sha256 && file.extractedSha256 === entry.extractedSha256 && file.resultSha256 === entry.resultSha256))) throw new Error('Prepared generation record does not match the source/result pack.');
  }
  // Only the hash-bound generation record can supply authoring metadata. Older packs remain unattributed.
  const preparedGeneration = manifest.generation?.record ? readPreparedGeneration({
    authoringTool: manifest.generation.authoringTool, preparedOn: manifest.generation.preparedOn,
    model: manifest.generation.model, reasoningEffort: manifest.generation.reasoningEffort,
    contextMode: manifest.generation.contextMode, enrichmentNote: manifest.generation.enrichmentNote,
    recordSha256: manifest.generation.recordSha256,
  }) : undefined;
  for (const entry of manifest.entries) {
    const [bytes, sourceText, resultText, referenceText] = await Promise.all([entry.source, entry.extracted, entry.result, entry.reference].map(file => readFile(localPath(file))));
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.size || sha256(resultText) !== entry.resultSha256 || sha256(sourceText) !== entry.extractedSha256) throw new Error(`Prepared source/result changed: ${entry.name}. Rebuild and review the demo pack.`);
    const source = JSON.parse(sourceText.toString()) as ExtractedAISource;
    const result = JSON.parse(resultText.toString()) as Record<string, unknown>;
    const reference = JSON.parse(referenceText.toString());
    if (JSON.stringify(result) !== JSON.stringify(reference)) throw new Error(`Prepared output does not match the reviewed reference: ${entry.name}.`);
    source.documentSha256 = entry.sha256;
    files.set(entry.sha256, { entry, bytes, source, result });
  }
  const provider: AIProvider = { id: 'prepared-demo/v1', async generate(request) {
    const file = files.get(request.source.documentSha256 ?? '');
    if (!file || file.entry.task !== request.task) throw new Error('This file has no prepared result for that task.');
    const result = structuredClone(file.result);
    if (request.task === 'flashcards') result.cards = (result.cards as unknown[]).slice(0, request.requestedCardCount);
    return result;
  } };
  const withAttribution = (output: Awaited<ReturnType<typeof runAIProvider>>) => ({
    ...output, provenance: { ...output.provenance, ...(preparedGeneration ? { preparedGeneration } : {}) },
  });
  // Validate the entire pack before exposing either the preview or its portable exports.
  const exports = new Map<string, ReturnType<typeof preparedExport>>();
  for (const file of files.values()) {
    const input = { document: { uri: 'file:///prepared', name: file.entry.name }, requestedCardCount: 30 };
    const output = withAttribution(await runAIProvider(provider, file.entry.task, input, file.source, 'prepared-startup-check'));
    const result: PreparedShowcaseResult = file.entry.task === 'syllabus'
      ? { task: 'syllabus', syllabus: validateInstitutionSyllabusResult(output, input) }
      : { task: 'flashcards', cards: validateCards(output, input).slice(0, 6) };
    const formats: PreparedExportFormat[] = result.task === 'syllabus' ? ['result', 'syllabus', 'course', 'schema'] : ['result'];
    for (const format of formats) exports.set(`${file.entry.sha256}/${format}`, preparedExport(result, format, manifest.generation));
  }
  const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  const multipart = async (req: IncomingMessage) => {
    if (!req.headers['content-type']?.startsWith('multipart/form-data;')) throw new Error('Select a source file using the upload control.');
    const max = 50 * 1024 * 1024 + 32_768;
    if (Number(req.headers['content-length']) > max) throw new Error('The demo upload is too large.');
    const chunks: Buffer[] = []; let total = 0;
    for await (const chunk of req) { total += chunk.length; if (total > max) throw new Error('The demo upload is too large.'); chunks.push(chunk); }
    return await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData() as unknown as { get(name: string): string | File | null };
  };
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith('/demo-ai/') && url.pathname !== '/lms/v1/ai/generate') return false;
    try {
      if (req.method === 'GET' && url.pathname === '/demo-ai/catalog') {
        json(res, 200, { mode: 'prepared-demo', generation: manifest.generation, entries: [...files.values()].map(({ entry, source }) => ({ id: entry.id, name: entry.name, title: entry.title, task: entry.task, kind: entry.kind, mimeType: entry.mimeType, size: entry.size, sha256: entry.sha256, captionSha256: entry.captionSha256, transcript: entry.kind === 'video' ? source.text : undefined })) }); return true;
      }
      const exportKey = /^\/demo-ai\/exports\/([a-f0-9]{64}\/(?:result|syllabus|course|schema))$/.exec(url.pathname)?.[1];
      if (req.method === 'GET' && exportKey) {
        const artifact = exports.get(exportKey);
        if (!artifact) { json(res, 404, { error: 'Prepared export not found.' }); return true; }
        res.writeHead(200, { 'content-type': artifact.type, 'content-length': Buffer.byteLength(artifact.text), 'content-disposition': `attachment; filename="${artifact.name}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(artifact.text); return true;
      }
      const previewDigest = /^\/demo-ai\/source\/([a-f0-9]{64})$/.exec(url.pathname)?.[1];
      if (req.method === 'GET' && previewDigest) {
        const file = files.get(previewDigest);
        if (!file) throw new Error('Prepared source not found.');
        json(res, 200, { text: file.source.text, segments: file.source.segments, documentSha256: file.entry.sha256 });
        return true;
      }
      const digest = /^\/demo-ai\/files\/([a-f0-9]{64})$/.exec(url.pathname)?.[1];
      if (req.method === 'GET' && digest) {
        const file = files.get(digest); if (!file) throw new Error('Prepared file not found.');
        const headers = { 'content-type': file.entry.mimeType, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'accept-ranges': 'bytes', ...(url.searchParams.has('download') ? { 'content-disposition': `attachment; filename="${file.entry.name}"` } : {}) };
        if (req.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          const start = range?.[1] ? Number(range[1]) : Math.max(0, file.bytes.length - Number(range?.[2]));
          const end = range?.[1] && range[2] ? Math.min(Number(range[2]), file.bytes.length - 1) : file.bytes.length - 1;
          if (!range || (!range[1] && !range[2]) || !Number.isSafeInteger(start) || start < 0 || start > end) {
            res.writeHead(416, { ...headers, 'content-range': `bytes */${file.bytes.length}` }); res.end(); return true;
          }
          res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${file.bytes.length}` }); res.end(file.bytes.subarray(start, end + 1)); return true;
        }
        res.writeHead(200, { ...headers, 'content-length': file.bytes.length }); res.end(file.bytes); return true;
      }
      if (req.method === 'POST' && ['/lms/v1/ai/generate', '/demo-ai/retain'].includes(url.pathname)) {
        const form = await multipart(req); const retain = url.pathname === '/demo-ai/retain'; const uploaded = form.get(retain ? 'asset' : 'document');
        if (!(uploaded instanceof Blob)) throw new Error('Prepared mode needs a bundled source file. Unknown files require a connected live provider.');
        const file = files.get(sha256(new Uint8Array(await uploaded.arrayBuffer())));
        if (!file) throw new Error('No prepared result matches these file contents. Choose a bundled sample; renamed copies work, edited or unrelated files do not.');
        if (retain) { json(res, 200, { id: `prepared-${file.entry.sha256}`, name: file.entry.name, mimeType: file.entry.mimeType, size: file.bytes.length, sha256: file.entry.sha256, url: `https://prepared-demo.invalid/files/${file.entry.sha256}` }); return true; }
        const task = form.get('task'); if (task !== file.entry.task) throw new Error(`This sample is for ${file.entry.task === 'syllabus' ? 'syllabus import' : 'learning material / flashcards'}. Use the matching upload area.`);
        if (form.get('promptVersion') !== (task === 'syllabus' ? SYLLABUS_PROMPT_VERSION : FLASHCARD_PROMPT_VERSION)) throw new Error('The prepared prompt version does not match this app.');
        if (form.get('sourceText')) throw new Error('Prepared mode checks one file at a time. Turn off Content to Cards when using a prepared file.');
        if (form.get('sourceKind') !== file.entry.kind) throw new Error('The selected source type does not match the prepared file.');
        const count = Number(form.get('requestedCardCount') ?? 30); if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Choose between 1 and 100 cards.');
        const locale = String(form.get('locale') || 'en'); if (!/^en(?:-|$)/i.test(locale)) throw new Error('This prepared pack is in English; use a live provider for other languages.');
        const requestId = req.headers['x-request-id']; if (typeof requestId !== 'string' || !requestId || requestId.length > 160) throw new Error('A valid request ID is required.');
        const result = await runAIProvider(provider, task, { document: { uri: 'file:///prepared', name: file.entry.name }, requestedCardCount: count, locale }, file.source, requestId);
        json(res, 200, withAttribution(result)); return true;
      }
      json(res, 404, { error: 'Prepared demo route not found.' });
    } catch (error) { const message = error instanceof Error ? error.message : 'Prepared result could not be checked.'; json(res, 400, { error: message, message, code: 'prepared_source_rejected' }); }
    return true;
  };
}
