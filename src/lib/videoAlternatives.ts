/**
 * @fileoverview src/lib/videoAlternatives.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import {
  CourseVideoAlternatives,
  CourseVideoCaptionTrack,
} from '../types/lms';
import { canonicalSafeHttpsUrl } from './safeUrl';

export const MAX_VIDEO_CAPTION_TRACKS = 8;
export const MAX_VIDEO_ALTERNATIVE_LABEL_CHARACTERS = 120;
export const MAX_VIDEO_TRANSCRIPT_CHARACTERS = 100_000;
export const MAX_VIDEO_ALTERNATIVE_URL_CHARACTERS = 8_192;
export const MAX_VIDEO_LANGUAGE_TAG_CHARACTERS = 80;

const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const HAS_LABEL_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const HAS_UNSAFE_TRANSCRIPT_CONTROL_CHARACTER = /[\u0000\u000b\u000c\u000e-\u001f\u007f]/;

export interface VideoAlternativeValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type VideoAlternativeValidationResult =
  | { success: true; data: CourseVideoAlternatives | undefined }
  | { success: false; issues: VideoAlternativeValidationIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const issue = (
  issues: VideoAlternativeValidationIssue[],
  code: string,
  path: string,
  message: string,
) => issues.push({ code, path, message });

const rejectUnknownFields = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: VideoAlternativeValidationIssue[],
) => {
  Object.keys(value).forEach(key => {
    if (!allowed.includes(key)) issue(issues, 'unknown_video_alternative_field', path ? `${path}.${key}` : key, `Unknown video-alternative field "${key}".`);
  });
};

/**
 * Strict, bounded runtime validation shared by authoring, rendering, and the
 * institution schema. Malformed alternatives fail closed instead of becoming
 * learner-facing links or unbounded text.
 */
export const validateCourseVideoAlternatives = (value: unknown): VideoAlternativeValidationResult => {
  if (value === undefined || value === null) return { success: true, data: undefined };
  const issues: VideoAlternativeValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      success: false,
      issues: [{ code: 'invalid_video_alternatives', path: '', message: 'Video alternatives must be an object.' }],
    };
  }
  rejectUnknownFields(value, ['captionTracks', 'transcript'], '', issues);

  let captionTracks: CourseVideoCaptionTrack[] | undefined;
  if (value.captionTracks !== undefined) {
    if (!Array.isArray(value.captionTracks)) {
      issue(issues, 'invalid_video_caption_tracks', 'captionTracks', 'Caption tracks must be an array.');
    } else {
      if (value.captionTracks.length > MAX_VIDEO_CAPTION_TRACKS) {
        issue(issues, 'too_many_video_caption_tracks', 'captionTracks', `A video can have at most ${MAX_VIDEO_CAPTION_TRACKS} caption tracks.`);
      }
      const seenUrls = new Set<string>();
      let defaultCount = 0;
      const normalizedTracks: CourseVideoCaptionTrack[] = [];
      value.captionTracks.slice(0, MAX_VIDEO_CAPTION_TRACKS).forEach((entry, index) => {
        const path = `captionTracks[${index}]`;
        if (!isRecord(entry)) {
          issue(issues, 'invalid_video_caption_track', path, 'Each caption track must be an object.');
          return;
        }
        rejectUnknownFields(entry, ['url', 'language', 'label', 'format', 'isDefault'], path, issues);
        const url = canonicalSafeHttpsUrl(entry.url, MAX_VIDEO_ALTERNATIVE_URL_CHARACTERS);
        const language = typeof entry.language === 'string' ? entry.language.trim() : '';
        const label = typeof entry.label === 'string' ? entry.label.trim() : '';
        if (!url) issue(issues, 'unsafe_video_caption_url', `${path}.url`, 'Caption URLs must be valid HTTPS URLs without embedded credentials.');
        if (!language || language.length > MAX_VIDEO_LANGUAGE_TAG_CHARACTERS || !LANGUAGE_TAG.test(language)) issue(issues, 'invalid_video_caption_language', `${path}.language`, 'Use a BCP 47-style language tag such as en or fr-CA.');
        if (!label || label.length > MAX_VIDEO_ALTERNATIVE_LABEL_CHARACTERS || HAS_LABEL_CONTROL_CHARACTER.test(label)) issue(issues, 'invalid_video_caption_label', `${path}.label`, `Caption labels must contain 1–${MAX_VIDEO_ALTERNATIVE_LABEL_CHARACTERS} characters without control characters.`);
        if (entry.format !== 'text/vtt') issue(issues, 'invalid_video_caption_format', `${path}.format`, 'Caption tracks must declare the text/vtt WebVTT format.');
        if (entry.isDefault !== undefined && typeof entry.isDefault !== 'boolean') issue(issues, 'invalid_video_caption_default', `${path}.isDefault`, 'isDefault must be a boolean when present.');
        if (entry.isDefault === true) defaultCount += 1;
        if (url) {
          if (seenUrls.has(url)) issue(issues, 'duplicate_video_caption_url', `${path}.url`, 'Caption track URLs must be unique.');
          seenUrls.add(url);
        }
        if (url && language.length <= MAX_VIDEO_LANGUAGE_TAG_CHARACTERS && LANGUAGE_TAG.test(language) && label && label.length <= MAX_VIDEO_ALTERNATIVE_LABEL_CHARACTERS && !HAS_LABEL_CONTROL_CHARACTER.test(label) && entry.format === 'text/vtt') {
          normalizedTracks.push({
            url,
            language,
            label,
            format: 'text/vtt',
            ...(entry.isDefault === true ? { isDefault: true } : {}),
          });
        }
      });
      if (defaultCount > 1) issue(issues, 'multiple_default_video_captions', 'captionTracks', 'Only one caption track can be the default.');
      captionTracks = normalizedTracks.length ? normalizedTracks : undefined;
    }
  }

  let transcript: CourseVideoAlternatives['transcript'];
  if (value.transcript !== undefined) {
    if (!isRecord(value.transcript)) {
      issue(issues, 'invalid_video_transcript', 'transcript', 'The transcript must be an object.');
    } else {
      rejectUnknownFields(value.transcript, ['text', 'url', 'label'], 'transcript', issues);
      const text = typeof value.transcript.text === 'string' ? value.transcript.text.trim() : '';
      const url = value.transcript.url === undefined || value.transcript.url === ''
        ? undefined
        : canonicalSafeHttpsUrl(value.transcript.url, MAX_VIDEO_ALTERNATIVE_URL_CHARACTERS) ?? undefined;
      const label = typeof value.transcript.label === 'string' ? value.transcript.label.trim() : '';
      if (value.transcript.text !== undefined && typeof value.transcript.text !== 'string') issue(issues, 'invalid_video_transcript_text', 'transcript.text', 'Transcript text must be a string.');
      if (text.length > MAX_VIDEO_TRANSCRIPT_CHARACTERS) issue(issues, 'video_transcript_too_long', 'transcript.text', `Transcript text cannot exceed ${MAX_VIDEO_TRANSCRIPT_CHARACTERS.toLocaleString()} characters.`);
      if (HAS_UNSAFE_TRANSCRIPT_CONTROL_CHARACTER.test(text)) issue(issues, 'invalid_video_transcript_text', 'transcript.text', 'Transcript text contains unsupported control characters.');
      if (value.transcript.url !== undefined && !url) issue(issues, 'unsafe_video_transcript_url', 'transcript.url', 'Transcript links must be valid HTTPS URLs without embedded credentials.');
      if (value.transcript.label !== undefined && (!label || label.length > MAX_VIDEO_ALTERNATIVE_LABEL_CHARACTERS || HAS_LABEL_CONTROL_CHARACTER.test(label))) issue(issues, 'invalid_video_transcript_label', 'transcript.label', `Transcript labels must contain 1–${MAX_VIDEO_ALTERNATIVE_LABEL_CHARACTERS} characters without control characters.`);
      if (!text && !url) issue(issues, 'empty_video_transcript', 'transcript', 'Provide transcript text, an HTTPS transcript link, or both.');
      if ((text || url) && text.length <= MAX_VIDEO_TRANSCRIPT_CHARACTERS && !HAS_UNSAFE_TRANSCRIPT_CONTROL_CHARACTER.test(text) && (!label || (label.length <= MAX_VIDEO_ALTERNATIVE_LABEL_CHARACTERS && !HAS_LABEL_CONTROL_CHARACTER.test(label)))) {
        transcript = {
          ...(text ? { text } : {}),
          ...(url ? { url } : {}),
          ...(label ? { label } : {}),
        };
      }
    }
  }

  if (!captionTracks?.length && !transcript) issue(issues, 'empty_video_alternatives', '', 'Provide at least one caption track or a transcript.');
  if (issues.length) return { success: false, issues };
  return { success: true, data: { ...(captionTracks ? { captionTracks } : {}), ...(transcript ? { transcript } : {}) } };
};

export interface CourseVideoAlternativeDraft {
  captionTracks?: CourseVideoCaptionTrack[];
  transcriptText?: string;
  transcriptUrl?: string;
  transcriptLabel?: string;
}

/** Converts bounded teacher form fields to the canonical content-item shape. */
export const buildCourseVideoAlternatives = (draft: CourseVideoAlternativeDraft): CourseVideoAlternatives | undefined => {
  const hasCaptions = Boolean(draft.captionTracks?.length);
  const hasTranscript = Boolean(draft.transcriptText?.trim() || draft.transcriptUrl?.trim() || draft.transcriptLabel?.trim());
  if (!hasCaptions && !hasTranscript) return undefined;
  const result = validateCourseVideoAlternatives({
    ...(hasCaptions ? { captionTracks: draft.captionTracks } : {}),
    ...(hasTranscript ? {
      transcript: {
        ...(draft.transcriptText?.trim() ? { text: draft.transcriptText } : {}),
        ...(draft.transcriptUrl?.trim() ? { url: draft.transcriptUrl } : {}),
        ...(draft.transcriptLabel?.trim() ? { label: draft.transcriptLabel } : {}),
      },
    } : {}),
  });
  if (!result.success) throw new Error(result.issues[0]?.message || 'Video alternatives are invalid.');
  return result.data;
};

/**
 * Web caption tracks are fetched automatically by the media element. Binding
 * them to the already-authorized video asset origin prevents a teacher-entered
 * URL from becoming a silent third-party tracking request.
 */
export const areVideoCaptionTracksBoundToAsset = (
  alternatives: CourseVideoAlternatives | undefined,
  assetUrl: unknown,
): boolean => {
  if (!alternatives?.captionTracks?.length) return true;
  const canonicalAssetUrl = canonicalSafeHttpsUrl(assetUrl, MAX_VIDEO_ALTERNATIVE_URL_CHARACTERS);
  if (!canonicalAssetUrl) return false;
  const assetOrigin = new URL(canonicalAssetUrl).origin;
  return alternatives.captionTracks.every(track => {
    const captionUrl = canonicalSafeHttpsUrl(track.url, MAX_VIDEO_ALTERNATIVE_URL_CHARACTERS);
    return Boolean(captionUrl && new URL(captionUrl).origin === assetOrigin);
  });
};
