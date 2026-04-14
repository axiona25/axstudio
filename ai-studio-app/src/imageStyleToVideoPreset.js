/**
 * imageStyleToVideoPreset.js
 *
 * Mappa lo stile di un'immagine AXSTUDIO (da metadata interni: history, sessionPromptMap)
 * nel preset Aspetto video compatibile (VIDEO_VISUAL_STYLE_PRESETS).
 *
 * - Preferisce sempre i metadata interni a qualsiasi inferenza.
 * - Gestisce sinonimi e alias comuni.
 * - Se il mapping non è affidabile restituisce null / confidence "low".
 * - Nessuna inferenza arbitraria.
 */

// ── Canonical video-preset IDs (specchio di VIDEO_VISUAL_STYLE_PRESETS in App.js) ──
const VALID_VIDEO_PRESET_IDS = new Set([
  "realistic", "cinematic", "fashion", "portrait", "vintage", "noir",
  "anime", "ghibli", "manga", "comic", "cartoon", "chibi", "pixel",
  "disney", "3d", "clay", "isometric", "painting", "watercolor",
  "pencil", "popart", "cyberpunk", "fantasy", "horror",
]);

// ── Alias → canonical video preset ID ──
// Chiavi in lowercase, senza trattini/underscore (normalizzate da normalizeKey).
const ALIAS_MAP = {
  // realistic
  "realistic":           "realistic",
  "photoreal":           "realistic",
  "photorealistic":      "realistic",
  "realistico":          "realistic",
  "cinematic realism":   "realistic",
  "photo":               "realistic",
  "photograph":          "realistic",
  "dslr":                "realistic",
  "raw photo":           "realistic",

  // cinematic
  "cinematic":           "cinematic",
  "cinematico":          "cinematic",
  "film":                "cinematic",
  "movie":               "cinematic",
  "cinema":              "cinematic",

  // fashion
  "fashion":             "fashion",
  "editorial":           "fashion",
  "runway":              "fashion",
  "haute couture":       "fashion",

  // portrait
  "portrait":            "portrait",
  "ritratto":            "portrait",
  "headshot":            "portrait",

  // vintage
  "vintage":             "vintage",
  "retro":               "vintage",
  "analog":              "vintage",
  "kodak":               "vintage",
  "film grain":          "vintage",
  "70s":                 "vintage",
  "1970s":               "vintage",

  // noir
  "noir":                "noir",
  "film noir":           "noir",
  "black and white":     "noir",
  "bw":                  "noir",
  "monochrome noir":     "noir",

  // anime
  "anime":               "anime",
  "manga anime":         "anime",
  "cel anime":           "anime",
  "cel shading":         "anime",
  "cel shaded":          "anime",
  "japanese animation":  "anime",

  // ghibli
  "ghibli":              "ghibli",
  "studio ghibli":       "ghibli",
  "miyazaki":            "ghibli",
  "ghibli watercolor":   "ghibli",

  // manga
  "manga":               "manga",
  "manga bw":            "manga",
  "ink manga":           "manga",
  "screentone":          "manga",

  // comic
  "comic":               "comic",
  "comic book":          "comic",
  "comic-book":          "comic",
  "comicbook":           "comic",
  "fumetto":             "comic",
  "graphic novel":       "comic",
  "western comic":       "comic",
  "marvel":              "comic",
  "dc comics":           "comic",
  "superhero comic":     "comic",

  // cartoon
  "cartoon":             "cartoon",
  "3d cartoon":          "cartoon",
  "animated":            "cartoon",
  "toon":                "cartoon",
  "animation":           "cartoon",
  "cartone":             "cartoon",
  "cartone animato":     "cartoon",

  // chibi
  "chibi":               "chibi",
  "kawaii":              "chibi",
  "super deformed":      "chibi",
  "sd style":            "chibi",

  // pixel
  "pixel":               "pixel",
  "pixel art":           "pixel",
  "pixelart":            "pixel",
  "8bit":                "pixel",
  "8-bit":               "pixel",
  "16bit":               "pixel",
  "16-bit":              "pixel",
  "retro game":          "pixel",
  "sprite":              "pixel",

  // disney / pixar
  "disney":              "disney",
  "pixar":               "disney",
  "disney pixar":        "disney",
  "disney/pixar":        "disney",
  "3d animated":         "disney",

  // 3d
  "3d":                  "3d",
  "3d render":           "3d",
  "3d rendering":        "3d",
  "cgi":                 "3d",
  "blender":             "3d",
  "octane":              "3d",
  "unreal engine":       "3d",

  // clay
  "clay":                "clay",
  "claymation":          "clay",
  "plasticine":          "clay",
  "stop motion":         "clay",
  "stop-motion":         "clay",
  "clay animation":      "clay",
  "play-doh":            "clay",
  "playdoh":             "clay",

  // isometric
  "isometric":           "isometric",
  "isometrico":          "isometric",
  "diorama":             "isometric",
  "miniature":           "isometric",

  // painting
  "painting":            "painting",
  "oil painting":        "painting",
  "oil":                 "painting",
  "olio":                "painting",
  "pittura":             "painting",
  "old master":          "painting",
  "classical painting":  "painting",
  "renaissance":         "painting",

  // watercolor
  "watercolor":          "watercolor",
  "acquerello":          "watercolor",
  "watercolour":         "watercolor",
  "aquarelle":           "watercolor",

  // pencil
  "pencil":              "pencil",
  "pencil drawing":      "pencil",
  "graphite":            "pencil",
  "sketch":              "pencil",
  "matita":              "pencil",
  "disegno":             "pencil",

  // popart
  "popart":              "popart",
  "pop art":             "popart",
  "pop-art":             "popart",
  "warhol":              "popart",
  "lichtenstein":        "popart",

  // cyberpunk
  "cyberpunk":           "cyberpunk",
  "cyber punk":          "cyberpunk",
  "neon":                "cyberpunk",
  "neon city":           "cyberpunk",
  "synthwave":           "cyberpunk",

  // fantasy
  "fantasy":             "fantasy",
  "epic fantasy":        "fantasy",
  "high fantasy":        "fantasy",
  "magic":               "fantasy",
  "enchanted":           "fantasy",
  "medieval fantasy":    "fantasy",

  // horror
  "horror":              "horror",
  "dark horror":         "horror",
  "creepy":              "horror",
  "gothic":              "horror",
  "macabre":             "horror",
};

// ── Helpers ──

function normalizeKey(s) {
  return s
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Risolve un singolo stile-label o style-id in un video preset ID.
 * @param {string} raw - style id, tag, o alias testuale
 * @returns {{ presetId: string, confidence: "high"|"medium" } | null}
 */
function resolveOne(raw) {
  if (!raw || typeof raw !== "string") return null;
  const key = normalizeKey(raw);
  if (!key) return null;

  // 1) ID diretto valido
  if (VALID_VIDEO_PRESET_IDS.has(key)) {
    return { presetId: key, confidence: "high" };
  }

  // 2) Alias esatto
  if (ALIAS_MAP[key]) {
    return { presetId: ALIAS_MAP[key], confidence: "high" };
  }

  // 3) Tag con @ (es. "@realistico")
  if (key.startsWith("@")) {
    const tagBody = key.slice(1);
    const byTag = ALIAS_MAP[tagBody];
    if (byTag) return { presetId: byTag, confidence: "high" };
  }

  // 4) Substring match sugli alias (solo se un unico alias contiene la chiave)
  const partials = Object.entries(ALIAS_MAP)
    .filter(([alias]) => alias.includes(key) || key.includes(alias));
  const uniqueTargets = [...new Set(partials.map(([, v]) => v))];
  if (uniqueTargets.length === 1) {
    return { presetId: uniqueTargets[0], confidence: "medium" };
  }

  return null;
}

/**
 * Dato un record di history/metadata AXSTUDIO, restituisce il video preset
 * Aspetto più appropriato.
 *
 * Priorità dei segnali (prima = più affidabile):
 *   1. params.selectedStyles (array di style preset IDs salvati da AXSTUDIO)
 *   2. tag esplicito nel prompt
 *   3. nessun mapping → null
 *
 * @param {object} metadata
 * @param {string[]} [metadata.selectedStyles] - style IDs dal salvataggio immagine
 * @param {string}   [metadata.prompt]         - prompt inglese usato per la generazione
 * @param {string}   [metadata.userIdea]       - idea utente in italiano
 * @returns {{ presetId: string, confidence: "high"|"medium"|"low", source: string } | null}
 */
const PROMPT_KEYWORD_BLOCKLIST = new Set([
  "photo", "film", "neon", "magic", "oil", "retro", "analog",
  "sketch", "animated", "animation", "enchanted", "gothic",
  "bw", "3d", "sprite",
]);

const PROMPT_KEYWORD_ENTRIES = Object.entries(ALIAS_MAP)
  .filter(([alias]) => alias.length >= 4 && !PROMPT_KEYWORD_BLOCKLIST.has(alias))
  .sort((a, b) => b[0].length - a[0].length);

function scanKeywords(text) {
  if (!text || text.length < 4) return null;
  const lower = text.toLowerCase();
  for (const [alias, target] of PROMPT_KEYWORD_ENTRIES) {
    const idx = lower.indexOf(alias);
    if (idx === -1) continue;
    const before = idx > 0 ? lower[idx - 1] : " ";
    const after = idx + alias.length < lower.length ? lower[idx + alias.length] : " ";
    if (/\w/.test(before) || /\w/.test(after)) continue;
    return target;
  }
  return null;
}

export function resolveVideoPresetFromImageMeta(metadata) {
  if (!metadata || typeof metadata !== "object") return null;

  const styles = metadata.selectedStyles;

  // ── 1. selectedStyles (metadata affidabili AXSTUDIO) ──
  if (Array.isArray(styles) && styles.length > 0) {
    for (const sid of styles) {
      const r = resolveOne(sid);
      if (r) return { ...r, source: "selectedStyles" };
    }
  }

  // ── 2. Template scena (se riconoscibile come stile) ──
  if (metadata.template) {
    const r = resolveOne(metadata.template);
    if (r) return { presetId: r.presetId, confidence: "medium", source: "template" };
  }

  const prompts = [metadata.prompt, metadata.userIdea].filter(Boolean).join(" ");

  // ── 3. Tag @ nel prompt ──
  const tagMatch = prompts.match(/@(\w+)/g);
  if (tagMatch) {
    for (const tag of tagMatch) {
      const r = resolveOne(tag);
      if (r) return { presetId: r.presetId, confidence: "medium", source: "promptTag" };
    }
  }

  // ── 4. Keyword stilistiche nel prompt utente (senza @) ──
  const kw = scanKeywords(prompts);
  if (kw) return { presetId: kw, confidence: "medium", source: "promptKeyword" };

  // ── 5. Keyword stilistiche nel prompt completo iniettato (contiene prefissi stile) ──
  if (metadata.promptFull && metadata.promptFull !== metadata.prompt) {
    const kwFull = scanKeywords(metadata.promptFull);
    if (kwFull) return { presetId: kwFull, confidence: "low", source: "promptFullKeyword" };
  }

  // ── 6. Nessun mapping affidabile ──
  return null;
}

/**
 * Risolve un singolo stile raw (id, tag, alias) in video preset.
 * Utile quando si ha già lo style id isolato.
 *
 * @param {string} raw
 * @returns {{ presetId: string, confidence: "high"|"medium" } | null}
 */
export function resolveVideoPresetFromStyleId(raw) {
  return resolveOne(raw);
}

/**
 * Batch: dato un array di style ids, restituisce tutti i preset video mappabili.
 *
 * @param {string[]} styleIds
 * @returns {Array<{ presetId: string, confidence: "high"|"medium", sourceId: string }>}
 */
export function resolveVideoPresetsFromStyleIds(styleIds) {
  if (!Array.isArray(styleIds)) return [];
  const results = [];
  const seen = new Set();
  for (const sid of styleIds) {
    const r = resolveOne(sid);
    if (r && !seen.has(r.presetId)) {
      seen.add(r.presetId);
      results.push({ ...r, sourceId: sid });
    }
  }
  return results;
}

/**
 * Tenta di inferire il preset video dal nome file di un'immagine esterna.
 * Cerca keyword stilistiche nel filename (senza estensione).
 *
 * @param {string} filename - nome file (es. "my_anime_hero.png")
 * @returns {{ presetId: string, confidence: "medium" } | null}
 */
const FILENAME_GENERIC_BLOCKLIST = new Set([
  "photo", "image", "img", "pic", "picture", "shot", "screenshot",
  "screen", "frame", "file", "scan", "capture", "copy", "final",
  "draft", "edit", "new", "old", "test", "tmp", "temp",
  "neon", "magic",
]);

export function resolveVideoPresetFromFilename(filename) {
  if (!filename || typeof filename !== "string") return null;
  const base = filename.replace(/\.[^.]+$/, "");
  const key = normalizeKey(base);
  if (!key || key.length < 3) return null;

  const tokens = key.split(/\s+/);
  for (const token of tokens) {
    if (token.length < 3 || FILENAME_GENERIC_BLOCKLIST.has(token)) continue;
    const hit = ALIAS_MAP[token];
    if (hit) return { presetId: hit, confidence: "medium" };
  }

  for (const [alias, target] of Object.entries(ALIAS_MAP)) {
    if (alias.length >= 5 && !FILENAME_GENERIC_BLOCKLIST.has(alias) && key.includes(alias)) {
      return { presetId: target, confidence: "medium" };
    }
  }

  return null;
}

// ── Esportazioni per testing ──
export { VALID_VIDEO_PRESET_IDS, ALIAS_MAP, normalizeKey, resolveOne };
