/**
 * @fileoverview src/lib/coursePresentation.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { ContentItem, CourseVideoAlternatives } from '../types/lms';
import { parseCustomLearningWorkspace } from './customLearningWorkspace';
import { canonicalSafeHttpsUrl } from './safeUrl';
import { areVideoCaptionTracksBoundToAsset, validateCourseVideoAlternatives } from './videoAlternatives';

export type CourseSitePresentationMode = 'embedded' | 'external';

export interface CoursePresentationAsset {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size?: number;
  sha256?: string;
}

const COURSE_HLS_MIME_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
]);

export const isCourseVideoMimeType = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const mimeType = value.trim().toLocaleLowerCase();
  return mimeType.startsWith('video/') || COURSE_HLS_MIME_TYPES.has(mimeType);
};

export const isCourseHlsAsset = (asset: CoursePresentationAsset): boolean =>
  COURSE_HLS_MIME_TYPES.has(asset.mimeType);

/**
 * Treat only institution-stored asset records as playable course media. A
 * plain contentUrl remains a link; this prevents arbitrary teacher-authored
 * URLs from silently becoming tracking-capable media requests.
 */
export const getCoursePresentationAsset = (item: ContentItem): CoursePresentationAsset | null => {
  const candidate = item.metadata?.asset;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  const url = canonicalSafeHttpsUrl(record.url);
  if (
    typeof record.id !== 'string'
    || !record.id.trim()
    || typeof record.name !== 'string'
    || !record.name.trim()
    || typeof record.mimeType !== 'string'
    || !record.mimeType.trim()
    || !url
  ) return null;
  if (record.size !== undefined && (typeof record.size !== 'number' || !Number.isFinite(record.size) || record.size < 0)) return null;
  if (record.sha256 !== undefined && (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sha256))) return null;

  return {
    id: record.id.trim(),
    url,
    name: record.name.trim(),
    mimeType: record.mimeType.trim().toLocaleLowerCase(),
    ...(typeof record.size === 'number' ? { size: record.size } : {}),
    ...(typeof record.sha256 === 'string' ? { sha256: record.sha256.toLocaleLowerCase() } : {}),
  };
};

export const getCourseVideoAsset = (item: ContentItem): CoursePresentationAsset | null => {
  const asset = getCoursePresentationAsset(item);
  return asset && isCourseVideoMimeType(asset.mimeType) ? asset : null;
};

/** Runtime-safe learner projection; malformed or non-video alternatives fail closed. */
export const getCourseVideoAlternatives = (item: ContentItem): CourseVideoAlternatives | null => {
  const asset = getCourseVideoAsset(item);
  if (!asset) return null;
  const result = validateCourseVideoAlternatives(item.videoAlternatives);
  if (!result.success || !areVideoCaptionTracksBoundToAsset(result.data, asset.url)) return null;
  return result.data ?? null;
};

/**
 * Custom presentation mode only consumes resources explicitly authored for
 * that surface. Ordinary admin links and announcements remain course content
 * instead of unexpectedly replacing the learner's full course view.
 */
export const isCustomCoursePresentationItem = (item: ContentItem): boolean => {
  if (item.category !== 'admin') return false;
  if (item.metadata?.lmsContentType === 'custom') return true;
  if (item.metadata?.lmsCustomWidgetKind === 'link' || item.metadata?.lmsCustomWidgetKind === 'static' || item.metadata?.lmsCustomWidgetKind === 'workspace') return true;
  if (item.contentUrl && (item.description === 'Embedded HTTPS course site' || item.description === 'External HTTPS course site')) return true;
  if (!item.description?.trim().startsWith('{')) return false;
  try {
    const payload: unknown = JSON.parse(item.description);
    return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && (payload as { isCustomWidget?: unknown }).isCustomWidget === true);
  } catch {
    return false;
  }
};

/**
 * Returns true only when a custom-course item has something the learner view
 * can actually render. Keeping this check shared prevents the authoring
 * preflight and Student Feed from disagreeing about empty or malformed custom
 * widgets.
 */
export const isRenderableCustomCoursePresentationItem = (item: ContentItem): boolean => {
  if (!isCustomCoursePresentationItem(item)) return false;
  if (canonicalSafeHttpsUrl(item.contentUrl)) return true;
  if (parseCustomLearningWorkspace(item.description)) return true;
  if (!item.description?.trim().startsWith('{')) return false;
  try {
    const payload: unknown = JSON.parse(item.description);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const widget = payload as { isCustomWidget?: unknown; html?: unknown; css?: unknown };
    return widget.isCustomWidget === true && (
      (typeof widget.html === 'string' && Boolean(widget.html.trim()))
      || (typeof widget.css === 'string' && Boolean(widget.css.trim()))
    );
  } catch {
    return false;
  }
};

/** Legacy link widgets default to the new full-course presentation. */
export const getCourseSitePresentationMode = (item: ContentItem): CourseSitePresentationMode =>
  item.metadata?.lmsEmbedMode === 'external' ? 'external' : 'embedded';

/**
 * A true site-only course can hand the entire remaining app viewport to its
 * iframe. Any second learner content item keeps the ordinary scrolling page
 * so announcements or resources are never hidden behind the embed.
 */
export const getSingleEmbeddedSitePresentationItem = (items: ContentItem[]): ContentItem | null => {
  const visibleItems = items.filter(item => item.deletedAt === undefined);
  if (visibleItems.length !== 1) return null;
  const [item] = visibleItems;
  return isRenderableCustomCoursePresentationItem(item)
    && Boolean(canonicalSafeHttpsUrl(item.contentUrl))
    && getCourseSitePresentationMode(item) === 'embedded'
    ? item
    : null;
};
