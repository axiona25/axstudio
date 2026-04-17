/**
 * Contesto unificato per la locandina progetto: la cover è un derivato dello stato del progetto,
 * non un prompt generico indipendente.
 */

import { mergeChapterDataWithProjectCharacterPool, ensureWorkspace } from "./scenografieProjectPersistence.js";
import {
  approvalEntryForCharacter,
  getDisplayMasterUrl,
  stableCharacterKey,
} from "./scenografiePcidLookup.js";
import { composeGlobalVisualStyle } from "./scenografieProjectStyle.js";

/** Composizione tipo one-sheet, senza imporre un medium (foto vs illustrazione — lo decide il preset). */
export function derivePosterCompositionOnlyHint() {
  return "Composition: premium streaming catalog key art / theatrical one-sheet — single dominant focal read, strong silhouette at thumbnail size, clear negative space reserved for future title treatment (absolutely NO text, letters, or logos in the image). Not a film still, not a storyboard panel.";
}

/**
 * Vincolo di stile dal progetto corrente (priorità massima sul risultato).
 * @param {object|null|undefined} projectStyle — globalProjectStyle
 * @param {{ supportingOnly?: boolean }} [opts] — when true, global style refines an existing scene-locked world; must not override scene continuity
 * @returns {{
 *   presetId: string,
 *   label: string,
 *   isAnimated: boolean,
 *   styleLockBlock: string,
 *   posterStyleSource: string,
 *   hasFullStylePrompt: boolean
 * }}
 */
export function derivePosterVisualStyleLock(projectStyle, opts = {}) {
  const supportingOnly = opts?.supportingOnly === true;
  const ps = projectStyle && typeof projectStyle === "object" ? projectStyle : {};
  const presetId = String(ps.presetId || "").trim();
  const label = String(ps.label || "").trim();
  const stylePrompt = String(ps.stylePrompt || "").trim();
  const plannerVisualNotes = String(ps.plannerVisualNotes || "").trim();
  const isAnimated = ps.isAnimated === true;

  const bits = [];
  if (presetId || label) {
    bits.push(
      supportingOnly
        ? `Project graphic preset (supporting refinement): ${[label, presetId && `id=${presetId}`].filter(Boolean).join(" · ")}.`
        : `Project graphic preset (mandatory): ${[label, presetId && `id=${presetId}`].filter(Boolean).join(" · ")}.`,
    );
  }
  if (stylePrompt) {
    bits.push(
      supportingOnly
        ? `Global rendering style (supporting — align palette, brushwork, and materials with this when consistent with approved scenes): ${stylePrompt}`
        : `Global rendering style (mandatory — match this medium, brushwork, lighting grammar, and materials): ${stylePrompt}`,
    );
  }
  if (plannerVisualNotes) {
    bits.push(
      supportingOnly
        ? `Art direction notes (supporting): ${plannerVisualNotes}`
        : `Art direction / mood / tone notes from the project (mandatory): ${plannerVisualNotes}`,
    );
  }
  if (isAnimated) {
    bits.push("This project is animated / illustrative in nature — the poster must stay in that same animated illustrative language, not switch to live-action photorealism unless the style prompt explicitly demands photoreal CGI.");
  } else {
    bits.push("Respect the non-animated look implied by the style prompt — do not switch to cartoon, anime, or children's illustration unless the style prompt explicitly allows it.");
  }
  if (supportingOnly) {
    bits.push(
      "These global style fields refine the poster but must NOT contradict or replace the visual world already established by approved generated scenes.",
    );
  } else {
    bits.push(
      "Do NOT substitute a generic 'cinematic blockbuster' or 'random illustrated' look: the project style fields above are the single source of truth for art direction.",
    );
  }

  const styleLockBlock = bits.join(" ");

  return {
    presetId,
    label,
    isAnimated,
    styleLockBlock,
    posterStyleSource:
      stylePrompt && plannerVisualNotes
        ? "globalProjectStyle.preset+stylePrompt+plannerVisualNotes"
        : stylePrompt
          ? "globalProjectStyle.preset+stylePrompt"
          : presetId || label
            ? "globalProjectStyle.preset+label"
            : "fallback_minimal",
    hasFullStylePrompt: Boolean(stylePrompt),
  };
}

/**
 * Estrae riferimenti testuali da scene approvate e riassunti narrativi (niente URL in prompt — solo descrizione).
 * @param {object} merged — capitolo merged con pool personaggi
 * @param {number} chapterOrdinal
 */
function chapterReferenceSnippets(merged, chapterOrdinal) {
  const plan = merged.plan;
  const del = new Set(merged.deletedSceneIds || []);
  const sceneResults = Array.isArray(merged.sceneResults) ? merged.sceneResults : [];
  const byId = Object.fromEntries(sceneResults.map((r) => [r.sceneId, r]));
  const snippets = [];
  const scenes = Array.isArray(plan?.scenes) ? plan.scenes : [];
  for (const s of scenes) {
    if (!s?.id || del.has(s.id)) continue;
    const row = byId[s.id];
    if (!row || row.approved !== true || !String(row.imageUrl || "").trim()) continue;
    const title = String(s.title || s.slug || "").trim();
    const loc = String(s.location || "").trim().slice(0, 120);
    const mood = String(s.mood || s.visual_mood || "").trim().slice(0, 160);
    const line = [title && `Scene «${title}»`, loc && `setting: ${loc}`, mood && `mood: ${mood}`]
      .filter(Boolean)
      .join(" — ");
    if (line) snippets.push({ chapterOrdinal, line });
  }
  const sum = typeof plan?.summary_it === "string" ? plan.summary_it.trim().slice(0, 900) : "";
  return { snippets, chapterSummaryIt: sum };
}

/**
 * Estrae testo visivo da una scena del piano + riga sceneResults (prompt pipeline / edit).
 * @param {object} scene
 * @param {object|null} row
 * @param {number} chapterOrdinal
 */
function approvedSceneVisualBlob(scene, row, chapterOrdinal) {
  if (!scene?.id) return "";
  const parts = [];
  const tit = String(scene.title_it || scene.title || scene.slug || "").trim();
  if (tit) parts.push(`Ch.${chapterOrdinal} «${tit}»`);
  for (const k of ["description", "summary_it", "environment", "lighting", "mood", "visual_mood", "camera", "palette"]) {
    const v = scene[k];
    if (typeof v === "string" && v.trim()) parts.push(v.trim().slice(0, 420));
  }
  if (row && typeof row.lastEditPrompt === "string" && row.lastEditPrompt.trim()) {
    parts.push(`Last edit direction: ${row.lastEditPrompt.trim().slice(0, 280)}`);
  }
  if (row && Array.isArray(row.editHistory) && row.editHistory.length) {
    const last = row.editHistory[row.editHistory.length - 1];
    if (last && typeof last.prompt === "string" && last.prompt.trim()) {
      parts.push(`Edit history: ${last.prompt.trim().slice(0, 220)}`);
    }
  }
  return parts.filter(Boolean).join(" · ");
}

function compactVisualEvidence(segments, maxLen = 2400) {
  const seen = new Set();
  const out = [];
  for (const s of segments) {
    const t = String(s || "").trim();
    if (t.length < 12) continue;
    const key = t.slice(0, 72).toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    const joined = out.join(" | ");
    if (joined.length >= maxLen) {
      return joined.slice(0, maxLen);
    }
  }
  return out.join(" | ").slice(0, maxLen);
}

/**
 * Inferenza conservativa della famiglia di rendering da testo aggregato + preset (non inventa un nuovo stile).
 */
function inferRenderingFamilySummary(blobLower, presetId, isAnimated) {
  const hints = [];
  if (
    /watercolor|acquerell|storybook|illustrat|children|kids|bimbi|favol|disegn|cartoon|anime|2d|flat|pastel|soft|delicat|gentle|biblic|presepe|nativit|parabolic/i.test(
      blobLower,
    )
  ) {
    hints.push("illustrated / soft / family or storybook-leaning treatment (preserve, do not replace with gritty realism)");
  }
  if (isAnimated || /disney|pixar|stylized 3d|3d animation|cgi character|clay|stop.motion/i.test(blobLower)) {
    hints.push("animated or stylized 3D language consistent with existing frames");
  }
  if (/photoreal|dslr|film grain|anamorphic|cinematic realism|natural skin|documentary lens/i.test(blobLower)) {
    hints.push("photorealistic / cinematic live-action look (preserve)");
  }
  const pid = String(presetId || "").toLowerCase();
  if (!hints.length && pid) {
    if (/realistic|cinematic|portrait|fashion|noir|vintage/.test(pid)) {
      hints.push(`global preset «${presetId}» supports photographic / cinematic continuity`);
    }
    if (/anime|ghibli|manga|comic|cartoon|chibi|disney|pixar|watercolor|pencil/.test(pid)) {
      hints.push(`global preset «${presetId}» supports illustrated / stylized continuity`);
    }
  }
  return hints.length ? hints.join(" ") : "preserve the exact rendering family implied by the scene descriptions above — no medium swap.";
}

/**
 * Continuità visiva dalle scene già generate e approvate (priorità massima per la locandina).
 * @param {object} ws — workspace ensureWorkspace
 * @param {object|null} projectStyle
 */
export function derivePosterSceneVisualContinuity(ws, projectStyle) {
  const chaptersSorted = [...(ws?.chapters || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const segments = [];
  let approvedSceneImageCount = 0;
  const planVisualNotes = [];

  for (let i = 0; i < chaptersSorted.length; i += 1) {
    const merged = mergeChapterDataWithProjectCharacterPool(chaptersSorted[i].data || {}, ws);
    const plan = merged.plan;
    const vs = typeof plan?.visual_style === "string" ? plan.visual_style.trim() : "";
    if (vs) planVisualNotes.push(vs.slice(0, 320));
    const del = new Set(merged.deletedSceneIds || []);
    const sceneResults = Array.isArray(merged.sceneResults) ? merged.sceneResults : [];
    const byId = Object.fromEntries(sceneResults.map((r) => [r.sceneId, r]));
    const scenes = Array.isArray(plan?.scenes) ? plan.scenes : [];
    const ord = i + 1;
    for (const s of scenes) {
      if (!s?.id || del.has(s.id)) continue;
      const row = byId[s.id];
      if (!row || row.approved !== true || !String(row.imageUrl || "").trim()) continue;
      approvedSceneImageCount += 1;
      const blob = approvedSceneVisualBlob(s, row, ord);
      if (blob) segments.push(blob);
    }
  }

  const globalStyleLine = composeGlobalVisualStyle(projectStyle);
  if (globalStyleLine) segments.push(`Project global visual line (from preset): ${globalStyleLine.slice(0, 500)}`);

  const compact = compactVisualEvidence([...planVisualNotes.map((p) => `Planner visual_style: ${p}`), ...segments]);
  const ps = projectStyle && typeof projectStyle === "object" ? projectStyle : {};
  const blobLower = compact.toLowerCase();
  const renderingFamily = inferRenderingFamilySummary(blobLower, ps.presetId, ps.isAnimated === true);

  const visualPillars =
    approvedSceneImageCount > 0
      ? [
          "Visual pillars (from existing approved scene + planner data only — do not invent a different look):",
          `Rendering language & family: ${renderingFamily}`,
          ps.isAnimated === true
            ? "Medium / treatment: animated or illustrative finish — keep the same artistic treatment as approved frames."
            : "Medium / treatment: follow live-action vs illustrated cues from scene evidence; never swap medium for poster impact.",
          compact
            ? `Color world, lighting grammar, environments, mood, detail level (stay in this family): ${compact.slice(0, 1400)}`
            : "",
          "Character depiction: same modeling, proportions, and rendering treatment as in approved scene imagery — no restyle.",
        ]
          .filter(Boolean)
          .join(" ")
      : "";

  const approvedSceneStyleEvidence =
    approvedSceneImageCount > 0
      ? [
          `This project already has ${approvedSceneImageCount} approved generated scene image(s) in the workspace.`,
          "The poster is official key art for that SAME visual world — not a new standalone interpretation.",
          visualPillars,
        ].join(" ")
      : "";

  return {
    approvedSceneImageCount,
    approvedSceneStyleEvidence,
    compactSceneVisualText: compact,
    renderingFamilyHint: renderingFamily,
  };
}

/**
 * Aggrega personaggi dai piani capitolo (dedup chiave stabile).
 */
function aggregatePlanCharacters(workspace) {
  const chapters = [...(workspace?.chapters || [])].sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0),
  );
  const byKey = new Map();
  for (const ch of chapters) {
    const merged = mergeChapterDataWithProjectCharacterPool(ch.data || {}, workspace);
    const plan = merged.plan;
    for (const c of plan?.characters || []) {
      const k = stableCharacterKey(c);
      if (!k || byKey.has(k)) continue;
      byKey.set(k, c);
    }
  }
  return [...byKey.values()];
}

/**
 * @param {object|null|undefined} workspace
 */
export function buildProjectPosterGenerationContext(workspace) {
  const ws = ensureWorkspace(workspace);
  if (!ws) {
    return buildProjectPosterGenerationContextFromLegacy({
      projectTitle: String(workspace?.narrativeProjectTitle || workspace?.projectTitle || "").trim(),
      projectDescription: String(workspace?.narrativeProjectDescription || workspace?.projectDescription || "").trim(),
      projectStyle: workspace?.globalProjectStyle && typeof workspace.globalProjectStyle === "object" ? workspace.globalProjectStyle : null,
      characters: [],
      plannerKeywords: [],
      conceptualOnly: true,
    });
  }
  const title = String(ws.narrativeProjectTitle || ws.projectTitle || "").trim();
  const description = String(ws?.narrativeProjectDescription || ws?.projectDescription || "").trim();
  const projectStyle = ws?.globalProjectStyle && typeof ws.globalProjectStyle === "object" ? ws.globalProjectStyle : null;

  const chaptersSorted = [...(ws?.chapters || [])].sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0),
  );
  const chaptersCount = chaptersSorted.length;

  const meta = ws.storyDrivenMeta && typeof ws.storyDrivenMeta === "object" ? ws.storyDrivenMeta : null;
  let storyPrompt = typeof meta?.storyPrompt === "string" ? meta.storyPrompt.trim().slice(0, 4000) : "";
  const sdp0 = chaptersSorted[0]?.data?.storyDrivenPreproduction;
  if (!storyPrompt && sdp0 && typeof sdp0.storyPrompt === "string") {
    storyPrompt = sdp0.storyPrompt.trim().slice(0, 4000);
  }

  let approvedScenesCount = 0;
  const sceneLines = [];
  const chapterSummaries = [];

  for (let i = 0; i < chaptersSorted.length; i += 1) {
    const ch = chaptersSorted[i];
    const merged = mergeChapterDataWithProjectCharacterPool(ch.data || {}, ws);
    const ord = i + 1;
    const { snippets, chapterSummaryIt } = chapterReferenceSnippets(merged, ord);
    for (const sn of snippets) {
      sceneLines.push(sn.line);
      approvedScenesCount += 1;
    }
    if (chapterSummaryIt) {
      chapterSummaries.push({ ordinal: ord, summaryIt: chapterSummaryIt });
    }
  }

  const aggregatedCharacters = ws ? aggregatePlanCharacters(ws) : [];
  const pcm = ws?.projectCharacterMasters && typeof ws.projectCharacterMasters === "object" ? ws.projectCharacterMasters : {};
  const pam = ws?.projectCharacterApprovalMap && typeof ws.projectCharacterApprovalMap === "object" ? ws.projectCharacterApprovalMap : {};
  let approvedMastersCount = 0;
  for (const c of aggregatedCharacters) {
    if (!getDisplayMasterUrl(c, pcm)) continue;
    const appr = approvalEntryForCharacter(pam, c);
    if (appr?.approved === true) approvedMastersCount += 1;
  }


  let targetAudience =
    typeof ws?.targetAudience === "string"
      ? ws.targetAudience.trim()
      : typeof ws?.audienceHint === "string"
        ? ws.audienceHint.trim()
        : "";
  const sa = sdp0?.storyAnalysis && typeof sdp0.storyAnalysis === "object" ? sdp0.storyAnalysis : null;
  if (!targetAudience && sa && typeof sa.target_audience === "string") {
    targetAudience = sa.target_audience.trim().slice(0, 400);
  }

  const lock = derivePosterVisualStyleLock(projectStyle);
  const continuity = derivePosterSceneVisualContinuity(ws, projectStyle);

  /** @type {'approved_scenes'|'approved_masters'|'project_style'|'legacy'} */
  let visualContinuitySource = "legacy";
  /** @type {'scene_primary'|'master_primary'|'style_primary'|'legacy'} */
  let posterVisualLockStrength = "legacy";
  if (continuity.approvedSceneImageCount > 0) {
    visualContinuitySource = "approved_scenes";
    posterVisualLockStrength = "scene_primary";
  } else if (approvedMastersCount > 0) {
    visualContinuitySource = "approved_masters";
    posterVisualLockStrength = "master_primary";
  } else if (projectStyle && (String(projectStyle.presetId || "").trim() || String(projectStyle.stylePrompt || "").trim())) {
    visualContinuitySource = "project_style";
    posterVisualLockStrength = "style_primary";
  }

  const approvedSceneImageCount = continuity.approvedSceneImageCount;
  const scenesOverrideGenericStyle = approvedSceneImageCount > 0;

  const devLog = {
    projectStylePreset: projectStyle ? String(projectStyle.presetId || "") || null : null,
    concept: Boolean(title || description),
    chaptersCount,
    approvedScenesCount,
    approvedSceneImageCount,
    approvedMastersCount,
    posterStyleSource: lock.posterStyleSource,
    visualContinuitySource,
    posterVisualLockStrength,
    scenesOverrideGenericStyle,
    aggregatedCharacterCount: aggregatedCharacters.length,
    hasStoryBundle: Boolean(storyPrompt),
  };

  return {
    workspace: ws,
    projectTitle: title,
    projectDescription: description,
    projectStyle,
    storyPrompt,
    targetAudience,
    chaptersCount,
    approvedScenesCount,
    approvedMastersCount,
    approvedSceneImageCount,
    approvedSceneStyleEvidence: continuity.approvedSceneStyleEvidence,
    compactSceneVisualText: continuity.compactSceneVisualText,
    renderingFamilyHint: continuity.renderingFamilyHint,
    visualContinuitySource,
    posterVisualLockStrength,
    scenesOverrideGenericStyle,
    sceneReferenceLines: sceneLines.slice(0, 24),
    chapterSummaries,
    aggregatedCharacters,
    /** @type {Record<string, unknown>} */
    devLog,
  };
}

/**
 * Costruisce contesto minimo quando si ha solo i campi legacy (creazione iniziale senza workspace completo in memoria).
 */
export function buildProjectPosterGenerationContextFromLegacy({
  projectTitle,
  projectDescription,
  projectStyle,
  characters,
  plannerKeywords,
  conceptualOnly,
}) {
  const title = String(projectTitle || "").trim();
  const description = String(projectDescription || "").trim();
  const devLog = {
    projectStylePreset: projectStyle ? String(projectStyle.presetId || "") || null : null,
    concept: Boolean(title || description),
    chaptersCount: 0,
    approvedScenesCount: 0,
    approvedSceneImageCount: 0,
    approvedMastersCount: 0,
    posterStyleSource: derivePosterVisualStyleLock(projectStyle).posterStyleSource,
    visualContinuitySource: "legacy",
    posterVisualLockStrength: "legacy",
    scenesOverrideGenericStyle: false,
    aggregatedCharacterCount: Array.isArray(characters) ? characters.length : 0,
    hasStoryBundle: false,
  };

  return {
    workspace: null,
    projectTitle: title,
    projectDescription: description,
    projectStyle: projectStyle && typeof projectStyle === "object" ? projectStyle : null,
    storyPrompt: "",
    targetAudience: "",
    chaptersCount: 0,
    approvedScenesCount: 0,
    approvedMastersCount: 0,
    approvedSceneImageCount: 0,
    approvedSceneStyleEvidence: "",
    compactSceneVisualText: "",
    renderingFamilyHint: "",
    visualContinuitySource: "legacy",
    posterVisualLockStrength: "legacy",
    scenesOverrideGenericStyle: false,
    sceneReferenceLines: [],
    chapterSummaries: [],
    aggregatedCharacters: Array.isArray(characters) ? characters : [],
    legacyPlannerKeywords: Array.isArray(plannerKeywords) ? plannerKeywords : [],
    legacyConceptualOnly: conceptualOnly === true,
    devLog,
  };
}

export function logPosterGenerationContextDev(ctx, label = "[PosterContext]") {
  if (typeof process === "undefined" || process.env.NODE_ENV !== "development") return;
  try {
    // eslint-disable-next-line no-console
    console.info(label, ctx?.devLog || {});
  } catch {
    /* ignore */
  }
}

/**
 * Riferimenti visivi testuali aggregati (per ispezione o prompt esterni).
 * @param {object|null|undefined} workspace
 */
export function derivePosterReferenceAssets(workspace) {
  const ctx = buildProjectPosterGenerationContext(workspace);
  return {
    sceneReferenceLines: ctx.sceneReferenceLines,
    chapterSummaries: ctx.chapterSummaries,
    approvedScenesCount: ctx.approvedScenesCount,
    approvedSceneImageCount: ctx.approvedSceneImageCount,
    approvedSceneStyleEvidence: ctx.approvedSceneStyleEvidence,
    compactSceneVisualText: ctx.compactSceneVisualText,
    renderingFamilyHint: ctx.renderingFamilyHint,
    visualContinuitySource: ctx.visualContinuitySource,
    posterVisualLockStrength: ctx.posterVisualLockStrength,
    scenesOverrideGenericStyle: ctx.scenesOverrideGenericStyle,
    approvedMastersCount: ctx.approvedMastersCount,
    chaptersCount: ctx.chaptersCount,
    devLog: ctx.devLog,
  };
}
