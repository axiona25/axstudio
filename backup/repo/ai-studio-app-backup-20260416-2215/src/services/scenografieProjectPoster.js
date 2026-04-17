/**
 * Locandina ufficiale progetto Scenografie — key art da catalogo streaming (non scena narrativa).
 * Prompt dedicato: titolo, descrizione, stile globale, protagonisti opzionali, keyword planner opzionali.
 */

import { falRequest, MODELS } from "./imagePipeline.js";

export const PROJECT_POSTER_STATUS = {
  NONE: "none",
  PENDING: "pending",
  GENERATING: "generating",
  READY: "ready",
  FAILED: "failed",
};

function extractFluxImageUrl(result) {
  return result?.images?.[0]?.url || result?.image?.url || null;
}

/**
 * @param {object} c
 * @returns {string}
 */
function characterOneLiner(c) {
  if (!c || typeof c !== "object") return "";
  const name = String(c.name || "").trim();
  if (!name) return "";
  const role = String(c.character_role || (c.is_protagonist ? "protagonist" : "")).trim();
  const ap = String(c.appearance_prompt || "").trim().slice(0, 220);
  const bits = [name, role && `(${role})`, ap && `look: ${ap}`].filter(Boolean);
  return bits.join(" — ");
}

function normBrief(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Quanto il nome del personaggio è legato a titolo/descrizione progetto (evita "primo della lista").
 * @param {object} c
 * @param {string} title
 * @param {string} description
 */
function characterBriefAffinityScore(c, title, description) {
  const blob = normBrief(`${title} ${description}`);
  if (!blob) return 0;
  const rawName = String(c?.name || "").trim();
  if (!rawName) return 0;
  const nk = normBrief(rawName);
  let s = 0;
  if (nk.length >= 2 && blob.includes(nk)) s += 28;
  for (const part of nk.split(/\s+/).filter((p) => p.length > 2)) {
    if (blob.includes(part)) s += 12;
  }
  return s;
}

/**
 * Protagonisti / ricorrenti come riferimento mood (no identity lock in questa fase).
 * Ordine: affinità nome↔titolo/descrizione, poi ruolo narrativo — mai l'ordine grezzo del piano.
 * @param {object[]|null|undefined} characters
 * @param {number} max
 * @param {string} [projectTitle]
 * @param {string} [projectDescription]
 */
function pickKeyCharacters(characters, max = 3, projectTitle = "", projectDescription = "") {
  const list = Array.isArray(characters) ? characters : [];
  const t = String(projectTitle || "");
  const d = String(projectDescription || "");
  const scored = list
    .map((c, i) => {
      const aff = characterBriefAffinityScore(c, t, d);
      const roleBoost =
        (c?.is_protagonist ? 5 : 0) +
        (String(c?.character_role || "").toLowerCase().includes("protagonist") ? 4 : 0) +
        (String(c?.character_role || "").toLowerCase().includes("recurring") ? 2 : 0);
      return { c, score: aff * 3 + roleBoost - i * 0.02 };
    })
    .sort((a, b) => b.score - a.score);
  const out = [];
  const seen = new Set();
  const topAff = scored[0] ? characterBriefAffinityScore(scored[0].c, t, d) : 0;
  for (const { c } of scored) {
    const id = String(c?.id || c?.name || "");
    if (!id || seen.has(id)) continue;
    const aff = characterBriefAffinityScore(c, t, d);
    if (topAff >= 6 && aff === 0) continue;
    seen.add(id);
    out.push(c);
    if (out.length >= max) break;
  }
  if (out.length) return out;
  for (const { c } of scored) {
    const id = String(c?.id || c?.name || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Raffinamento visivo per preset (locandina iconica, non storyboard frame).
 * @param {string} presetId
 */
function posterStyleTreatment(presetId) {
  const id = String(presetId || "").toLowerCase();
  if (/disney|pixar|family|cartoon|anime|ghibli|chibi/.test(id)) {
    return "Premium streaming animated movie key art: appealing shapes, clear silhouette, polished theatrical one-sheet composition, family blockbuster poster (no text).";
  }
  if (/noir|bw|monochrome/.test(id)) {
    return "Moody high-contrast noir streaming key art: dramatic shadows, single focal subject, cinematic poster lighting.";
  }
  if (/fantasy|epic|magic/.test(id)) {
    return "Epic fantasy streaming key art: mythic scale, iconic hero presence, painterly cinematic poster.";
  }
  if (/cyber|neon|sci/.test(id)) {
    return "Futuristic streaming key art: neon atmosphere, iconic silhouette, clean blockbuster composition.";
  }
  if (/horror|dark/.test(id)) {
    return "Dark thriller streaming key art: uneasy atmosphere, restrained detail, iconic focal dread, poster-grade clarity.";
  }
  if (/watercolor|painting|oil/.test(id)) {
    return "Illustrated prestige streaming key art: rich painterly treatment, strong focal read, collectible poster feel.";
  }
  return "Photoreal cinematic streaming key art: premium film one-sheet, natural materials, dramatic but readable lighting.";
}

/**
 * Costruisce prompt locandina (cover ufficiale, non scena).
 *
 * @param {{
 *   projectTitle: string,
 *   projectDescription: string,
 *   projectStyle: object|null,
 *   characters?: object[]|null,
 *   plannerKeywords?: string[]|null,
 *   conceptualOnly?: boolean
 * }} input
 * @returns {{ positivePrompt: string, negativePrompt: string, metadata: object }}
 */
export function buildProjectPosterPromptPack(input) {
  const title = String(input.projectTitle || "").trim();
  const description = String(input.projectDescription || "").trim();
  const ps = input.projectStyle && typeof input.projectStyle === "object" ? input.projectStyle : {};
  const presetId = String(ps.presetId || "").trim();
  const styleLine = [ps.stylePrompt, ps.plannerVisualNotes, ps.label].filter(Boolean).join(" · ");
  const keyChars = pickKeyCharacters(input.characters, 3, title, description);
  const charLines = keyChars.map(characterOneLiner).filter(Boolean);
  const conceptual = input.conceptualOnly === true || charLines.length === 0;
  const kw = (Array.isArray(input.plannerKeywords) ? input.plannerKeywords : [])
    .map((k) => String(k || "").trim())
    .filter(Boolean)
    .slice(0, 12);

  const toneBlock = description.slice(0, 1400);
  const keywordBlock = kw.length ? `Narrative keywords (mood only): ${kw.join(", ")}.` : "";

  const characterBlock = conceptual
    ? "No named cast locked yet: create evocative iconic key art that suggests the world and tone without specific likenesses. One or two symbolic silhouettes or environmental focal hero moment is OK; avoid portrait-ID accuracy."
    : `Key cast reference (mood and silhouette only — this is NOT a storyboard frame, NOT an identity-lock composite): ${charLines.join(" | ")}. Suggest presence and scale; do not reproduce exact faces as documentary stills.`;

  const primaryContract = [
    "PRIMARY NARRATIVE CONTRACT (overrides cast list order, first scene, or first chapter thumbnail): this poster must sell the ENTIRE project from the Italian TITLE and DESCRIPTION.",
    "The dominant figure, symbolic center, or emotional promise MUST match who/what the title and description imply (e.g. a biography or family series named after one figure must foreground that figure or clear iconography for them — not a different relative or side character unless the title explicitly names them).",
    "Never use 'first character in JSON', 'first scene still', or 'first chapter default' as the creative guide. The poster is catalog key art for the whole work, not chapter 1 production art.",
  ].join(" ");

  const positivePrompt = [
    "OFFICIAL STREAMING SERVICE KEY ART / THEATRICAL ONE-SHEET for a fictional series or film.",
    primaryContract,
    "Must read as a premium Netflix / Disney+ / Prime Video catalog cover: bold, clean, iconic, high legibility at thumbnail size.",
    "NOT a random film still, NOT a busy storyboard panel, NOT a cluttered ensemble scene.",
    "Composition: one dominant focal subject OR one hero + one secondary at most; strong silhouette; clear negative space reserved for future title treatment (absolutely NO text, letters, logos, watermarks, or UI in the image).",
    "Visual hierarchy: atmosphere and iconic pose over fine detail; readable shapes; cinematic poster lighting; full-bleed vertical poster.",
    posterStyleTreatment(presetId),
    "Global art direction (must dominate):",
    styleLine || "cinematic photorealistic blockbuster",
    ps.isAnimated ? "Output: top-tier animated feature key art finish." : "",
    "Italian project brief (theme and tone only — do not render as overlaid text):",
    title ? `Title mood: ${title}.` : "",
    toneBlock ? `Story world / tone: ${toneBlock}` : "",
    keywordBlock,
    characterBlock,
    "Avoid: many simultaneous actions, crowded cast, tiny illegible details, infographic look, comic panel layout, amateur snapshot.",
  ]
    .filter(Boolean)
    .join(" ");

  const baseNeg = String(ps.negativePrompt || "").trim();
  const posterNeg = [
    baseNeg,
    "text, title, caption, watermark, logo, typography, letters, numbers, subtitles, UI, interface",
    "multiple disconnected focal points, chaotic collage, messy clutter, overcrowded composition",
    "storyboard, sequential panels, split screen, contact sheet, film strip",
    "extreme fisheye, heavy motion blur, cctv, security cam, screenshot, meme layout",
    "low resolution, jpeg artifacts",
  ]
    .filter(Boolean)
    .join(", ");

  const metadata = {
    kind: "official_project_poster",
    presetId: presetId || null,
    styleLabel: ps.label || null,
    conceptualOnly: conceptual,
    keyCharacterCount: charLines.length,
    plannerKeywordCount: kw.length,
    positiveCharCount: positivePrompt.length,
  };

  return {
    positivePrompt,
    negativePrompt: posterNeg,
    metadata,
  };
}

/**
 * Genera la locandina (FLUX 2 Pro, 2:3) e restituisce URL + pacchetto prompt.
 *
 * @param {{
 *   projectTitle: string,
 *   projectDescription: string,
 *   projectStyle: object|null,
 *   characters?: object[]|null,
 *   plannerKeywords?: string[]|null,
 *   conceptualOnly?: boolean,
 *   onProgress?: (msg: string) => void
 * }} opts
 */
/**
 * Solo chiamata FLUX da pacchetto prompt già calcolato (salvataggio prompt prima del job).
 * @param {{ positivePrompt: string, negativePrompt: string, metadata?: object }} pack
 */
export async function executeOfficialProjectPosterFlux(pack, onProgress) {
  if (!String(process.env.REACT_APP_FAL_API_KEY || "").trim()) {
    throw new Error("REACT_APP_FAL_API_KEY non configurata");
  }
  onProgress?.("Generazione locandina (fal.ai)…");
  const result = await falRequest(MODELS.FLUX_2_PRO, {
    prompt: pack.positivePrompt,
    ...(pack.negativePrompt ? { negative_prompt: pack.negativePrompt } : {}),
    aspect_ratio: "2:3",
    num_images: 1,
    enable_safety_checker: false,
    safety_tolerance: "2",
  });
  const imageUrl = extractFluxImageUrl(result);
  if (!imageUrl || typeof imageUrl !== "string") {
    throw new Error("FLUX 2 Pro: nessuna immagine per la locandina");
  }
  return { imageUrl: String(imageUrl).trim() };
}

export async function generateOfficialProjectPoster(opts) {
  const pack = buildProjectPosterPromptPack({
    projectTitle: opts.projectTitle,
    projectDescription: opts.projectDescription,
    projectStyle: opts.projectStyle,
    characters: opts.characters,
    plannerKeywords: opts.plannerKeywords,
    conceptualOnly: opts.conceptualOnly,
  });
  const { imageUrl } = await executeOfficialProjectPosterFlux(pack, opts.onProgress);
  return {
    imageUrl,
    positivePrompt: pack.positivePrompt,
    negativePrompt: pack.negativePrompt,
    metadata: pack.metadata,
  };
}

/** @deprecated Usare generateOfficialProjectPoster */
export async function generateScenografiaProjectPosterUrl(opts) {
  const r = await generateOfficialProjectPoster({
    projectTitle: opts.title,
    projectDescription: opts.description,
    projectStyle: opts.projectStyle,
    characters: opts.characters,
    plannerKeywords: opts.plannerKeywords,
    conceptualOnly: opts.conceptualOnly,
    onProgress: opts.onProgress,
  });
  return { imageUrl: r.imageUrl };
}
