/**
 * Stile visivo globale per progetti Scenografie (unico per tutto il flusso).
 *
 * @typedef {{ id: string, label: string, prompt: string, negative_prompt?: string }} StylePresetLite
 */

import { isAnimatedStyle } from "./imagePrompts.js";

export const DEFAULT_SCENOGRAFIE_PRESET_ID = "cinematic";

/** Parole chiave (EN/IT) → id preset immagine App */
const PRESET_HINTS = {
  disney: ["disney", "pixar", "family animation", "stylized 3d", "film d'animazione"],
  cartoon: ["cartoon", "cartoni", "fumetto colorato"],
  anime: ["anime", "cel shading", "giapponese"],
  ghibli: ["ghibli", "miyazaki", "watercolor storybook"],
  manga: ["manga", "screentone", "bianco e nero"],
  comic: ["comic", "western comic", "fumetto"],
  chibi: ["chibi", "kawaii"],
  pixel: ["pixel", "16-bit", "retro game"],
  clay: ["clay", "claymation", "stop motion"],
  "3d": ["3d render", "cgi", "ray trace", "physically based"],
  isometric: ["isometric", "isometrico", "diorama"],
  realistic: ["photoreal", "fotoreal", "realistico", "dslr"],
  cinematic: ["cinematic", "cinematograf", "film still", "movie"],
  noir: ["noir", "b/n", "black and white", "chiaroscuro"],
  vintage: ["vintage", "retro", "analog", "kodak"],
  fashion: ["fashion", "editorial", "magazine"],
  portrait: ["portrait", "ritratto", "studio photo"],
  cyberpunk: ["cyberpunk", "neon", "blade"],
  fantasy: ["fantasy", "epic", "magical"],
  horror: ["horror", "terrore", "creepy"],
  painting: ["oil painting", "olio", "canvas"],
  watercolor: ["watercolor", "acquerello"],
  pencil: ["pencil", "matita", "graphite"],
  popart: ["pop art", "popart", "ben-day"],
};

function scorePresetMatch(visualLower, presetId, labelPromptLower) {
  let s = 0;
  const hints = PRESET_HINTS[presetId];
  if (hints) {
    for (const h of hints) {
      if (visualLower.includes(h)) s += 12;
    }
  }
  if (!visualLower) return s;
  for (const tok of visualLower.split(/[\s,.;]+/).filter((t) => t.length > 3)) {
    if (labelPromptLower.includes(tok)) s += 2;
  }
  return s;
}

/**
 * Sceglie un preset e costruisce lo stile progetto unico (nessun mix).
 *
 * @param {object} plan - Piano validato (visual_style, is_animated)
 * @param {StylePresetLite[]} presets - Da STYLE_PRESETS (subset campi)
 * @returns {{ presetId: string, label: string, stylePrompt: string, negativePrompt: string, plannerVisualNotes: string, isAnimated: boolean }}
 */
export function buildProjectStyleFromPlan(plan, presets) {
  const list = presets?.length ? presets : [];
  const fallback = list.find((p) => p.id === DEFAULT_SCENOGRAFIE_PRESET_ID) || list[0];
  const visualRaw = String(plan?.visual_style || "").trim();
  const visualLower = visualRaw.toLowerCase();

  let best = fallback;
  let bestScore = -1;
  for (const p of list) {
    const blob = `${p.label} ${p.prompt}`.toLowerCase();
    let s = scorePresetMatch(visualLower, p.id, blob);
    if (plan?.is_animated && isAnimatedStyle([p.id])) s += 4;
    if (!plan?.is_animated && !isAnimatedStyle([p.id])) s += 1;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }

  if (!visualRaw) {
    best = plan?.is_animated
      ? (list.find((p) => p.id === "disney") || list.find((p) => isAnimatedStyle([p.id])) || fallback)
      : fallback;
  } else if (bestScore < 4 && plan?.is_animated) {
    const anim = list.find((p) => p.id === "disney") || list.find((p) => isAnimatedStyle([p.id]));
    if (anim) best = anim;
  }

  const isAnimated =
    typeof plan?.is_animated === "boolean" ? plan.is_animated : isAnimatedStyle([best.id]);

  return {
    presetId: best.id,
    label: best.label,
    stylePrompt: best.prompt,
    negativePrompt: best.negative_prompt || "",
    plannerVisualNotes: visualRaw || `${best.label} look consistent across all scenes and characters`,
    isAnimated,
  };
}

/** Testo unico passato a master/scene come direzione visiva globale. */
export function composeGlobalVisualStyle(projectStyle) {
  if (!projectStyle) return "";
  const note = projectStyle.plannerVisualNotes || "";
  return [projectStyle.stylePrompt, note].filter(Boolean).join(". ");
}

/**
 * Stile globale da preset immagine App (creazione guidata progetto / hub).
 * @param {{ id: string, label: string, prompt: string, negative_prompt?: string }|null|undefined} preset
 * @param {{ descriptionHint?: string }} [opts]
 */
export function buildProjectStyleFromImagePreset(preset, opts = {}) {
  if (!preset) return null;
  const hint = String(opts.descriptionHint || "").trim();
  return {
    presetId: preset.id,
    label: preset.label,
    stylePrompt: preset.prompt,
    negativePrompt: preset.negative_prompt || "",
    plannerVisualNotes: hint
      ? `${hint.slice(0, 720)} · ${preset.label}`
      : `${preset.label}, consistent global look for the entire project`,
    isAnimated: isAnimatedStyle([preset.id]),
  };
}
