/**
 * @fileoverview src/lib/contentDateTime.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
const LEGACY_LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})\s*(AM|PM)$/i;
const ISO_DATE_TIME_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/i;

const validCalendarDate = (year: number, month: number, day: number): boolean => {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
};

type WallClockParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const zonedParts = (epoch: number, timeZone: string): WallClockParts | undefined => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(epoch));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const result = {
      year: Number(values.year), month: Number(values.month), day: Number(values.day),
      hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
    };
    return Object.values(result).every(Number.isFinite) ? result : undefined;
  } catch {
    return undefined;
  }
};

const sameWallClock = (left: WallClockParts, right: WallClockParts) =>
  left.year === right.year && left.month === right.month && left.day === right.day
  && left.hour === right.hour && left.minute === right.minute && left.second === right.second;

const offsetAt = (epoch: number, timeZone: string): number | undefined => {
  const parts = zonedParts(epoch, timeZone);
  if (!parts) return undefined;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    - Math.floor(epoch / 1_000) * 1_000;
};

/** Resolves a wall-clock value and rejects nonexistent or DST-ambiguous times. */
const epochForWallClock = (parts: WallClockParts, timeZone: string): number | undefined => {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsets = new Set([
    offsetAt(naive - 24 * 60 * 60 * 1_000, timeZone),
    offsetAt(naive, timeZone),
    offsetAt(naive + 24 * 60 * 60 * 1_000, timeZone),
  ].filter((value): value is number => value !== undefined));
  const matches = Array.from(offsets)
    .map(offset => naive - offset)
    .filter(candidate => {
      const resolved = zonedParts(candidate, timeZone);
      return resolved ? sameWallClock(resolved, parts) : false;
    });
  const unique = Array.from(new Set(matches));
  return unique.length === 1 ? unique[0] : undefined;
};

/** Institution transport must never depend on a client device's local zone. */
export const isExplicitContentDateTime = (value: unknown): boolean =>
  typeof value === 'number'
    ? Number.isFinite(value) && value >= 0
    : typeof value === 'string' && ISO_DATE_TIME_WITH_ZONE.test(value.trim()) && parseContentDateTime(value) !== undefined;

/**
 * Parses scheduling values without relying on implementation-specific Date.parse
 * behavior. New values use ISO-8601 with an explicit offset; the former LMS
 * editor format and legacy epoch values remain readable during migration.
 */
export const parseContentDateTime = (value: unknown, timeZone?: string): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();

  const legacy = trimmed.match(LEGACY_LOCAL_DATE_TIME);
  if (legacy) {
    const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawPeriod] = legacy;
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const day = Number(rawDay);
    const hour = Number(rawHour);
    const minute = Number(rawMinute);
    if (!validCalendarDate(year, month, day) || hour < 1 || hour > 12 || minute < 0 || minute > 59) return undefined;
    const hour24 = hour % 12 + (rawPeriod.toUpperCase() === 'PM' ? 12 : 0);
    const parsed = timeZone
      ? epochForWallClock({ year, month, day, hour: hour24, minute, second: 0 }, timeZone)
      : new Date(year, month - 1, day, hour24, minute, 0, 0).getTime();
    return parsed !== undefined && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  const iso = trimmed.match(ISO_DATE_TIME_WITH_ZONE);
  if (!iso) return undefined;
  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond = '0', rawMillisecond = '0', rawZone] = iso;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const second = Number(rawSecond);
  if (!validCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return undefined;
  if (rawZone !== 'Z' && rawZone !== 'z') {
    const [offsetHour, offsetMinute] = rawZone.slice(1).split(':').map(Number);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return undefined;
  }
  void rawMillisecond;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export const normalizeContentDateTime = (value: unknown, timeZone?: string): string | undefined => {
  const parsed = parseContentDateTime(value, timeZone);
  return parsed === undefined ? undefined : new Date(parsed).toISOString();
};

export const formatContentDateTimeForEditor = (value: unknown, timeZone?: string): string => {
  const parsed = parseContentDateTime(value);
  if (parsed === undefined) return typeof value === 'string' ? value : '';
  const date = new Date(parsed);
  const inZone = timeZone ? zonedParts(parsed, timeZone) : undefined;
  const year = inZone?.year ?? date.getFullYear();
  const month = String(inZone?.month ?? date.getMonth() + 1).padStart(2, '0');
  const day = String(inZone?.day ?? date.getDate()).padStart(2, '0');
  const hour24 = inZone?.hour ?? date.getHours();
  const hour12 = hour24 % 12 || 12;
  const minute = String(inZone?.minute ?? date.getMinutes()).padStart(2, '0');
  const period = hour24 >= 12 ? 'PM' : 'AM';
  return `${year}-${month}-${day} ${String(hour12).padStart(2, '0')}:${minute} ${period}`;
};
