import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_CANVAS_RESIZE_CONTROL_GAP,
  APP_CANVAS_RESIZE_CONTROL_SIZE,
  clampAppContentWidth,
  MAX_APP_CONTENT_WIDTH,
  MIN_APP_CONTENT_WIDTH,
  parseStoredAppContentWidth,
  resolveAppCanvasDragWidth,
  resolveAppCanvasKeyboardWidth,
  resolveAppCanvasMaxWidth,
  resolveAppCanvasResizeControlLeft,
  resolveAppCanvasViewportMaximum,
} from '../src/lib/appCanvasWidth';

test('desktop canvas width supports bounded continuous drag values', () => {
  assert.equal(clampAppContentWidth(913.4), 913);
  assert.equal(clampAppContentWidth(500), MIN_APP_CONTENT_WIDTH);
  assert.equal(clampAppContentWidth(2_000), MAX_APP_CONTENT_WIDTH);
  assert.equal(clampAppContentWidth(1_100, 980), 980);
});

test('stored desktop canvas widths accept bounded values and reject corruption', () => {
  assert.equal(parseStoredAppContentWidth('947'), 947);
  assert.equal(parseStoredAppContentWidth('1024.6'), 1025);
  assert.equal(parseStoredAppContentWidth('767'), null);
  assert.equal(parseStoredAppContentWidth('1281'), null);
  assert.equal(parseStoredAppContentWidth('not-a-number'), null);
});

test('narrow web and native canvases remain fluid when the resize grip is absent', () => {
  assert.equal(resolveAppCanvasMaxWidth(true, 850, 768), undefined);
  assert.equal(resolveAppCanvasMaxWidth(false, 1_200, 1_024), undefined);
  assert.equal(resolveAppCanvasMaxWidth(true, 900, 768), 768);
  assert.equal(resolveAppCanvasMaxWidth(true, 1_440, 1_120), 1_120);
});

test('desktop canvas reserves symmetric outside gutters for both resize controls', () => {
  for (const viewportWidth of [900, 1_024, 1_440, 1_920]) {
    const viewportMaximum = resolveAppCanvasViewportMaximum(viewportWidth);
    for (const displayedWidth of [MIN_APP_CONTENT_WIDTH, viewportMaximum]) {
      const canvasLeft = (viewportWidth - displayedWidth) / 2;
      const canvasRight = canvasLeft + displayedWidth;
      const leftControl = resolveAppCanvasResizeControlLeft('left', viewportWidth, displayedWidth);
      const rightControl = resolveAppCanvasResizeControlLeft('right', viewportWidth, displayedWidth);

      assert.ok(leftControl + APP_CANVAS_RESIZE_CONTROL_SIZE + APP_CANVAS_RESIZE_CONTROL_GAP <= canvasLeft);
      assert.ok(rightControl >= canvasRight + APP_CANVAS_RESIZE_CONTROL_GAP);
      assert.equal(leftControl + APP_CANVAS_RESIZE_CONTROL_SIZE + rightControl, viewportWidth);
    }
  }
  assert.equal(resolveAppCanvasViewportMaximum(900), 788);
  assert.equal(resolveAppCanvasViewportMaximum(1_920), MAX_APP_CONTENT_WIDTH);
});

test('left and right edge drags expand outward, contract inward, and stay bounded', () => {
  assert.equal(resolveAppCanvasDragWidth('left', 1_000, -25, 1_200), 1_050);
  assert.equal(resolveAppCanvasDragWidth('left', 1_000, 25, 1_200), 950);
  assert.equal(resolveAppCanvasDragWidth('right', 1_000, 25, 1_200), 1_050);
  assert.equal(resolveAppCanvasDragWidth('right', 1_000, -25, 1_200), 950);
  assert.equal(resolveAppCanvasDragWidth('left', 800, 100, 1_200), MIN_APP_CONTENT_WIDTH);
  assert.equal(resolveAppCanvasDragWidth('right', 1_180, 100, 1_200), 1_200);
});

test('both resize sliders share width-based keyboard semantics and bounds', () => {
  assert.equal(resolveAppCanvasKeyboardWidth('ArrowLeft', 900, 1_000), 868);
  assert.equal(resolveAppCanvasKeyboardWidth('ArrowDown', 900, 1_000), 868);
  assert.equal(resolveAppCanvasKeyboardWidth('ArrowRight', 900, 1_000), 932);
  assert.equal(resolveAppCanvasKeyboardWidth('ArrowUp', 900, 1_000), 932);
  assert.equal(resolveAppCanvasKeyboardWidth('Home', 900, 1_000), MIN_APP_CONTENT_WIDTH);
  assert.equal(resolveAppCanvasKeyboardWidth('End', 900, 1_000), 1_000);
  assert.equal(resolveAppCanvasKeyboardWidth('ArrowRight', 990, 1_000), 1_000);
  assert.equal(resolveAppCanvasKeyboardWidth('Escape', 900, 1_000), null);
});
