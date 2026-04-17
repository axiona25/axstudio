/** Extracted from App.js — preset stile immagine (Immagine libera + wizard Scenografie). */
export const STYLE_PRESETS = [
  {
    id: "realistic",  tag: "@realistico", label: "Realistico",     icon: "📷",
    previewImage: "style-realistic.jpg",  preview: "linear-gradient(145deg, #d4cfc9 0%, #7a6f65 100%)",
    thumbnailImage: "realistic.jpg",
    thumbnailPrompt: "close-up portrait of a human face, photorealistic DSLR photo, natural skin texture, clean background, premium lighting, highly legible thumbnail composition",
    thumbnailNegativePrompt: "ugly face, deformed anatomy, animal, anthropomorphic, mascot, cluttered background, text, watermark, blurry",
    prompt: "RAW photograph, photorealistic image, natural skin texture, realistic human anatomy, true-to-life materials, subtle depth of field, crisp focus, balanced dynamic range",
    negative_prompt: "cartoon, anime, 3d render, CGI, painting, illustration, deformed anatomy, animal, anthropomorphic, furry, mascot", category: "photo",
  },
  {
    id: "cinematic",  tag: "@cinematico", label: "Cinematico",     icon: "🎬",
    previewImage: "style-cinematic.jpg",  preview: "linear-gradient(180deg, #0f172a 0%, #1e3a5f 100%)",
    thumbnailImage: "cinematic.jpg",
    thumbnailPrompt: "cinematic movie frame, moody neon alley, dramatic lighting, anamorphic feel, strong composition, premium color grading, highly legible thumbnail",
    thumbnailNegativePrompt: "ugly face, animal, mascot, cartoon, cluttered background, text, watermark, blurry",
    prompt: "cinematic photography, photorealistic, live-action film still, real camera shot, professional portrait photography, natural skin texture, realistic facial proportions, subtle cinematic lighting, high detail, rich color grading, atmospheric depth, soft film grain, anamorphic composition",
    negative_prompt: "illustration, digital painting, painting, drawn, cartoon, anime, comic, manga, 3d render, cgi, concept art, poster art, stylized, vector art, airbrushed skin, beautified face, doll face, overprocessed, deformed anatomy, animal, anthropomorphic, furry, mascot, toy-like character", category: "photo",
  },
  {
    id: "fashion",    tag: "@fashion",    label: "Fashion",         icon: "👠",
    previewImage: "style-fashion.jpg",   preview: "linear-gradient(135deg, #fce7f3 0%, #7c3aed 100%)",
    thumbnailImage: "fashion.jpg",
    thumbnailPrompt: "fashion editorial model in bold outfit, studio backdrop, premium magazine lighting, elegant pose, clean luxury composition, highly legible thumbnail",
    thumbnailNegativePrompt: "ugly face, deformed anatomy, animal, mascot, cluttered background, text, watermark, blurry",
    prompt: "high-fashion editorial photography, luxury magazine aesthetic, studio or runway lighting, polished skin detail, elegant human pose, premium composition, glossy commercial finish",
    negative_prompt: "cartoon, anime, CGI, animal, anthropomorphic, furry, mascot, distorted limbs, bad hands, toy face", category: "photo",
  },
  {
    id: "portrait",   tag: "@ritratto",   label: "Ritratto",        icon: "🧑",
    previewImage: "style-portrait.jpg",  preview: "linear-gradient(145deg, #ffd8c8 0%, #5c3d33 100%)",
    thumbnailImage: "portrait.jpg",
    thumbnailPrompt: "human portrait close-up, rembrandt lighting, dramatic cheek light triangle, shallow depth of field, premium studio realism, highly legible thumbnail",
    thumbnailNegativePrompt: "ugly face, deformed anatomy, animal, mascot, cluttered background, text, watermark, blurry",
    prompt: "professional portrait photography, Rembrandt lighting, natural facial detail, realistic human features, flattering focal compression, soft catchlights, shallow depth of field, studio realism",
    negative_prompt: "cartoon, anime, illustration, animal, anthropomorphic, furry, mascot, deformed face, extra eyes, distorted anatomy", category: "photo",
  },
  {
    id: "vintage",    tag: "@vintage",    label: "Vintage",         icon: "📼",
    previewImage: "style-vintage.jpg",   preview: "linear-gradient(145deg, #d4a76a 0%, #5c3d1a 100%)",
    thumbnailImage: "vintage.jpg",
    thumbnailPrompt: "1970s vintage photo look, retro subject, faded Kodak tones, analog grain, nostalgic composition, highly legible thumbnail",
    thumbnailNegativePrompt: "modern digital look, neon palette, animal, mascot, cluttered background, text, watermark",
    prompt: "1970s vintage photograph, faded Kodak tones, analog texture, visible film grain, nostalgic exposure, subtle color shift, retro documentary realism, natural human appearance",
    negative_prompt: "cartoon, anime, CGI, futuristic neon palette, animal, anthropomorphic, furry, mascot, plastic skin", category: "photo",
  },
  {
    id: "noir",       tag: "@noir",       label: "Film Noir",       icon: "🕵️",
    previewImage: "style-noir.jpg",      preview: "linear-gradient(145deg, #1a1a1a 0%, #3d3d3d 100%)",
    thumbnailImage: "noir.jpg",
    thumbnailPrompt: "film noir silhouette, black and white, cigarette smoke, hard shadows, detective mood, dramatic contrast, highly legible thumbnail",
    thumbnailNegativePrompt: "color, animal, mascot, cluttered background, text, watermark, blurry, cheerful mood",
    prompt: "classic film noir photography, monochrome black and white, hard key light, deep shadows, smoky atmosphere, dramatic silhouettes, realistic human figure, high contrast",
    negative_prompt: "bright colors, cartoon, anime, CGI, cheerful lighting, animal, anthropomorphic, furry, mascot", category: "photo",
  },
  {
    id: "anime",      tag: "@anime",      label: "Anime",           icon: "🌸",
    previewImage: "style-anime.jpg",     preview: "linear-gradient(135deg, #e0f2fe 0%, #f0abfc 100%)",
    thumbnailImage: "anime.jpg",
    thumbnailPrompt: "anime human face close-up, expressive eyes, clean cel shading, crisp linework, vibrant controlled colors, highly legible thumbnail",
    thumbnailNegativePrompt: "photorealistic, live-action, animal, anthropomorphic, furry, mascot, creature, blurry, text, watermark",
    prompt: "anime illustration of a human character, clean cel shading, expressive eyes, crisp linework, stylized human anatomy, vibrant controlled palette, polished 2D animation aesthetic",
    negative_prompt: "photorealistic, live-action, realistic skin pores, animal, anthropomorphic, furry, mascot, creature, non-human, snout, hooves, beak", category: "illustration",
  },
  {
    id: "ghibli",     tag: "@ghibli",     label: "Ghibli",          icon: "🌿",
    previewImage: "style-ghibli.jpg",    preview: "linear-gradient(180deg, #bbf7d0 0%, #4ade80 50%, #166534 100%)",
    thumbnailImage: "ghibli.jpg",
    thumbnailPrompt: "soft hand-painted human character or poetic landscape, gentle watercolor textures, dreamy natural light, storybook feeling, highly legible thumbnail",
    thumbnailNegativePrompt: "photorealistic, hard CGI, animal, anthropomorphic, furry, mascot, monster, blurry, text, watermark",
    prompt: "hand-painted animated illustration of a human character, soft watercolor textures, whimsical atmosphere, delicate linework, gentle pastel palette, dreamlike natural lighting, storybook warmth",
    negative_prompt: "photorealistic, hard CGI, animal, anthropomorphic, furry, mascot, creature, non-human, monster design", category: "illustration",
  },
  {
    id: "manga",      tag: "@manga",      label: "Manga",           icon: "🖋️",
    previewImage: "style-manga.jpg",     preview: "linear-gradient(145deg, #f8fafc 0%, #94a3b8 100%)",
    thumbnailImage: "manga.jpg",
    thumbnailPrompt: "manga human face close-up, black and white ink, screentone, sharp linework, graphic contrast, highly legible thumbnail",
    thumbnailNegativePrompt: "color, photorealistic, animal, anthropomorphic, furry, mascot, creature, blurry, text, watermark",
    prompt: "manga artwork of a human character, black and white ink drawing, screentone shading, precise line art, expressive contrast, dynamic composition, detailed cross-hatching",
    negative_prompt: "full color, photorealistic, painterly texture, animal, anthropomorphic, furry, mascot, creature, non-human", category: "illustration",
  },
  {
    id: "comic",      tag: "@fumetto",    label: "Fumetto",         icon: "💥",
    previewImage: "style-comic.jpg",     preview: "linear-gradient(135deg, #fef08a 0%, #dc2626 100%)",
    thumbnailImage: "comic.jpg",
    thumbnailPrompt: "western comic hero portrait, bold ink outlines, dramatic foreshortening, flat graphic colors, punchy composition, highly legible thumbnail",
    thumbnailNegativePrompt: "photorealistic, watercolor, animal, anthropomorphic, furry, mascot, creature, blurry, text, watermark",
    prompt: "western comic book illustration of a human character, bold inked outlines, dynamic foreshortening, flat graphic colors, dramatic action shading, heroic composition, punchy visual energy",
    negative_prompt: "photorealistic, watercolor, muted realism, animal, anthropomorphic, furry, mascot, creature, non-human", category: "illustration",
  },
  {
    id: "cartoon",    tag: "@cartoon",    label: "Cartoon",         icon: "🎨",
    previewImage: "style-cartoon.jpg",   preview: "linear-gradient(135deg, #60a5fa 0%, #f9a8d4 100%)",
    thumbnailImage: "cartoon.jpg",
    thumbnailPrompt: "cartoon human character portrait, simple shapes, bright colors, clean outlines, expressive face, highly legible thumbnail",
    thumbnailNegativePrompt: "photorealistic, gritty realism, animal, anthropomorphic, furry, mascot, creature, blurry, text, watermark",
    prompt: "cartoon illustration of a human character, simplified human proportions, clean outlines, bright saturated colors, expressive face, smooth shading, polished animated-show visual language, preserved facial structure, readable anatomy",
    negative_prompt: "photorealistic, gritty realism, natural skin texture, deformed face, distorted anatomy, melted features, broken hands, animal, anthropomorphic, furry, mascot, creature, non-human, snout, hooves, beak, tail", category: "illustration",
  },
  {
    id: "chibi",      tag: "@chibi",      label: "Chibi",           icon: "🧸",
    previewImage: "style-chibi.jpg",     preview: "linear-gradient(135deg, #fce7f3 0%, #e879f9 100%)",
    thumbnailImage: "chibi.jpg",
    thumbnailPrompt: "chibi human character, oversized head, tiny body, huge eyes, kawaii design, clean pastel colors, highly legible thumbnail",
    thumbnailNegativePrompt: "realistic anatomy, photorealistic, animal, anthropomorphic, furry, mascot, creature, blurry, text, watermark",
    prompt: "chibi kawaii human character design, oversized head, tiny body, huge expressive eyes, simplified human anatomy, soft shading, clean colorful illustration, adorable proportions, preserved facial identity, recognizable face features",
    negative_prompt: "realistic anatomy, photorealistic, deformed face, distorted features, melted eyes, broken hands, animal, anthropomorphic, furry, mascot, creature, non-human, realistic animal features", category: "illustration",
  },
  {
    id: "pixel",      tag: "@pixel",      label: "Pixel Art",       icon: "🕹️",
    previewImage: "style-pixel.jpg",     preview: "linear-gradient(135deg, #1e1b4b 0%, #4ade80 100%)",
    thumbnailImage: "pixel.jpg",
    thumbnailPrompt: "pixel art 16-bit character or tiny landscape, crisp square pixels, limited color palette, retro game readability, highly legible thumbnail",
    thumbnailNegativePrompt: "smooth gradients, photorealistic, blurry, painterly texture, text, watermark",
    prompt: "pixel art illustration, 16-bit retro game aesthetic, crisp square pixels, limited color palette, sprite-like readability, clean silhouette design, nostalgic arcade visual style",
    negative_prompt: "smooth gradients, photorealistic, blurry details, painterly texture, realistic skin, 3d render", category: "illustration",
  },
  {
    id: "disney",     tag: "@disney",     label: "Disney/Pixar",    icon: "✨",
    previewImage: "style-disney.jpg",    preview: "linear-gradient(135deg, #3b82f6 0%, #a78bfa 50%, #f9a8d4 100%)",
    thumbnailImage: "disney.jpg",
    thumbnailPrompt: "stylized 3D human character portrait, expressive face, polished CGI, soft global illumination, premium family animation look, highly legible thumbnail",
    thumbnailNegativePrompt: "photorealistic, gritty realism, animal, anthropomorphic, furry, mascot, creature, non-human, blurry, text, watermark",
    prompt: "stylized animated 3D human character, expressive human face, polished CGI, soft global illumination, appealing human proportions, glossy materials, high-end family animation finish, preserved facial structure, recognizable face identity",
    negative_prompt: "photorealistic skin, gritty realism, flat 2D line art, deformed face, distorted anatomy, asymmetrical eyes, broken hands, animal, anthropomorphic animal, furry, mascot, llama, deer, fox, creature, non-human", category: "3d",
  },
  {
    id: "3d",         tag: "@3d",         label: "3D Render",       icon: "🧊",
    previewImage: "style-3d.jpg",        preview: "linear-gradient(145deg, #bfdbfe 0%, #1d4ed8 100%)",
    thumbnailImage: "3d.jpg",
    thumbnailPrompt: "clean 3D render of a simple object or bust, glossy materials, soft studio lighting, polished CGI, highly legible thumbnail",
    thumbnailNegativePrompt: "flat 2D illustration, watercolor, sketch, animal, mascot, cluttered background, text, watermark, blurry",
    prompt: "high-end 3D render, physically based materials, global illumination, ray-traced reflections, subsurface scattering, clean geometry, realistic human anatomy, cinematic CGI detail",
    negative_prompt: "flat 2D illustration, watercolor, graphite sketch, animal, anthropomorphic, furry, mascot, toy-like face", category: "3d",
  },
  {
    id: "clay",       tag: "@clay",       label: "Claymation",      icon: "🪵",
    previewImage: "style-clay.jpg",      preview: "linear-gradient(145deg, #fed7aa 0%, #c2410c 100%)",
    thumbnailImage: "clay.jpg",
    thumbnailPrompt: "claymation human figure, handmade clay texture, tactile imperfections, miniature set feel, soft lighting, highly legible thumbnail",
    thumbnailNegativePrompt: "photorealistic, hyper-clean CGI, metallic realism, animal, mascot, creature, blurry, text, watermark",
    prompt: "stylized clay animation look, soft clay material, handcrafted surface texture, stop-motion aesthetic, preserved facial structure, readable human anatomy, clean character proportions",
    negative_prompt: "deformed face, distorted anatomy, asymmetrical eyes, broken hands, melted features, uncanny face, extra fingers, warped reflection, grotesque proportions, animal, anthropomorphic, furry, mascot, creature, non-human", category: "3d",
  },
  {
    id: "isometric",  tag: "@isometrico", label: "Isometrico",      icon: "📐",
    previewImage: "style-isometric.jpg", preview: "linear-gradient(135deg, #e0f2fe 0%, #0891b2 100%)",
    thumbnailImage: "isometric.jpg",
    thumbnailPrompt: "isometric miniature room diorama, clean geometry, top-down three-quarter view, architectural clarity, highly legible thumbnail",
    thumbnailNegativePrompt: "eye-level camera, fisheye, cluttered background, text, watermark, blurry, photorealistic",
    prompt: "isometric diorama render, three-quarter top-down view, miniature world design, clean modular geometry, tiny environmental storytelling, precise layout, polished scale-model aesthetic",
    negative_prompt: "perspective distortion, eye-level camera, extreme close-up, photorealistic portrait framing", category: "3d",
  },
  {
    id: "painting",   tag: "@olio",       label: "Pittura a Olio",  icon: "🖼️",
    previewImage: "style-oil.jpg",       preview: "linear-gradient(145deg, #fef3c7 0%, #92400e 100%)",
    thumbnailImage: "painting.jpg",
    thumbnailPrompt: "classical oil painting portrait, visible brushstrokes, rich pigments, canvas texture, old master mood, highly legible thumbnail",
    thumbnailNegativePrompt: "photograph, CGI, airbrush smoothness, animal, mascot, cluttered background, text, watermark, blurry",
    prompt: "classical oil painting, visible brushstrokes, rich pigment layering, chiaroscuro lighting, old master composition, canvas texture, refined painted realism, human figure clarity",
    negative_prompt: "photograph, CGI render, digital airbrush smoothness, animal, anthropomorphic mascot", category: "art",
  },
  {
    id: "watercolor", tag: "@acquerello", label: "Acquerello",      icon: "💧",
    previewImage: "style-watercolor.jpg",preview: "linear-gradient(145deg, #e0f7fa 0%, #0284c7 100%)",
    thumbnailImage: "watercolor.jpg",
    thumbnailPrompt: "soft watercolor landscape, visible paper grain, delicate washes, airy composition, highly legible thumbnail",
    thumbnailNegativePrompt: "hard ink, photorealistic, glossy CGI, cluttered background, text, watermark, blurry",
    prompt: "watercolor illustration, translucent pigment washes, soft feathered edges, visible paper grain, delicate color bleeding, airy composition, gentle hand-painted texture",
    negative_prompt: "hard ink outlines, photorealistic, glossy CGI, hyper-sharp details", category: "art",
  },
  {
    id: "pencil",     tag: "@matita",     label: "Disegno a Matita",icon: "✏️",
    previewImage: "style-pencil.jpg",    preview: "linear-gradient(145deg, #f5f5f4 0%, #57534e 100%)",
    thumbnailImage: "pencil.jpg",
    thumbnailPrompt: "graphite pencil portrait sketch, cross-hatching, paper texture, monochrome drawing, highly legible thumbnail",
    thumbnailNegativePrompt: "color, photorealistic, glossy digital paint, cluttered background, text, watermark, blurry",
    prompt: "graphite pencil drawing, fine sketch lines, realistic cross-hatching, tonal shading, textured paper surface, hand-drawn detail, monochrome traditional draftsmanship",
    negative_prompt: "full color, photorealistic photo, glossy digital paint, 3d render", category: "art",
  },
  {
    id: "popart",     tag: "@popart",     label: "Pop Art",         icon: "🎉",
    previewImage: "style-popart.jpg",    preview: "linear-gradient(135deg, #fef08a 0%, #dc2626 50%, #1d4ed8 100%)",
    thumbnailImage: "popart.jpg",
    thumbnailPrompt: "pop art face portrait, bold primary colors, Ben-Day dots, graphic poster contrast, highly legible thumbnail",
    thumbnailNegativePrompt: "photorealistic, muted palette, watercolor, cluttered background, text, watermark, blurry",
    prompt: "pop art illustration, bold primary colors, Ben-Day dots, graphic poster contrast, thick outlines, screen-printed texture, retro commercial energy, high visual punch",
    negative_prompt: "photorealistic, muted palette, subtle natural lighting, watercolor texture", category: "art",
  },
  {
    id: "cyberpunk",  tag: "@cyberpunk",  label: "Cyberpunk",       icon: "🌆",
    previewImage: "style-cyberpunk.jpg", preview: "linear-gradient(145deg, #0f0f1a 0%, #7c3aed 50%, #06b6d4 100%)",
    thumbnailImage: "cyberpunk.jpg",
    thumbnailPrompt: "cyberpunk skyline or human face, neon magenta and cyan glow, wet reflections, futuristic mood, highly legible thumbnail",
    thumbnailNegativePrompt: "sunny pastoral mood, cartoon, animal, mascot, cluttered background, text, watermark, blurry",
    prompt: "cyberpunk aesthetic, neon-lit atmosphere, futuristic urban density, holographic glow, wet reflective surfaces, electric magenta and cyan accents, volumetric haze, gritty high-tech mood",
    negative_prompt: "", category: "genre",
  },
  {
    id: "fantasy",    tag: "@fantasy",    label: "Fantasy",         icon: "🐉",
    previewImage: "style-fantasy.jpg",   preview: "linear-gradient(135deg, #312e81 0%, #7c3aed 50%, #fcd34d 100%)",
    thumbnailImage: "fantasy.jpg",
    thumbnailPrompt: "epic fantasy castle or hero silhouette, magical glow, volumetric light, simple iconic composition, highly legible thumbnail",
    thumbnailNegativePrompt: "mundane realism, cluttered background, text, watermark, blurry",
    prompt: "epic fantasy atmosphere, magical glow, ornate worldbuilding, luminous runes, volumetric light rays, enchanted color palette, mythic scale, heroic visual language",
    negative_prompt: "", category: "genre",
  },
  {
    id: "horror",     tag: "@horror",     label: "Horror",          icon: "🩸",
    previewImage: "style-horror.jpg",    preview: "linear-gradient(145deg, #0a0a0a 0%, #7f1d1d 100%)",
    thumbnailImage: "horror.jpg",
    thumbnailPrompt: "horror silhouette in fog, desaturated tones, unsettling backlight, low-key atmosphere, highly legible thumbnail",
    thumbnailNegativePrompt: "bright cheerful palette, cartoon, gore, cluttered background, text, watermark, blurry",
    prompt: "atmospheric horror aesthetic, eerie desaturated tones, unsettling shadows, dense fog, decayed textures, ominous contrast, psychological dread, low-key lighting",
    negative_prompt: "bright cheerful palette, cute cartoon mood, clean glamour lighting", category: "genre",
  },
];

/** Raggruppa gli stili per categoria per la UI. */
export const STYLE_CATEGORIES = [
  { id: "photo", label: "Foto" },
  { id: "illustration", label: "Illustrazione" },
  { id: "3d", label: "3D" },
  { id: "art", label: "Arte" },
  { id: "genre", label: "Genere" },
];

/** Mappa rapida id → preset per lookup O(1). */
export const STYLE_PRESETS_MAP = Object.fromEntries(STYLE_PRESETS.map(s => [s.id, s]));

// ── Compatibilità stili immagine (gruppi mutuamente esclusivi) ──
export const IMAGE_STYLE_GROUP_PHOTOREAL = new Set([
  "realistic", "portrait", "cinematic", "noir", "vintage", "fashion", "horror", "fantasy", "cyberpunk",
  "painting", "watercolor", "pencil", "popart",
]);
export const IMAGE_STYLE_GROUP_ANIMATED = new Set([
  "disney", "cartoon", "anime", "manga", "chibi", "ghibli", "clay", "pixel", "comic",
]);
export const IMAGE_STYLE_GROUP_RENDERED3D = new Set(["3d", "isometric"]);

/** @returns {"photorealistic"|"animated"|"rendered3d"|null} */
export function getImageStyleCompatibilityGroup(styleId) {
  if (IMAGE_STYLE_GROUP_PHOTOREAL.has(styleId)) return "photorealistic";
  if (IMAGE_STYLE_GROUP_ANIMATED.has(styleId)) return "animated";
  if (IMAGE_STYLE_GROUP_RENDERED3D.has(styleId)) return "rendered3d";
  return null;
}

/** Stili animati — allineato a IMAGE_STYLE_GROUP_ANIMATED (negative prompt / fallback). */
export const ANIMATED_STYLE_IDS = IMAGE_STYLE_GROUP_ANIMATED;

export const PHOTOREALISTIC_NEGATIVE_TERMS = new Set([
  "cartoon", "anime", "3d render", "cgi", "painting", "illustration",
  "comic", "manga", "drawn", "concept art", "poster art", "stylized",
  "vector art", "digital painting",
]);

export function filterConflictingNegatives(negativeTerms, selectedStyleIds) {
  if (!selectedStyleIds || selectedStyleIds.length === 0) return negativeTerms;
  const hasAnimated = selectedStyleIds.some(id => ANIMATED_STYLE_IDS.has(id));
  if (!hasAnimated) return negativeTerms;
  return negativeTerms.filter(term => !PHOTOREALISTIC_NEGATIVE_TERMS.has(term.toLowerCase()));
}

/** Rimuove stili di gruppi diversi dal primo gruppo definito (recall / progetti / difesa). */
export function sanitizeImageStyleSelection(styleIds) {
  if (!styleIds || styleIds.length === 0) return [];
  const anchor = styleIds.find(id => getImageStyleCompatibilityGroup(id) !== null);
  if (!anchor) return [...styleIds];
  const g0 = getImageStyleCompatibilityGroup(anchor);
  return styleIds.filter(id => getImageStyleCompatibilityGroup(id) === g0);
}

/**
 * Aggiunge o rimuove uno stile rispettando i gruppi di compatibilità.
 * @returns {{ ok: boolean, next: string[], message?: string }}
 */
export function tryAppendImageStyle(currentIds, newId) {
  const cur = currentIds || [];
  if (cur.includes(newId)) {
    return { ok: true, next: cur.filter(x => x !== newId) };
  }
  const gNew = getImageStyleCompatibilityGroup(newId);
  const next = [...cur, newId];
  if (gNew === null) {
    return { ok: true, next };
  }
  for (const id of cur) {
    const gOld = getImageStyleCompatibilityGroup(id);
    if (gOld !== null && gOld !== gNew) {
      const labNew = STYLE_PRESETS_MAP[newId]?.label || newId;
      const labOld = STYLE_PRESETS_MAP[id]?.label || id;
      return {
        ok: false,
        next: cur,
        message: `Stili incompatibili: «${labNew}» (${labelImageStyleGroup(gNew)}) non si combina con «${labOld}» (${labelImageStyleGroup(gOld)}). Usa solo stili dello stesso gruppo, oppure rimuovi gli attivi.`,
      };
    }
  }
  return { ok: true, next };
}

export function labelImageStyleGroup(g) {
  if (g === "photorealistic") return "fotorealismo / pittura";
  if (g === "animated") return "animato";
  if (g === "rendered3d") return "3D / render";
  return "sconosciuto";
}

/**
 * Costruisce prompt + negativePrompt combinando la scena con gli stili selezionati.
 * Se nessuno stile è fornito, usa "cinema" come default fotorealistico.
 *
 * @param {string} scenePrompt - Descrizione della scena (posa, outfit, sfondo, luce, camera angle)
 * @param {string|string[]} style - ID stile o array di ID stili
 * @returns {{ prompt: string, negativePrompt: string }}
 */
export function buildStyledPrompt(scenePrompt, style = "cinematic") {
  const idsRaw = Array.isArray(style) ? style : [style];
  const ids = sanitizeImageStyleSelection(idsRaw);
  const resolvedPresets = ids
    .map(id => STYLE_PRESETS_MAP[id])
    .filter(Boolean);

  if (resolvedPresets.length === 0) {
    const fallback = STYLE_PRESETS_MAP["cinematic"] || STYLE_PRESETS[0];
    resolvedPresets.push(fallback);
  }

  const positives = resolvedPresets.map(p => p.prompt).filter(Boolean);
  const negatives = resolvedPresets.map(p => p.negative_prompt).filter(Boolean);

  const prompt = [scenePrompt, ...positives].filter(Boolean).join(", ");
  const rawNegTerms = [...new Set(
    negatives.join(", ").split(",").map(s => s.trim()).filter(Boolean)
  )];
  const negativePrompt = filterConflictingNegatives(rawNegTerms, ids).join(", ");

  return { prompt, negativePrompt };
}
