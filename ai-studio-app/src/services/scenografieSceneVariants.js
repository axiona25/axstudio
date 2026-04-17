/**
 * Varianti scena Scenografie: base (FLUX), finale (post identity lock), variante attiva mostrata / usata dai clip.
 *
 * Policy default (senza preferenza utente persistita):
 * - se esiste URL finale → variante attiva = finale
 * - altrimenti → base se c’è, altrimenti finale vuoto
 * L’utente può forzare "base" quando entrambe esistono; la scelta resta in sceneDisplayedVariant.
 */

export const SCENE_DISPLAY_VARIANT = {
  BASE: "base",
  FINAL: "final",
};

function trimUrl(v) {
  return v != null ? String(v).trim() : "";
}

function shortUrl(u, max = 96) {
  const s = trimUrl(u);
  if (!s) return "(empty)";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function pickSceneBaseUrlFromRaw(r) {
  if (!r || typeof r !== "object") return null;
  return (
    trimUrl(r.sceneBaseUrl) ||
    trimUrl(r.baseImageUrl) ||
    trimUrl(r.scene_base_url) ||
    null
  );
}

export function pickSceneFinalUrlFromRaw(r) {
  if (!r || typeof r !== "object") return null;
  return (
    trimUrl(r.sceneFinalUrl) ||
    trimUrl(r.final_output_url) ||
    trimUrl(r.finalOutputUrl) ||
    null
  );
}

/**
 * Migrazione: riga vecchia con solo imageUrl → duplica su base e finale così non si perde nulla.
 * @returns {{ base: string|null, final: string|null }}
 */
export function coalesceSceneUrlsFromLegacyRow(r, base, finalU) {
  let b = base ? trimUrl(base) : null;
  let f = finalU ? trimUrl(finalU) : null;
  const legacy = trimUrl(r?.imageUrl);
  if (!b && !f && legacy) {
    return { base: legacy, final: legacy };
  }
  if (!b && f && legacy && legacy !== f) {
    b = legacy;
  }
  if (!f && b && legacy && legacy !== b) {
    f = legacy;
  }
  if (!b && legacy) b = legacy;
  if (!f && legacy) f = legacy;
  return { base: b || null, final: f || null };
}

export function parseUserSceneVariant(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === SCENE_DISPLAY_VARIANT.BASE || s === "base_image") return SCENE_DISPLAY_VARIANT.BASE;
  if (s === SCENE_DISPLAY_VARIANT.FINAL || s === "final" || s === "post_pipeline_final") {
    return SCENE_DISPLAY_VARIANT.FINAL;
  }
  return null;
}

/**
 * @param {string|null} base
 * @param {string|null} finalU
 * @param {'base'|'final'|null} userPreference — da campo persistito
 */
export function resolveDefaultSceneVariant(base, finalU, userPreference) {
  const hasB = !!trimUrl(base);
  const hasF = !!trimUrl(finalU);

  if (userPreference === SCENE_DISPLAY_VARIANT.BASE) {
    if (hasB) return SCENE_DISPLAY_VARIANT.BASE;
    if (hasF) return SCENE_DISPLAY_VARIANT.FINAL;
    return SCENE_DISPLAY_VARIANT.FINAL;
  }
  if (userPreference === SCENE_DISPLAY_VARIANT.FINAL) {
    if (hasF) return SCENE_DISPLAY_VARIANT.FINAL;
    if (hasB) return SCENE_DISPLAY_VARIANT.BASE;
    return SCENE_DISPLAY_VARIANT.FINAL;
  }
  if (hasF) return SCENE_DISPLAY_VARIANT.FINAL;
  if (hasB) return SCENE_DISPLAY_VARIANT.BASE;
  return SCENE_DISPLAY_VARIANT.FINAL;
}

export function computeSceneDisplayedUrl(base, finalU, variant) {
  if (variant === SCENE_DISPLAY_VARIANT.BASE && trimUrl(base)) return trimUrl(base);
  if (variant === SCENE_DISPLAY_VARIANT.FINAL && trimUrl(finalU)) return trimUrl(finalU);
  if (variant === SCENE_DISPLAY_VARIANT.BASE && !trimUrl(base) && trimUrl(finalU)) return trimUrl(finalU);
  if (variant === SCENE_DISPLAY_VARIANT.FINAL && !trimUrl(finalU) && trimUrl(base)) return trimUrl(base);
  return trimUrl(finalU) || trimUrl(base) || "";
}

/**
 * URL immagine da passare a Kling / readiness (variante attiva).
 * @param {object} row
 */
export function getSceneClipPipelineImageUrl(row) {
  return trimUrl(row?.sceneDisplayedUrl) || trimUrl(row?.imageUrl) || "";
}

/**
 * @param {object} row — normalizzata o grezza
 */
export function logSceneVariantState(tag, row) {
  if (typeof console === "undefined" || !console.info) return;
  console.info("[AXSTUDIO · scene variant state]", {
    tag,
    sceneId: row?.sceneId,
    hasBaseUrl: !!trimUrl(row?.sceneBaseUrl || row?.baseImageUrl),
    hasFinalUrl: !!trimUrl(row?.sceneFinalUrl),
    sceneDisplayedVariant: row?.sceneDisplayedVariant,
    sceneDisplayedUrl: shortUrl(row?.sceneDisplayedUrl || row?.imageUrl),
    sceneBaseUrl: shortUrl(row?.sceneBaseUrl || row?.baseImageUrl),
    sceneFinalUrl: shortUrl(row?.sceneFinalUrl),
    historyLen: Array.isArray(row?.sceneVariantHistory) ? row.sceneVariantHistory.length : 0,
  });
}

/**
 * @param {object} clip
 * @param {object} row
 * @param {string} urlUsed
 */
export function logClipSceneSource(clip, row, urlUsed) {
  if (typeof console === "undefined" || !console.info) return;
  console.info("[AXSTUDIO · clip scene source]", {
    clipId: clip?.id,
    sceneId: clip?.sceneId,
    activeVariant: row?.sceneDisplayedVariant,
    sceneBaseUrl: shortUrl(row?.sceneBaseUrl || row?.baseImageUrl),
    sceneFinalUrl: shortUrl(row?.sceneFinalUrl),
    urlPassedToVideoPipeline: shortUrl(urlUsed),
  });
}

/**
 * Normalizza una riga sceneResults per persistenza e UI.
 * @param {object} r
 */
export function normalizeSceneResultRow(r) {
  if (!r || typeof r !== "object" || !r.sceneId) return r;
  const hist = Array.isArray(r.sceneVariantHistory) ? r.sceneVariantHistory.slice(-24) : [];

  let base = pickSceneBaseUrlFromRaw(r);
  let finalU = pickSceneFinalUrlFromRaw(r);
  const merged = coalesceSceneUrlsFromLegacyRow(r, base, finalU);
  base = merged.base;
  finalU = merged.final;

  const userVar = parseUserSceneVariant(r.sceneDisplayedVariant ?? r.displayedVariant);
  const variant = resolveDefaultSceneVariant(base, finalU, userVar);
  const displayed = computeSceneDisplayedUrl(base, finalU, variant);

  const row = {
    sceneId: r.sceneId,
    title: r.title,
    sceneBaseUrl: base,
    sceneFinalUrl: finalU,
    sceneDisplayedUrl: displayed,
    sceneDisplayedVariant: variant,
    sceneVariantHistory: hist,
    baseImageUrl: base,
    imageUrl: displayed,
    displayedVariant: variant === SCENE_DISPLAY_VARIANT.FINAL ? "final" : "base",
    approved: r.approved === true,
    approvedAt: r.approvedAt ?? null,
    lastEditPrompt: r.lastEditPrompt ?? null,
    editHistory: Array.isArray(r.editHistory) ? r.editHistory.slice(-8) : [],
    lastUpdatedAt: r.lastUpdatedAt ?? null,
  };
  if (Array.isArray(r.mastersUsed)) row.mastersUsed = r.mastersUsed;
  return row;
}

/**
 * Miniatura / card: preferisci sempre la variante attiva.
 * @param {object} r
 */
export function resolveSceneThumbnailUrl(r) {
  if (!r || typeof r !== "object") return "";
  const ordered = [
    r.sceneDisplayedUrl,
    r.imageUrl,
    r.sceneFinalUrl,
    r.final_output_url,
    r.finalOutputUrl,
    r.sceneBaseUrl,
    r.baseImageUrl,
    r.scene_base_url,
  ];
  for (const c of ordered) {
    const s = trimUrl(c);
    if (s) return s;
  }
  return "";
}
