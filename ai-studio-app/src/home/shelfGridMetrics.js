/**
 * Metriche deterministiche per la "vetrina" Home (stile Netflix desktop).
 * Altezza cella = (altezza utile − gap verticali) / righe visibili.
 */

/** Vista normale: 4×4 visibili senza scroll; scroll dalla 5ª riga. */
export const HOME_SHELF_GRID_NORMAL = Object.freeze({
  columns: 4,
  visibleRows: 4,
  gap: 10,
});

/** Tab Home «Film»: 4 colonne come la vetrina normale, locandine in formato compatto. */
export const HOME_SHELF_GRID_FILM = Object.freeze({
  columns: 4,
  visibleRows: 4,
  gap: 12,
});

/** Vista compatta: 8×8 visibili senza scroll; scroll dalla 9ª riga. */
export const HOME_SHELF_GRID_COMPACT = Object.freeze({
  columns: 8,
  visibleRows: 8,
  gap: 6,
});

/**
 * @param {number} innerWidth — larghezza interna dello scrollport (px)
 * @param {number} innerHeight — altezza interna dello scrollport (px)
 * @param {{ columns: number, visibleRows: number, gap: number }} layout
 */
export function computeShelfGridMetrics(innerWidth, innerHeight, layout) {
  const columns = Math.max(1, Math.floor(Number(layout.columns) || 1));
  const visibleRows = Math.max(1, Math.floor(Number(layout.visibleRows) || 1));
  const gap = Math.max(0, Number(layout.gap) || 0);

  const colGaps = (columns - 1) * gap;
  const rowGaps = (visibleRows - 1) * gap;
  const w = Math.max(0, innerWidth - colGaps);
  const h = Math.max(0, innerHeight - rowGaps);

  /** Larghezza slot fissa: solo innerWidth, gap e columns — mai itemCount. */
  const cellWidth = Math.max(0, Math.floor(w / columns));
  const cellHeight = h / visibleRows;

  return {
    columns,
    visibleRows,
    gap,
    cellWidth,
    /** Altezza riga unica per grid-auto-rows e per minHeight contenuto (stesso valore → niente scroll “anticipato”). */
    cellHeight,
  };
}

/**
 * Altezza minima del contenuto griglia per far scorrere tutte le card (incl. righe parziali).
 * @param {number} itemCount
 * @param {number} columns
 * @param {number} cellHeight
 * @param {number} gap
 */
export function shelfGridContentMinHeight(itemCount, columns, cellHeight, gap) {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const n = Math.max(0, Math.floor(itemCount) || 0);
  if (n === 0) return 0;
  const rows = Math.ceil(n / cols);
  const g = Math.max(0, gap || 0);
  return rows * cellHeight + (rows - 1) * g;
}
