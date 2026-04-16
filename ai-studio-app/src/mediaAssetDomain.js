/** Dominio contenuto: separa asset «liberi» da asset Scenografie (non devono comparire in Home / Immagine libera / Video libero). */

export const ASSET_DOMAIN = {
  FREE_IMAGE: "free_image",
  FREE_VIDEO: "free_video",
  SCENOGRAFIE: "scenografie",
};

export function mergeImageSaveParams(params = {}) {
  const p = { ...(params && typeof params === "object" ? params : {}) };
  if (
    p.assetDomain === ASSET_DOMAIN.SCENOGRAFIE ||
    p.projectImageMode === "scenografia" ||
    String(p.type || "").startsWith("scenografia")
  ) {
    p.assetDomain = ASSET_DOMAIN.SCENOGRAFIE;
  } else if (!p.assetDomain) {
    p.assetDomain = ASSET_DOMAIN.FREE_IMAGE;
  }
  return p;
}

export function mergeVideoSaveParams(params = {}) {
  const p = { ...(params && typeof params === "object" ? params : {}) };
  if (
    p.assetDomain === ASSET_DOMAIN.SCENOGRAFIE ||
    String(p.type || "").startsWith("scenografia") ||
    p.scenografiaVideo === true
  ) {
    p.assetDomain = ASSET_DOMAIN.SCENOGRAFIE;
  } else if (!p.assetDomain) {
    p.assetDomain = ASSET_DOMAIN.FREE_VIDEO;
  }
  return p;
}

export function historyRecordIsScenografieDomain(h) {
  if (!h || typeof h !== "object") return false;
  if (h.params?.assetDomain === ASSET_DOMAIN.SCENOGRAFIE) return true;
  if (h.type === "image" && h.params?.projectImageMode === "scenografia") return true;
  const t = String(h.params?.type || "");
  if (t.startsWith("scenografia")) return true;
  return false;
}

export function diskMediaEntryIsScenografieScoped(entry) {
  if (!entry) return false;
  const name = entry.fileName || "";
  if (name.startsWith("sceno_img_") || name.startsWith("sceno_vid_")) return true;
  if (entry.params?.assetDomain === ASSET_DOMAIN.SCENOGRAFIE) return true;
  return false;
}

/** Percorsi file già associati a una voce history Scenografie (evita doppioni da catalogo disco). */
export function collectScenografieAssetFilePaths(history) {
  const s = new Set();
  for (const h of history || []) {
    if (!historyRecordIsScenografieDomain(h)) continue;
    if (h.filePath) s.add(h.filePath);
  }
  return s;
}
