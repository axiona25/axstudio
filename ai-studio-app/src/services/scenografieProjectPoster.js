/**
 * Locandina ufficiale progetto Scenografie — key art da catalogo streaming (non scena narrativa).
 * Il prompt è costruito da buildPosterPromptFromProjectContext a partire dal workspace (stile globale + stato reale).
 */

import { falRequest, MODELS } from "./imagePipeline.js";
import { PROJECT_POSTER_STATUS } from "./scenografieProjectPosterConstants.js";
import {
  buildProjectPosterGenerationContext,
  buildProjectPosterGenerationContextFromLegacy,
  derivePosterVisualStyleLock,
  derivePosterCompositionOnlyHint,
  logPosterGenerationContextDev,
} from "./scenografieProjectPosterContext.js";

export { PROJECT_POSTER_STATUS };
export {
  buildProjectPosterGenerationContext,
  buildProjectPosterGenerationContextFromLegacy,
  derivePosterVisualStyleLock,
  derivePosterReferenceAssets,
} from "./scenografieProjectPosterContext.js";

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
 */
function pickKeyCharacters(characters, max = 4, projectTitle = "", projectDescription = "") {
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
 * Prompt locandina da contesto progetto centralizzato.
 * @param {ReturnType<typeof buildProjectPosterGenerationContext>} ctx
 */
export function buildPosterPromptFromProjectContext(ctx) {
  const title = String(ctx.projectTitle || "").trim();
  const description = String(ctx.projectDescription || "").trim();
  const ps = ctx.projectStyle && typeof ctx.projectStyle === "object" ? ctx.projectStyle : {};
  const presetId = String(ps.presetId || "").trim();
  const approvedSceneImageCount = Number(ctx.approvedSceneImageCount) || 0;
  const scenePrimary = approvedSceneImageCount > 0;
  const lock = derivePosterVisualStyleLock(ctx.projectStyle, { supportingOnly: scenePrimary });

  const chars = pickKeyCharacters(ctx.aggregatedCharacters || [], 4, title, description);
  const charLines = chars.map(characterOneLiner).filter(Boolean);
  const conceptual = ctx.legacyConceptualOnly === true || charLines.length === 0;
  const approvedMastersCount = Number(ctx.approvedMastersCount) || 0;
  const hasApprovedMasters = approvedMastersCount > 0;

  const kw = (Array.isArray(ctx.legacyPlannerKeywords) ? ctx.legacyPlannerKeywords : [])
    .map((k) => String(k || "").trim())
    .filter(Boolean)
    .slice(0, 14);

  const toneBlock = description.slice(0, 1600);
  const keywordBlock = kw.length
    ? `Narrative keywords from planner (mood only — after visual lock; do not override scene continuity): ${kw.join(", ")}.`
    : "";

  const characterBlock = conceptual
    ? scenePrimary
      ? "Symbolic silhouettes or environmental focal moment OK only inside the locked visual world of approved scenes; avoid portrait-ID accuracy; no cast that implies a different medium or art direction."
      : "No finalized cast references required: create evocative iconic key art that matches the project's tone and style lock without specific likenesses. Symbolic silhouettes or environmental focal moment OK; avoid portrait-ID accuracy."
    : hasApprovedMasters
      ? `Preserve identity and style consistency with approved character masters (mood and silhouette — NOT a storyboard frame, NOT documentary still): ${charLines.join(" | ")}. Wardrobe/scale must match masters and the scene visual lock.`
      : `Key cast reference (mood and silhouette only — NOT a storyboard frame, NOT identity-lock): ${charLines.join(" | ")}. Reflect wardrobe/scale suggested by approved masters and plan; do not paste faces as documentary stills.`;

  const primaryContract = scenePrimary
    ? [
        "Narrative contract (secondary to visual continuity): communicate the whole multi-chapter work from the Italian TITLE and DESCRIPTION only within the locked visual world of existing approved scenes.",
        "Emotional promise must align with title + description without genre, medium, or art-direction shift — never sacrifice scene continuity for a more dramatic poster read.",
        "Never use 'first character in JSON' or 'first chapter default' as the main creative guide; catalog key art for the whole work, same visual family as chapter imagery.",
      ].join(" ")
    : [
        "PRIMARY NARRATIVE CONTRACT: this poster must sell the ENTIRE multi-chapter work from the Italian TITLE and DESCRIPTION (and existing narrative summaries when present).",
        "The dominant emotional promise must match title + description (e.g. a children's religious biography must read gentle, age-appropriate, and faithful to that brief — not a different genre).",
        "Never use 'first character in JSON', 'first scene still', or 'first chapter default' as the main creative guide. The poster is catalog key art for the whole work.",
      ].join(" ");

  const multiChapterBlock =
    ctx.chaptersCount > 1
      ? `This is a multi-chapter project (${ctx.chaptersCount} chapters). The image must feel like ONE unified film/series key art for the whole catalog entry, not a random chapter thumbnail or genre shift.`
      : "";

  const summaryBits = (ctx.chapterSummaries || [])
    .map((s) => `Chapter ${s.ordinal} synopsis (Italian): ${String(s.summaryIt || "").slice(0, 700)}`)
    .filter(Boolean);
  const summaryBlock = summaryBits.length ? summaryBits.join(" \n ") : "";

  const sceneRefBlock =
    ctx.sceneReferenceLines && ctx.sceneReferenceLines.length
      ? scenePrimary
        ? `Approved scene anchors (mood/setting — same world as finalized chapter imagery): ${ctx.sceneReferenceLines.slice(0, 18).join(" | ")}.`
        : `Approved scene visual anchors (secondary — mood/setting only, not literal frame copy): ${ctx.sceneReferenceLines.slice(0, 18).join(" | ")}.`
      : "";

  const storyBlock = ctx.storyPrompt ? `Original full story / treatment excerpt (tone anchor): ${ctx.storyPrompt.slice(0, 3500)}` : "";

  const audienceBlock = ctx.targetAudience
    ? `Target audience / tone guardrail: ${ctx.targetAudience}. The poster must remain appropriate and visually aligned with this audience.`
    : "";

  const styleFallback =
    !lock.hasFullStylePrompt && !String(ps.label || "").trim()
      ? "If style fields are thin, default to a restrained premium catalog look that still follows any preset label available — do not invent an unrelated genre."
      : "";

  const sectionA =
    scenePrimary && ctx.approvedSceneStyleEvidence
      ? [
          "A. VISUAL CONTINUITY LOCK (strongest — official poster of an already visually defined project):",
          String(ctx.approvedSceneStyleEvidence || "").trim(),
          "The poster MUST match existing approved generated scenes: same rendering language, stylistic family, visual world, tone, and artistic treatment.",
          "No style drift; no reinterpretation into a different genre or look; no 'fresh' art direction that breaks chapter imagery.",
          "ANTI-DRIFT (mandatory):",
          "- Do not reinterpret the project into a different visual style or medium.",
          "- Do not switch illustrated/storybook/soft family language into generic cinematic photoreal or dramatic adult blockbuster poster language.",
          "- Do not switch photoreal/cinematic language into cartoon, anime, or juvenile illustration unless approved scene evidence clearly supports that family.",
          "- Do not introduce unrelated poster aesthetics; preserve continuity with established chapter imagery.",
          sceneRefBlock,
        ]
          .filter(Boolean)
          .join(" ")
      : scenePrimary
        ? [
            "A. VISUAL CONTINUITY LOCK (strongest): approved scenes exist — match their visual world; no drift.",
            sceneRefBlock,
          ]
            .filter(Boolean)
            .join(" ")
        : "";

  const sectionB = ["B. CHARACTER CONTINUITY / CAST:", characterBlock].join(" ");

  const sectionC = scenePrimary
    ? [
        "C. PROJECT STYLE (supporting refinement only — cannot override A; preset may refine palette and finish but must not break scene continuity):",
        lock.styleLockBlock,
        styleFallback,
      ]
        .filter(Boolean)
        .join(" ")
    : [
        "C. PROJECT STYLE LOCK (highest priority when no approved scene imagery lock):",
        lock.styleLockBlock,
        styleFallback,
      ]
        .filter(Boolean)
        .join(" ");

  const sectionD = [
    "D. NARRATIVE POSTER COMPOSITION (only after visual lock is fixed):",
    primaryContract,
    multiChapterBlock,
    derivePosterCompositionOnlyHint(),
    "— Narrative & world (Italian brief — do not paint text on the image):",
    title ? `Title mood: ${title}.` : "",
    toneBlock ? `Story world / tone / concept: ${toneBlock}` : "",
    storyBlock,
    summaryBlock,
    !scenePrimary ? sceneRefBlock : "",
    audienceBlock,
    keywordBlock,
  ]
    .filter(Boolean)
    .join(" ");

  const positivePrompt = [
    "OFFICIAL STREAMING CATALOG KEY ART / THEATRICAL ONE-SHEET (poster-oriented, not a single scene frame).",
    sectionA,
    sectionB,
    sectionC,
    sectionD,
    !scenePrimary && ps.isAnimated === true ? "Animated / illustrative finish consistent with the style lock above." : "",
    scenePrimary
      ? "Avoid: any medium or style drift vs approved scenes, crowded ensemble chaos, comic panels, UI, watermarks, subtitles."
      : "Avoid: style drift into a different medium than the lock, crowded ensemble chaos, comic panels, UI, watermarks, subtitles.",
  ]
    .filter(Boolean)
    .join(" ");

  const baseNeg = String(ps.negativePrompt || "").trim();
  const posterNeg = [
    baseNeg,
    scenePrimary
      ? "visual style drift, genre shift, different art direction than established chapter scenes, unrelated blockbuster poster clichés, photoreal overhaul of illustrated work, illustration overhaul of photoreal work"
      : "",
    "text, title, caption, watermark, logo, typography, letters, numbers, subtitles, UI, interface",
    "multiple disconnected focal points, chaotic collage, messy clutter, overcrowded composition",
    "storyboard, sequential panels, split screen, contact sheet, film strip",
    "extreme fisheye, heavy motion blur, cctv, security cam, screenshot, meme layout",
    "low resolution, jpeg artifacts",
  ]
    .filter(Boolean)
    .join(", ");

  const metadata = {
    kind: "official_project_poster_v2",
    presetId: presetId || null,
    styleLabel: ps.label || null,
    conceptualOnly: conceptual,
    keyCharacterCount: charLines.length,
    plannerKeywordCount: kw.length,
    positiveCharCount: positivePrompt.length,
    posterStyleSource: lock.posterStyleSource,
    visualContinuitySource: ctx.visualContinuitySource || null,
    posterVisualLockStrength: ctx.posterVisualLockStrength || null,
    approvedSceneImageCount,
    scenesOverrideGenericStyle: ctx.scenesOverrideGenericStyle === true,
    chaptersCount: ctx.chaptersCount,
    approvedScenesCount: ctx.approvedScenesCount,
    approvedMastersCount: ctx.approvedMastersCount,
    posterContextDev: ctx.devLog || {},
  };

  logPosterGenerationContextDev(ctx);

  return {
    positivePrompt,
    negativePrompt: posterNeg,
    metadata,
  };
}

/**
 * Costruisce il pacchetto prompt locandina.
 * Preferire `{ workspace }` per rispettare stile e stato reali del progetto.
 *
 * @param {{
 *   workspace?: object,
 *   projectTitle?: string,
 *   projectDescription?: string,
 *   projectStyle?: object|null,
 *   characters?: object[]|null,
 *   plannerKeywords?: string[]|null,
 *   conceptualOnly?: boolean
 * }} input
 */
export function buildProjectPosterPromptPack(input) {
  if (input?.workspace) {
    const ctx = buildProjectPosterGenerationContext(input.workspace);
    return buildPosterPromptFromProjectContext(ctx);
  }
  const ctx = buildProjectPosterGenerationContextFromLegacy({
    projectTitle: input.projectTitle,
    projectDescription: input.projectDescription,
    projectStyle: input.projectStyle,
    characters: input.characters,
    plannerKeywords: input.plannerKeywords,
    conceptualOnly: input.conceptualOnly,
  });
  return buildPosterPromptFromProjectContext(ctx);
}

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
  const pack = opts.workspace
    ? buildProjectPosterPromptPack({ workspace: opts.workspace })
    : buildProjectPosterPromptPack({
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
    workspace: opts.workspace,
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
