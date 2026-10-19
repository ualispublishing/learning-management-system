/** Explicit web-demo configuration; no prepared result is a production fallback. */
import type { AIDocumentAsset } from './types';
import type { AssetService } from '../integration/assetService';
export { preparedGenerationAttribution } from './generationAttribution';

export const preparedDemoBaseUrl = (): string | null => {
  if (!(typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_LMS_PREPARED_AI_DEMO !== '1') return null;
  try {
    const url = new URL(process.env.EXPO_PUBLIC_LMS_SHARED_DEMO_URL || '');
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
};
export const isPreparedAIDemo = () => preparedDemoBaseUrl() !== null;
/** Historical authoring metadata; null means the exact model was not recorded. */
export interface PreparedDemoGeneration {
  authoringTool: string;
  preparedOn: string;
  model: string | null;
  reasoningEffort?: string;
  contextMode?: 'isolated-agent';
  enrichmentNote?: string;
  record?: string;
  recordSha256?: string;
}
export interface PreparedDemoSource { id: string; name: string; title: string; mimeType: string; size: number; sha256: string; task: 'syllabus' | 'flashcards'; kind: 'document' | 'captions' | 'audio' | 'video'; transcript?: string; captionSha256?: string }

/** Stored records retain opaque HTTPS references; only this explicit demo resolves them locally. */
export const resolvePreparedDemoUrl = (value: string): string => {
  const base = preparedDemoBaseUrl();
  const match = /^https:\/\/prepared-demo\.invalid\/files\/([a-f0-9]{64})$/.exec(value);
  return base && match ? `${base}/demo-ai/files/${match[1]}` : value;
};
export async function loadPreparedSource(source: PreparedDemoSource): Promise<AIDocumentAsset> {
  const base = preparedDemoBaseUrl();
  if (!base || typeof window === 'undefined') throw new Error('Prepared samples are available in the local web demo.');
  const response = await fetch(`${base}/demo-ai/files/${source.sha256}`, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('The prepared source could not be loaded.');
  const file = new File([await response.blob()], source.name, { type: source.mimeType });
  return { uri: URL.createObjectURL(file), name: file.name, mimeType: file.type, size: file.size, file, kind: source.kind };
}
export const preparedDemoAssetService: AssetService = { async upload(asset, context) {
  const base = preparedDemoBaseUrl();
  if (!base || !asset.file || context.purpose !== 'course-content' || !context.courseId) throw new Error('Prepared demo storage accepts course source files only.');
  const form = new FormData(); form.append('asset', asset.file, asset.name);
  const response = await fetch(`${base}/demo-ai/retain`, { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Prepared file storage failed.');
  return result;
} };
