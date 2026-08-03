/**
 * ClientHeight-safe terminal geometry for xterm FitAddon.
 *
 * FitAddon measures parent via parseInt(getComputedStyle(height)). That can
 * overshoot parent.clientHeight after windowed layout settle / DPI / a
 * horizontal scrollbar eating height. Oversized rows shrink xterm's scroll
 * area so mouse-wheel cannot reach the true bottom (End still works).
 *
 * Also: never fit while the host is still collapsed (0×0 / tiny). FitAddon
 * mins are 2×1 — that reflows scrollback and makes CLIs reprint banners as
 * one character per line permanently.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SeMaTermFitSafe = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  /** Below this, skip fit/PTY resize (pane min-width ~240px ≈ 20+ cols). */
  const MIN_FIT_COLS = 20;
  const MIN_FIT_ROWS = 5;

  /**
   * @param {number} clientWidth
   * @param {number} clientHeight
   * @param {number} cellWidth
   * @param {number} cellHeight
   * @param {{ scrollbarWidth?: number, minCols?: number, minRows?: number }} [opts]
   * @returns {{ cols: number, rows: number } | null}
   */
  function proposeFitDimensions(
    clientWidth,
    clientHeight,
    cellWidth,
    cellHeight,
    opts
  ) {
    const o = opts || {};
    const minCols = o.minCols == null ? 2 : o.minCols;
    const minRows = o.minRows == null ? 1 : o.minRows;
    const sb = Math.max(0, o.scrollbarWidth || 0);
    if (!(cellWidth > 0) || !(cellHeight > 0)) return null;
    const w = Math.max(0, Number(clientWidth) || 0) - sb;
    const h = Math.max(0, Number(clientHeight) || 0);
    return {
      cols: Math.max(minCols, Math.floor(w / cellWidth)),
      rows: Math.max(minRows, Math.floor(h / cellHeight)),
    };
  }

  /**
   * Reduce rows until rows * cellHeight fits in clientHeight.
   * @param {number} rows
   * @param {number} cellHeight
   * @param {number} clientHeight
   * @returns {number}
   */
  function clampRowsToClientHeight(rows, cellHeight, clientHeight) {
    let r = Math.max(1, rows | 0);
    const ch = Number(cellHeight) || 0;
    const h = Math.max(0, Number(clientHeight) || 0);
    if (!(ch > 0)) return r;
    while (r > 1 && r * ch > h) r--;
    return r;
  }

  /**
   * True when the host can hold a usable grid (not a settle-frame 0×0).
   * @param {number} clientWidth
   * @param {number} clientHeight
   * @param {number} cellWidth
   * @param {number} cellHeight
   * @param {{ minCols?: number, minRows?: number }} [opts]
   * @returns {boolean}
   */
  function canFitInHost(
    clientWidth,
    clientHeight,
    cellWidth,
    cellHeight,
    opts
  ) {
    const o = opts || {};
    const minCols = o.minCols == null ? MIN_FIT_COLS : o.minCols;
    const minRows = o.minRows == null ? MIN_FIT_ROWS : o.minRows;
    if (!(cellWidth > 0) || !(cellHeight > 0)) return false;
    const cols = Math.floor(Math.max(0, Number(clientWidth) || 0) / cellWidth);
    const rows = Math.floor(Math.max(0, Number(clientHeight) || 0) / cellHeight);
    return cols >= minCols && rows >= minRows;
  }

  return {
    MIN_FIT_COLS,
    MIN_FIT_ROWS,
    proposeFitDimensions,
    clampRowsToClientHeight,
    canFitInHost,
  };
});
