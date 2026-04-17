/**
 * Solo DEV: snapshot getComputedStyle per debug layout Home shelf grid.
 */

function box(el, extra = {}) {
  if (!el || typeof getComputedStyle === "undefined") return null;
  const cs = getComputedStyle(el);
  return {
    width: cs.width,
    minWidth: cs.minWidth,
    maxWidth: cs.maxWidth,
    display: cs.display,
    justifySelf: cs.justifySelf,
    alignSelf: cs.alignSelf,
    flex: cs.flex,
    boxSizing: cs.boxSizing,
    ...extra,
  };
}

export function logHomeGridLayoutDebug(payload) {
  if (process.env.NODE_ENV !== "development") return;
  console.log("[HOME_GRID_LAYOUT_DEBUG]", payload);
}

/**
 * @param {HTMLElement | null} gridEl
 * @param {HTMLElement | null} firstTileEl
 * @param {HTMLElement | null} firstCardInnerEl
 * @param {{ containerInnerWidth?: number }} [extra]
 */
export function buildHomeGridLayoutDebugPayload(section, itemCount, columnsTarget, cellWidth, gridEl, firstTileEl, firstCardInnerEl, extra = {}) {
  const gridCs = gridEl ? getComputedStyle(gridEl) : null;
  return {
    section,
    itemCount,
    columnsTarget,
    cellWidth,
    containerInnerWidth: extra.containerInnerWidth,
    gridWrapper: gridCs
      ? {
          width: gridCs.width,
          minWidth: gridCs.minWidth,
          maxWidth: gridCs.maxWidth,
          display: gridCs.display,
          gridTemplateColumns: gridCs.gridTemplateColumns,
          justifyContent: gridCs.justifyContent,
          justifyItems: gridCs.justifyItems,
          alignContent: gridCs.alignContent,
          alignSelf: gridCs.alignSelf,
        }
      : null,
    firstTileWrapper: box(firstTileEl),
    firstCardInner: box(firstCardInnerEl),
  };
}
