export const MIN_FIT_COLS = 20;
export const MIN_FIT_ROWS = 5;

export function proposeFitDimensions(
  clientWidth: number,
  clientHeight: number,
  cellWidth: number,
  cellHeight: number,
  opts?: { scrollbarWidth?: number; minCols?: number; minRows?: number }
): { cols: number; rows: number } | null {
  const minCols = opts?.minCols == null ? 2 : opts.minCols;
  const minRows = opts?.minRows == null ? 1 : opts.minRows;
  const sb = Math.max(0, opts?.scrollbarWidth || 0);
  if (!(cellWidth > 0) || !(cellHeight > 0)) return null;
  const w = Math.max(0, Number(clientWidth) || 0) - sb;
  const h = Math.max(0, Number(clientHeight) || 0);
  return {
    cols: Math.max(minCols, Math.floor(w / cellWidth)),
    rows: Math.max(minRows, Math.floor(h / cellHeight)),
  };
}

export function clampRowsToClientHeight(
  rows: number,
  cellHeight: number,
  clientHeight: number
): number {
  let r = Math.max(1, rows | 0);
  const ch = Number(cellHeight) || 0;
  const h = Math.max(0, Number(clientHeight) || 0);
  if (!(ch > 0)) return r;
  while (r > 1 && r * ch > h) r--;
  return r;
}

export function canFitInHost(
  clientWidth: number,
  clientHeight: number,
  cellWidth: number,
  cellHeight: number,
  opts?: { minCols?: number; minRows?: number }
): boolean {
  const minCols = opts?.minCols == null ? MIN_FIT_COLS : opts.minCols;
  const minRows = opts?.minRows == null ? MIN_FIT_ROWS : opts.minRows;
  if (!(cellWidth > 0) || !(cellHeight > 0)) return false;
  const cols = Math.floor(Math.max(0, Number(clientWidth) || 0) / cellWidth);
  const rows = Math.floor(Math.max(0, Number(clientHeight) || 0) / cellHeight);
  return cols >= minCols && rows >= minRows;
}
