/**
 * @fileoverview src/lib/integration/multipartAsset.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import type { AIDocumentAsset } from '../ai/types';

const normalizedMime = (value?: string) => value?.split(';', 1)[0].trim().toLocaleLowerCase() || '';

/**
 * Uploads accept only picker-owned local handles. Allowing an arbitrary HTTPS
 * URI here would turn a native multipart implementation into a client-side
 * fetch-and-forward primitive for intranet or authenticated resources.
 */
export const isPickerOwnedAssetUri = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= 8_192
  && value === value.trim()
  && !/[\u0000-\u001f\u007f]/.test(value)
  && /^(?:file|content|blob):/i.test(value)
);

export const validateMultipartAssetBytes = (asset: AIDocumentAsset, maxBytes: number): void => {
  if (asset.file === undefined) {
    if (typeof window !== 'undefined') {
      throw new Error('The browser upload is missing the selected file bytes. Choose the file again.');
    }
    return;
  }
  if (typeof Blob === 'undefined' || !(asset.file instanceof Blob)) {
    throw new Error('The selected browser file is invalid. Choose the file again.');
  }
  if (!Number.isSafeInteger(asset.file.size) || asset.file.size < 0 || asset.file.size > maxBytes) {
    throw new Error(`The selected file must be smaller than ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
  }
  if (asset.size !== undefined && asset.file.size !== asset.size) {
    throw new Error('The selected browser file size changed before upload. Choose the file again.');
  }
  const declaredMime = normalizedMime(asset.mimeType);
  const fileMime = normalizedMime(asset.file.type);
  if (declaredMime && declaredMime !== 'application/octet-stream' && fileMime && declaredMime !== fileMime) {
    throw new Error('The selected browser file type does not match its declared MIME type.');
  }
};

export const appendMultipartAsset = (form: FormData, field: string, asset: AIDocumentAsset): void => {
  if (asset.file) {
    form.append(field, asset.file, asset.name);
    return;
  }
  form.append(field, {
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType || 'application/octet-stream',
  } as unknown as Blob);
};
