/**
 * Modalità presentazione Home «Ultimi risultati» (Immagini / Video / Film).
 * Solo UI: stessa sorgente dati, layout griglia vs elenco.
 */
export const HOME_SHELF_VIEW_MODE = Object.freeze({
  grid: "grid",
  list: "list",
});

/** @param {string | null | undefined} raw */
export function parseHomeShelfViewMode(raw) {
  const v = raw != null ? String(raw).trim() : "";
  if (v === HOME_SHELF_VIEW_MODE.list || v === HOME_SHELF_VIEW_MODE.grid) return v;
  return HOME_SHELF_VIEW_MODE.grid;
}
