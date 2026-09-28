/**
 * @fileoverview src/lib/appCanvasWidth.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
export const MIN_APP_CONTENT_WIDTH = 768;
export const MAX_APP_CONTENT_WIDTH = 1280;
export const MIN_RESIZABLE_VIEWPORT_WIDTH = 900;
export const APP_CANVAS_RESIZE_CONTROL_SIZE = 44;
export const APP_CANVAS_RESIZE_CONTROL_GAP = 8;
export const APP_CANVAS_RESIZE_VIEWPORT_INSET = 4;

export type AppCanvasResizeSide = 'left' | 'right';

const APP_CANVAS_RESIZE_HORIZONTAL_SPACE = 2 * (
  APP_CANVAS_RESIZE_CONTROL_SIZE
  + APP_CANVAS_RESIZE_CONTROL_GAP
  + APP_CANVAS_RESIZE_VIEWPORT_INSET
);

export const clampAppContentWidth = (
  value: number,
  maximum = MAX_APP_CONTENT_WIDTH,
): number => {
  const safeMaximum = Math.max(MIN_APP_CONTENT_WIDTH, Math.min(MAX_APP_CONTENT_WIDTH, Math.floor(maximum)));
  if (!Number.isFinite(value)) return MIN_APP_CONTENT_WIDTH;
  return Math.round(Math.max(MIN_APP_CONTENT_WIDTH, Math.min(safeMaximum, value)));
};

export const parseStoredAppContentWidth = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_APP_CONTENT_WIDTH || parsed > MAX_APP_CONTENT_WIDTH) return null;
  return Math.round(parsed);
};

export const resolveAppCanvasViewportMaximum = (viewportWidth: number): number => {
  if (!Number.isFinite(viewportWidth)) return MIN_APP_CONTENT_WIDTH;
  return clampAppContentWidth(viewportWidth - APP_CANVAS_RESIZE_HORIZONTAL_SPACE);
};

export const resolveAppCanvasResizeControlLeft = (
  side: AppCanvasResizeSide,
  viewportWidth: number,
  displayedWidth: number,
): number => {
  const canvasLeft = (viewportWidth - displayedWidth) / 2;
  const canvasRight = canvasLeft + displayedWidth;
  const idealLeft = side === 'left'
    ? canvasLeft - APP_CANVAS_RESIZE_CONTROL_GAP - APP_CANVAS_RESIZE_CONTROL_SIZE
    : canvasRight + APP_CANVAS_RESIZE_CONTROL_GAP;
  return Math.round(Math.max(
    APP_CANVAS_RESIZE_VIEWPORT_INSET,
    Math.min(viewportWidth - APP_CANVAS_RESIZE_CONTROL_SIZE - APP_CANVAS_RESIZE_VIEWPORT_INSET, idealLeft),
  ));
};

export const resolveAppCanvasDragWidth = (
  side: AppCanvasResizeSide,
  startingWidth: number,
  horizontalDrag: number,
  maximum: number,
): number => clampAppContentWidth(
  startingWidth + horizontalDrag * (side === 'left' ? -2 : 2),
  maximum,
);

export const resolveAppCanvasKeyboardWidth = (
  key: string | undefined,
  currentWidth: number,
  maximum: number,
): number | null => {
  if (key === 'ArrowLeft' || key === 'ArrowDown') {
    return clampAppContentWidth(currentWidth - 32, maximum);
  }
  if (key === 'ArrowRight' || key === 'ArrowUp') {
    return clampAppContentWidth(currentWidth + 32, maximum);
  }
  if (key === 'Home') return MIN_APP_CONTENT_WIDTH;
  if (key === 'End') return clampAppContentWidth(maximum, maximum);
  return null;
};

export const resolveAppCanvasMaxWidth = (
  isWeb: boolean,
  viewportWidth: number,
  displayedWidth: number,
): number | undefined => {
  if (!isWeb || !Number.isFinite(viewportWidth) || viewportWidth < MIN_RESIZABLE_VIEWPORT_WIDTH) {
    return undefined;
  }
  return displayedWidth;
};
