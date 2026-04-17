/**
 * Centralized Prompt Templates for the Image Pipeline
 *
 * All prompt construction logic lives here.
 * Templates are validated against real tests and must not be modified casually.
 */

// ═══════════════════════════════════════════════════════════
//  Appearance → Prompt Conversion
// ═══════════════════════════════════════════════════════════

const GENDER_MAP = { Uomo: "man", Donna: "woman" };
const BODY_MAP = {
  Magra: "very thin skinny",
  Snella: "slim slender",
  Media: "average build",
  Robusta: "thick sturdy build",
  Grassa: "overweight chubby fat large body",
  Muscolosa: "muscular athletic fit toned",
};
const HEIGHT_MAP = {
  "Bassa (~155cm)": "short petite",
  "Media (~170cm)": "average height",
  "Alta (~185cm)": "tall",
  "Molto alta (~195cm)": "very tall",
};
const AGE_MAP = {
  "Giovane (18-25)": "young 20s",
  "Adulta (25-35)": "adult early 30s",
  "Matura (35-50)": "mature 40s",
  "Senior (50+)": "senior 50s",
};
const SKIN_MAP = {
  "Molto chiara": "very pale white skin",
  Chiara: "fair light skin",
  Olivastra: "olive tan skin",
  Scura: "dark brown skin",
  "Molto scura": "very dark black skin",
};
const HAIR_LEN_MAP = {
  Rasati: "shaved buzzcut",
  "Molto corti": "very short hair",
  Corti: "short hair",
  Medi: "medium length hair",
  Lunghi: "long hair",
  "Molto lunghi": "very long flowing hair",
};
const HAIR_COL_MAP = {
  "Nero corvino": "jet black hair",
  Nero: "black hair",
  "Nero/Castano": "black hair with brown highlights",
  Neri: "black hair",
  "Castano molto scuro": "very dark brown hair",
  "Castano scuro": "dark brown hair",
  "Castano medio": "medium brown hair",
  "Castano chiaro": "light brown hair",
  "Castano/Nero mix": "dark brown and black mixed hair",
  "Biondo scuro": "dark blonde hair",
  "Biondo medio": "medium blonde hair",
  "Biondo chiaro": "light blonde hair",
  "Biondo platino": "platinum blonde hair",
  Rosso: "red ginger hair",
  "Rosso/Ramato": "red auburn hair",
  "Rosso scuro": "dark red mahogany hair",
  "Rosso chiaro": "light copper red hair",
  Brizzolato: "salt-and-pepper grey hair",
  "Grigio scuro": "dark grey hair",
  "Grigio argento": "silver grey hair",
  Bianco: "white hair",
  "Bianco/Grigio": "white grey hair",
  Colorati: "colorful dyed hair",
};
const HAIR_STYLE_MAP = {
  Lisci: "straight hair",
  Mossi: "wavy hair",
  Ricci: "curly hair",
  Afro: "afro hair",
  Raccolti: "hair up in bun",
  Coda: "ponytail",
  Trecce: "braided hair",
};
const EYE_MAP = {
  Marroni: "brown eyes",
  Nocciola: "hazel eyes",
  Verdi: "green eyes",
  Azzurri: "blue eyes",
  Grigi: "grey eyes",
  Neri: "dark black eyes",
};
const BEARD_MAP = {
  Nessuna: "clean shaven",
  "Barba corta": "short stubble beard",
  "Barba media": "medium beard",
  "Barba lunga": "long full beard",
  Pizzetto: "goatee",
  Baffi: "mustache",
};
const MUSTACHE_MAP = {
  none: "",
  thin: "thin pencil mustache",
  thick: "thick mustache",
  handlebar: "handlebar mustache",
};
const GLASSES_MAP = {
  none: "",
  thin_metal: "thin metal frame glasses",
  thick_black: "thick black frame glasses",
  rimless: "rimless glasses",
  sunglasses: "sunglasses",
};
const HAIR_DENSITY_MAP = {
  "Molto folti": "very thick voluminous hair",
  Folti: "thick full hair",
  Medio: "medium density hair",
  Sottili: "thin hair",
  Radi: "thinning sparse hair on top",
  Diradamento: "noticeably balding thinning hair",
};
const BREAST_MAP = {
  Piccolo: "small breasts",
  Medio: "medium breasts",
  Grande: "large breasts",
  "Molto grande": "very large heavy breasts",
};
const BUTT_MAP = {
  Piccolo: "small butt",
  Medio: "average butt",
  Grande: "large round butt",
  "Molto grande": "very large thick butt",
};

/**
 * Convert appearance object to English physical description string.
 */
export function appearanceToPrompt(appearance) {
  if (!appearance) return "";
  if (appearance.detailedDescription) return appearance.detailedDescription;

  const parts = [];
  if (appearance.gender) parts.push(GENDER_MAP[appearance.gender] || "person");
  if (appearance.ageEstimate) parts.push(`approximately ${appearance.ageEstimate} years old`);
  else if (appearance.age) parts.push(AGE_MAP[appearance.age] || "");
  if (appearance.bodyType) parts.push(BODY_MAP[appearance.bodyType] || "");
  if (appearance.height) parts.push(HEIGHT_MAP[appearance.height] || "");
  if (appearance.skinDetail) parts.push(appearance.skinDetail);
  else if (appearance.skinColor) parts.push(SKIN_MAP[appearance.skinColor] || "");
  if (appearance.hairLength) parts.push(HAIR_LEN_MAP[appearance.hairLength] || "");
  if (appearance.hairColorDetail) parts.push(appearance.hairColorDetail);
  else if (appearance.hairColor) parts.push(HAIR_COL_MAP[appearance.hairColor] || "");
  if (appearance.hairStyleDetail) parts.push(appearance.hairStyleDetail);
  else if (appearance.hairStyle) parts.push(HAIR_STYLE_MAP[appearance.hairStyle] || "");
  if (appearance.hairTexture) parts.push(appearance.hairTexture);
  if (appearance.hairDensity) parts.push(HAIR_DENSITY_MAP[appearance.hairDensity] || appearance.hairDensity);
  if (appearance.hairline) parts.push(appearance.hairline);
  if (appearance.eyeColor) parts.push(EYE_MAP[appearance.eyeColor] || "");
  if (appearance.faceShape) parts.push(`${appearance.faceShape} face`);
  if (appearance.nose) parts.push(`${appearance.nose} nose`);
  if (appearance.jaw) parts.push(appearance.jaw);
  if (appearance.chin) parts.push(`${appearance.chin} chin`);
  if (appearance.wrinkles && appearance.wrinkles !== "smooth skin") parts.push(appearance.wrinkles);
  if (appearance.beard) parts.push(BEARD_MAP[appearance.beard] || "");
  if (appearance.mustache) parts.push(MUSTACHE_MAP[appearance.mustache] || "");
  if (appearance.glasses) parts.push(GLASSES_MAP[appearance.glasses] || "");
  if (appearance.moles && appearance.moles !== "none visible" && appearance.moles !== "none") parts.push(appearance.moles);
  if (appearance.scars && appearance.scars !== "none visible" && appearance.scars !== "none") parts.push(appearance.scars);
  if (appearance.tattoos && appearance.tattoos !== "none visible" && appearance.tattoos !== "none") parts.push(appearance.tattoos);
  if (appearance.breastSize && appearance.gender === "Donna") parts.push(BREAST_MAP[appearance.breastSize] || "");
  if (appearance.buttSize) parts.push(BUTT_MAP[appearance.buttSize] || "");
  return parts.filter((p) => p).join(", ");
}

// ═══════════════════════════════════════════════════════════
//  CASE A — Master Character Prompt
// ═══════════════════════════════════════════════════════════

const MASTER_SINGLE_SUBJECT_CLAUSE =
  "ONE SINGLE CHARACTER, solo subject, only one person in the frame, no duplicate, no second person, no crowd, no group.";

/**
 * Build prompt for master character creation.
 */
export function buildMasterCharacterPrompt({ appearance, outfit, visualStyle, extraPrompt }) {
  const physicalDesc = appearanceToPrompt(appearance);
  const parts = [];

  parts.push(MASTER_SINGLE_SUBJECT_CLAUSE);

  if (physicalDesc) {
    parts.push(`A ${physicalDesc}`);
  }

  if (outfit) {
    parts.push(`wearing ${outfit}`);
  }

  if (extraPrompt) {
    parts.push(extraPrompt);
  }

  if (visualStyle) {
    parts.push(visualStyle);
  } else {
    parts.push("RAW photograph, natural skin texture, photorealistic, highly detailed, 8K");
  }

  parts.push("portrait framing, medium close-up, centered composition, clean background");

  return parts.filter(Boolean).join(". ");
}

// ═══════════════════════════════════════════════════════════
//  CASE B — Scene Base Prompt
// ═══════════════════════════════════════════════════════════

/**
 * Build prompt for scene base generation.
 * The scene must match the master's art direction but with different pose/environment.
 */
export function buildScenePrompt({
  sceneDescription,
  appearance,
  outfit,
  environment,
  lighting,
  palette,
  visualStyle,
  stylePrefixes,
  numSubjects = 1,
  supportingCharacters,
}) {
  const physicalDesc = appearanceToPrompt(appearance);
  const parts = [];

  if (numSubjects === 0) {
    parts.push(
      "Environment-only shot: no people, no faces, no human figures, no silhouettes of characters; focus on place, architecture, nature, atmosphere"
    );
  } else if (numSubjects === 1) {
    parts.push("ONE SINGLE main character, only one protagonist");
  } else {
    parts.push(`${numSubjects} characters in the scene`);
  }

  if (numSubjects !== 0 && physicalDesc) {
    parts.push(physicalDesc);
  }

  if (numSubjects !== 0 && outfit) {
    parts.push(`wearing ${outfit}`);
  }

  if (sceneDescription) {
    parts.push(sceneDescription);
  }

  if (environment) {
    parts.push(environment);
  }

  if (lighting) {
    parts.push(lighting);
  }

  if (palette) {
    parts.push(palette);
  }

  if (numSubjects !== 0 && supportingCharacters) {
    parts.push(`Supporting characters: ${supportingCharacters}`);
  }

  if (stylePrefixes && stylePrefixes.length > 0) {
    parts.push(stylePrefixes.filter(Boolean).join(", "));
  } else if (visualStyle) {
    parts.push(visualStyle);
  } else {
    parts.push("RAW photograph, natural skin texture, photorealistic, highly detailed, 8K");
  }

  if (numSubjects === 1) {
    parts.push("no duplicate protagonist, no second version of the main character");
  }

  return parts.filter(Boolean).join(". ");
}

// ═══════════════════════════════════════════════════════════
//  CASE C — Identity Lock Prompt
// ═══════════════════════════════════════════════════════════

export const IDENTITY_LOCK_PROMPT_TEMPLATE = [
  "Use the first image as the absolute base image.",
  "Keep the exact composition, body pose, body proportions, outfit, hairstyle length, background, camera angle, lighting direction, shadow intensity, contrast, exposure, color palette, and visual style of the first image.",
  "Transfer only the facial identity and facial traits from the second image to the main character in the first image.",
  "Preserve the same universe, same art direction, same environment, and same cinematic mood.",
  "Do not change the body.",
  "Do not change the clothes.",
  "Do not change the environment.",
  "Do not alter the supporting characters.",
  "Only one version of the main character.",
  "No duplicate protagonist.",
  "Seamless integration.",
].join(" ");

export const IDENTITY_LOCK_ANIMATED_SUFFIX =
  "Preserve the stylized animated look. Keep the family-animation visual language.";

/**
 * Build identity lock prompt.
 */
export function buildIdentityLockPrompt({ isAnimated = false, globalVisualStyleNote = "" }) {
  const note = globalVisualStyleNote && String(globalVisualStyleNote).trim()
    ? ` Locked project visual style (keep consistent): ${String(globalVisualStyleNote).trim()}`
    : "";
  if (isAnimated) {
    return `${IDENTITY_LOCK_PROMPT_TEMPLATE} ${IDENTITY_LOCK_ANIMATED_SUFFIX}${note}`;
  }
  return `${IDENTITY_LOCK_PROMPT_TEMPLATE}${note}`;
}

// ═══════════════════════════════════════════════════════════
//  CASE D — Repair Pass Prompt
// ═══════════════════════════════════════════════════════════

export const REPAIR_PROMPT_TEMPLATE = [
  "Refine this image and preserve the exact composition, pose, body, clothing, hairstyle, framing, environment and camera angle.",
  "Improve facial integration so the face matches the scene naturally.",
  "Harmonize skin tone, lighting, shadows, contrast and exposure.",
  "Make the result fully photorealistic and seamless.",
  "Keep only one character.",
  "Do not change the outfit or background.",
].join(" ");

export const REPAIR_ANIMATED_SUFFIX =
  "Make the result fully seamless and naturally stylized instead of photorealistic.";

/**
 * Build repair prompt.
 */
export function buildRepairPrompt({ isAnimated = false, globalVisualStyleNote = "" }) {
  const note = globalVisualStyleNote && String(globalVisualStyleNote).trim()
    ? ` Preserve the locked project look: ${String(globalVisualStyleNote).trim()}.`
    : "";
  if (isAnimated) {
    const base = REPAIR_PROMPT_TEMPLATE.replace(
      "Make the result fully photorealistic and seamless.",
      ""
    ).trim();
    return `${base} ${REPAIR_ANIMATED_SUFFIX}${note}`;
  }
  return `${REPAIR_PROMPT_TEMPLATE}${note}`;
}

// ═══════════════════════════════════════════════════════════
//  Scenografie — edit mirato (stesso frame, richiesta utente)
// ═══════════════════════════════════════════════════════════

/**
 * Prompt per nano-banana edit su singola immagine scena già generata.
 * @param {{ integrativePrompt: string, globalVisualStyleNote?: string, isAnimated?: boolean }} opts
 */
export function buildScenografiaSceneEditPrompt({
  integrativePrompt,
  globalVisualStyleNote = "",
  isAnimated = false,
}) {
  const user = String(integrativePrompt || "").trim();
  const styleNote = globalVisualStyleNote && String(globalVisualStyleNote).trim()
    ? ` Locked project visual direction (keep): ${String(globalVisualStyleNote).trim()}.`
    : "";
  const core = [
    "Image edit: use the provided image as the sole reference frame.",
    "Preserve overall composition, camera angle, framing, character identities, outfits, environment layout, palette and atmosphere unless the user explicitly asks for a localized change.",
    "Apply only the specific adjustments described below; keep everything else pixel-stable in spirit (no full redesign).",
    "If the face is mentioned, change expression or pose subtly while keeping the same identity and likeness.",
    "Do not replace characters or restyle the whole image.",
    "Single coherent output.",
  ].join(" ");
  const anim = isAnimated ? " Keep stylized / animated rendering consistent with the source." : "";
  return `${core} User edit request: ${user}.${styleNote}${anim}`;
}

/**
 * Prompt per modifica mirata di un clip video Scenografie (da usare quando il motore video sarà collegato).
 * Preserva stile progetto, identità, scena sorgente e continuità; agisce su movimento, camera, timing, intensità.
 */
export function buildScenografiaVideoClipEditPrompt({
  integrativePrompt,
  globalVisualStyleNote = "",
  sceneContextNote = "",
  isAnimated = false,
}) {
  const user = String(integrativePrompt || "").trim();
  const styleNote = globalVisualStyleNote && String(globalVisualStyleNote).trim()
    ? ` Locked project visual style (keep): ${String(globalVisualStyleNote).trim()}.`
    : "";
  const sceneNote = sceneContextNote && String(sceneContextNote).trim()
    ? ` Scene continuity (keep): ${String(sceneContextNote).trim()}.`
    : "";
  const core = [
    "Video clip edit: treat the source clip as the primary reference for characters, wardrobe, environment and overall look.",
    "Preserve identities, palette, atmosphere and narrative continuity unless the user requests a localized change.",
    "Apply only the user-requested adjustments to motion, expression intensity, timing/rhythm, camera movement or framing details.",
    "Do not replace the scene or restyle the whole clip; avoid discontinuity with adjacent shots.",
    "Output a single coherent revised clip concept.",
  ].join(" ");
  const anim = isAnimated ? " Keep stylized / animated motion consistent with the source." : "";
  return `${core} User edit request: ${user}.${styleNote}${sceneNote}${anim}`;
}

// ═══════════════════════════════════════════════════════════
//  Animated Style Detection
// ═══════════════════════════════════════════════════════════

const ANIMATED_STYLE_IDS = new Set([
  "cartoon",
  "chibi",
  "disney",
  "anime",
  "ghibli",
  "manga",
  "comic",
  "clay",
  "pixel",
  "pixar",
  "animation",
]);

/**
 * Detect if the selected styles indicate an animated/cartoon look.
 */
export function isAnimatedStyle(selectedStyleIds) {
  if (!selectedStyleIds) return false;
  return selectedStyleIds.some((id) => ANIMATED_STYLE_IDS.has(id));
}
