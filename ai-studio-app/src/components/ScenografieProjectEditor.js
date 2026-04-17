/**
 * Editor singolo progetto Scenografie — piano, master, scene, approvazioni, passaggio video.
 */

import React, { useState, useRef, useCallback, useLayoutEffect, useEffect, useMemo } from "react";
import {
  HiSparkles,
  HiCheck,
  HiXMark,
  HiArrowPath,
  HiPhoto,
  HiUser,
  HiFilm,
  HiPlus,
  HiChevronUp,
  HiChevronDown,
  HiVideoCamera,
  HiInformationCircle,
  HiMicrophone,
  HiBars3,
  HiPencilSquare,
} from "react-icons/hi2";
import { ScenografieCharacterVoicePicker } from "./ScenografieCharacterVoicePicker.js";
import {
  planScenografia,
  planScenografiaContinue,
  validatePlan,
  getCharactersNeedingMaster,
  characterRoleLabelIt,
  CHARACTER_ROLE,
  sceneTypeUiLabelIt,
  isEnvironmentScene,
  normalizeSceneType,
  buildNarrativeHeaderDescription,
  resolveItalianPlanLogline,
  resolveItalianSceneSummaryForDisplay,
} from "../services/scenografiePlanner.js";
import {
  loadScenografiaProjectById,
  saveScenografiaProjectById,
  upsertScenografiaProjectInIndex,
  deleteScenografiaProjectById,
  emptyScenografiaProjectPayload,
  deriveScenografiaUiStatus,
  SCENOGRAFIA_UI_STATUS_LABEL,
  isWorkspacePayload,
  upsertChapterDataInWorkspace,
  mergeChapterDataWithProjectCharacterPool,
  mergeProjectCharacterMastersFromLegacy,
  PCM_SOURCE_USER_CANONICAL_LOCK,
  characterMasterReadyForScenes,
  reconcileCharacterMasterMaps,
  inferPcidMasterLayout,
  summarizeScenografiaWorkspaceForIndex,
  SCENOGRAFIA_WORKSPACE_VERSION,
  runAndPersistFilmOutputVerification,
} from "../services/scenografieProjectPersistence.js";
import {
  syncDerivedMasterCachesFromCanonical,
  promoteCanonicalProjectCharacterMaster,
  swapCanonicalProjectCharacterMasters,
  reassignCanonicalMasterToCharacter,
  auditDerivedCacheDrift,
  CANONICAL_PCM_LOG,
} from "../services/scenografieCanonicalCharacterMasters.js";
import {
  stableCharacterKey,
  findPlanCharacterByPresentRef,
  findPlanCharacterByLocalId,
  planCharacterMapByPresentRef,
  planCharacterDisplayName,
  pcmRowForCharacter,
  approvalEntryForCharacter,
  voiceMasterRawForRef,
  resolveMasterUrlForPlanChar,
  getDisplayMasterUrl,
  isHttpUrl,
  isPcidKey,
} from "../services/scenografiePcidLookup.js";
import {
  createMasterCharacter,
  generateSceneBase,
  lockCharacterIdentity,
  repairCharacterScene,
  editScenografiaSceneWithPrompt,
  imageUrlToBase64,
} from "../services/imagePipeline.js";
import { isAnimatedStyle, buildScenePrompt } from "../services/imagePrompts.js";
import { buildProjectStyleFromPlan, composeGlobalVisualStyle } from "../services/scenografieProjectStyle.js";
import {
  normalizeSceneVideoClip,
  SCENE_VIDEO_CLIP_STATUS,
  SCENE_VIDEO_CLIP_STATUS_LABEL,
  allActiveScenesApproved,
  allCharacterMastersApprovedForVideo,
  clipsReadyForFinalMontage,
  buildMontagePlanFromTimeline,
  buildSuggestedTimelineEntries,
  getApprovedActiveScenes,
  normalizeTimelinePlan,
  timelineNarrativeApproved,
  reorderPlanScenesImmutable,
  syncAfterScenePlanReorder,
  reorderSceneResultsArray,
  createEmptySceneVideoClip,
  normalizeCharacterVoiceMaster,
  getClipGenerationReadiness,
  resolveClipDurationSeconds,
  estimateClipDurationAuto,
  CLIP_TYPE,
} from "../services/scenografieVideoWorkflow.js";
import {
  compileMontagePlans,
  runFinalMontageRender,
  validateMontageRenderable,
  emptyFinalFilmMontage,
  normalizeFinalFilmMontage,
  resolveEffectiveClipDurationSeconds,
} from "../services/montageAssembler.js";
import { ScenografieClipBuilder } from "./ScenografieClipBuilder.js";
import {
  normalizeProjectNarratorsList,
  ensureProjectNarratorDefaultFlags,
} from "../services/scenografieProjectNarrators.js";
import { ScenografieNarratorSection } from "./ScenografieNarratorSection.js";
import { runScenografieClipVideoPipeline } from "../services/videoClipPipeline.js";
import { sanitizeClipPipelineErrorForUser } from "../services/scenografieClipUserMessages.js";
import {
  buildMontageFailureRecord,
  logConsumerReliabilityEvent,
  SUGGESTED_ACTION_LABEL_IT,
  consumerMontageNextStepIt,
  deriveFilmOutputReadinessFromChapterData,
  deriveChapterMontageConsumerSummary,
  deriveFinalOutputSimplePresentation,
  FILM_DELIVERY_LABEL_IT,
  FILM_OUTPUT_TRUST_LABEL_IT,
  buildFinalFilmPlaybackCandidates,
  mergePlaybackEntriesChapterFirst,
  describeFinalFilmPlaybackMoment,
  humanizeHtml5VideoElementError,
} from "../services/scenografieConsumerReliability.js";
import {
  computeChapterCompletionGaps,
  deriveSceneOperationalSemantics,
  deriveClipOperationalSemantics,
  buildSceneChecklistRuntimeItems,
  clipOperationalLabelIt,
  SCENE_OPERATIONAL,
  CLIP_OPERATIONAL,
} from "../services/scenografieOperationalReadiness.js";
import {
  normalizeSceneResultRow,
  resolveSceneThumbnailUrl,
  SCENE_DISPLAY_VARIANT,
  logSceneVariantState,
} from "../services/scenografieSceneVariants.js";
import { ASSET_DOMAIN } from "../mediaAssetDomain.js";

const AX = {
  bg: "#0a0a0f", surface: "#13131a", card: "#1a1a24", border: "#23232e",
  text: "#f4f4f8", text2: "#a1a1b5", muted: "#6b6b80",
  electric: "#29b6ff", violet: "#7b4dff", magenta: "#ff4fa3",
  gradPrimary: "linear-gradient(135deg, #29b6ff 0%, #7b4dff 100%)",
  gradLogo: "linear-gradient(135deg,#29b6ff,#7b4dff,#ff4fa3)",
};

/** Blocco fase Scenografie: token AX + accento per step (workflow premium, non “admin panel”). */
function phaseUi(phaseNum) {
  const accent =
    phaseNum === 1 ? AX.electric : phaseNum === 2 ? "#45c4ff" : phaseNum === 3 ? AX.violet : AX.magenta;
  const tint =
    phaseNum === 1
      ? "rgba(41,182,255,0.11)"
      : phaseNum === 2
        ? "rgba(41,182,255,0.09)"
        : phaseNum === 3
          ? "rgba(123,77,255,0.12)"
          : "rgba(255,79,163,0.11)";
  const step = phaseNum === 1 ? "01" : phaseNum === 2 ? "02" : phaseNum === 3 ? "03" : "04";
  const baseShadow = `0 28px 72px rgba(0,0,0,0.48), 0 0 60px -18px ${tint}`;
  const innerRim = "0 0 0 1px rgba(255,255,255,0.045) inset";
  return {
    step,
    accent,
    tint,
    topHairline: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 2,
      background: `linear-gradient(90deg, ${accent} 0%, transparent 55%)`,
      opacity: 0.65,
      pointerEvents: "none",
    },
    shell: {
      marginBottom: 26,
      borderRadius: 18,
      border: `1px solid ${AX.border}`,
      borderLeft: `3px solid ${accent}`,
      background: `linear-gradient(168deg, ${AX.surface} 0%, ${AX.card} 44%, ${AX.bg} 100%)`,
      boxShadow: `${baseShadow}, ${innerRim}`,
      overflow: "hidden",
      position: "relative",
      transition: "box-shadow 220ms ease, transform 220ms ease",
    },
    shellHover: (active) =>
      active
        ? {
            boxShadow: `${baseShadow}, 0 0 80px -10px ${tint}, ${innerRim}, 0 20px 48px rgba(0,0,0,0.38)`,
            transform: "translateY(-2px)",
          }
        : {},
    head: {
      padding: "20px 26px 18px",
      borderBottom: `1px solid ${AX.border}`,
      background: `linear-gradient(108deg, ${tint} 0%, rgba(19,19,26,0.35) 48%, transparent 100%)`,
    },
    kickerRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 10 },
    stepBadge: {
      flexShrink: 0,
      fontSize: 10,
      fontWeight: 900,
      letterSpacing: "0.08em",
      color: accent,
      padding: "5px 11px",
      borderRadius: 10,
      border: `1px solid ${accent}50`,
      background: `linear-gradient(155deg, ${tint}, rgba(10,10,15,0.75))`,
      boxShadow: `0 0 24px -6px ${tint}`,
    },
    kicker: {
      fontSize: 10,
      fontWeight: 800,
      color: AX.muted,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
    },
    title: {
      fontSize: 19,
      fontWeight: 800,
      color: AX.text,
      margin: 0,
      letterSpacing: "-0.03em",
      lineHeight: 1.12,
    },
    sub: { fontSize: 13, color: AX.text2, margin: "10px 0 0", lineHeight: 1.55, maxWidth: 720 },
    body: { padding: "24px 26px 28px" },
    footer: {
      padding: "18px 26px",
      borderTop: `1px solid ${AX.border}`,
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      justifyContent: "flex-end",
      alignItems: "center",
      background: `linear-gradient(180deg, rgba(10,11,18,0.25) 0%, rgba(4,5,10,0.78) 100%)`,
    },
  };
}

const PROMPT_TEXTAREA_MIN_PX = 240;
const PROMPT_TEXTAREA_MAX_PX = 520;

function normCharName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function charHasResolvedMaster(char, projectCharacterMasters) {
  return !!getDisplayMasterUrl(char, projectCharacterMasters);
}

const CHARACTER_PROMPT_HISTORY_MAX = 12;

/** @param {unknown} prev */
function appendCharacterPromptHistory(prev, prompt) {
  const p = String(prompt || "").trim();
  if (!p) return Array.isArray(prev) ? [...prev] : [];
  const h = Array.isArray(prev) ? [...prev] : [];
  if (h[0]?.prompt === p) return h;
  h.unshift({ prompt: p, at: new Date().toISOString() });
  return h.slice(0, CHARACTER_PROMPT_HISTORY_MAX);
}

/** Testo extra per `createMasterCharacter`: prompt dedicato del creator se presente, altrimenti `appearance_prompt` del piano. */
function buildMasterExtraPromptForCharacter(char, pcmRow) {
  if (!char) return "";
  const custom = pcmRow && String(pcmRow.characterMasterPrompt || "").trim();
  const name = String(char.name || "").trim();
  const nameLine = name
    ? `Character «${name}». One subject only, portrait. Follow the creator description closely for age, face, hair, facial hair (or none), expression, visual role, base clothing, vibe, gender presentation.`
    : "";
  if (custom) {
    const outfit = char.appearance?.outfit ? `Base outfit hint from plan: ${char.appearance.outfit}.` : "";
    return [nameLine, custom, outfit].filter(Boolean).join(" ");
  }
  return [nameLine, char.appearance_prompt || ""].filter(Boolean).join(" ");
}

/** Testo scena normalizzato (titolo + riassunto IT + description) per inferenza nomi. */
function normSceneTextBlob(scene) {
  const t = `${scene?.title_it || ""} ${scene?.summary_it || ""} ${scene?.description || ""}`;
  return normCharName(t).replace(/\s+/g, " ");
}

/**
 * Id personaggio per pipeline scena: solo id del piano; mai il «primo» di getCharactersNeedingMaster.
 * Se `characters_present` è vuoto o con id non validi, match su titolo/riassunto IT.
 * @returns {{ ids: string[], source: string }}
 */
function resolveSceneCharacterIdsForPipeline(scene, plan) {
  const chars = Array.isArray(plan?.characters) ? plan.characters : [];
  const presentMap = planCharacterMapByPresentRef(plan);
  const raw = Array.isArray(scene?.characters_present) ? scene.characters_present : [];
  const sanitized = [
    ...new Set(
      raw
        .map((id) => String(id || "").trim())
        .filter((id) => id && presentMap.has(id))
        .map((id) => {
          const c = presentMap.get(id);
          return c ? stableCharacterKey(c) : "";
        })
        .filter(Boolean),
    ),
  ];

  if (isEnvironmentScene(scene)) {
    return { ids: [], source: "environment_scene" };
  }

  if (sanitized.length > 0) {
    return { ids: sanitized, source: "characters_present" };
  }

  const blob = normSceneTextBlob(scene);
  const ranked = chars
    .map((c) => {
      const nk = normCharName(c.name);
      if (!nk || nk.length < 2) return { c, score: 0 };
      let score = 0;
      if (blob.includes(nk)) score += 24;
      const parts = String(c.name || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2);
      for (const w of parts) {
        if (blob.includes(w)) score += 10;
      }
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length >= 1) {
    const top = ranked[0].score;
    const ties = ranked.filter((r) => r.score === top);
    if (ties.length === 1) return { ids: [stableCharacterKey(ties[0].c)], source: "title_summary_name_match" };
    return { ids: ties.map((t) => stableCharacterKey(t.c)), source: "title_summary_name_match_tie" };
  }

  const protag =
    chars.find((c) => c.is_protagonist) ||
    chars.find((c) => c.character_role === CHARACTER_ROLE.PROTAGONIST) ||
    null;
  if (protag) return { ids: [stableCharacterKey(protag)], source: "plan_protagonist_fallback" };

  if (chars[0]) return { ids: [stableCharacterKey(chars[0])], source: "first_plan_character_fallback" };
  return { ids: [], source: "none" };
}

/**
 * Master per identity lock — stessi gate di `characterMasterReadyForScenes` (PCM + approvazione + `pcmRowTrustedForIdentityLock`).
 */
function buildApprovedMasterUrlMap(plan, projectCharacterMasters, characterApprovalMap) {
  const out = {};
  const pcm = projectCharacterMasters && typeof projectCharacterMasters === "object" ? projectCharacterMasters : {};
  const gate = { projectCharacterMasters: pcm, characterApprovalMap };
  for (const char of plan?.characters || []) {
    if (!char?.id) continue;
    const sk = stableCharacterKey(char);
    if (!sk) continue;
    if (!characterMasterReadyForScenes(char, gate)) continue;
    const row = pcmRowForCharacter(pcm, char);
    const u = row?.masterImageUrl ? String(row.masterImageUrl).trim() : "";
    if (u) out[sk] = u;
  }
  return out;
}

/** Anteprima URL per log (evita righe chilometriche). */
function shortUrl(u, max = 88) {
  const s = String(u || "");
  if (!s) return "(vuoto)";
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** Id in characters_present che non risolvono a nessun personaggio (pcid o char_N). */
function collectInvalidPresentIds(scene, plan) {
  const raw = Array.isArray(scene?.characters_present) ? scene.characters_present : [];
  return [...new Set(raw.map((id) => String(id || "").trim()).filter(Boolean))].filter(
    (id) => !findPlanCharacterByPresentRef(plan, id),
  );
}

/**
 * Meta master per log: confronto sorgente canonica vs cache legacy.
 * @param {object} char
 */
function masterUrlMetaForLog(char, projectCharacterMasters, masterImages, masterByCharName, characterApprovalMap) {
  if (!char?.id) {
    return { characterId: null, name: null, approved: false, url: null, source: "none", readyForScenes: false };
  }
  const sk = stableCharacterKey(char);
  const approved = approvalEntryForCharacter(characterApprovalMap, char)?.approved === true;
  const row = pcmRowForCharacter(projectCharacterMasters, char);
  const canonicalUrl = row?.masterImageUrl ? String(row.masterImageUrl).trim() : null;
  const byStable = sk && masterImages?.[sk] ? String(masterImages[sk]).trim() : null;
  const byId = masterImages?.[char.id] ? String(masterImages[char.id]).trim() : null;
  const nk = normCharName(char.name);
  const byName = nk && masterByCharName?.[nk] ? String(masterByCharName[nk]).trim() : null;
  const legacyDerivedUrl = resolveMasterUrlForPlanChar(char, masterImages, masterByCharName);
  const gatePayload = { projectCharacterMasters, characterApprovalMap };
  const readyForScenes = characterMasterReadyForScenes(char, gatePayload);
  let source = "none";
  if (canonicalUrl) source = `canonical:${row?.source || "unknown"}`;
  else if (legacyDerivedUrl && byName && legacyDerivedUrl === byName) source = "legacy_name_only_cache";
  else if (
    legacyDerivedUrl &&
    (byStable || byId) &&
    (legacyDerivedUrl === byStable || legacyDerivedUrl === byId)
  )
    source = "legacy_id_only_cache";
  else if (legacyDerivedUrl) source = "legacy_cache_mismatch_or_orphan";
  return {
    characterId: char.id,
    stableKey: sk,
    name: char.name,
    approved,
    url: canonicalUrl || null,
    legacyDerivedUrl: legacyDerivedUrl || null,
    source,
    canonicalSource: row?.source || null,
    pendingManualReview: row?.pendingManualReview === true,
    hadMasterImagesKey: !!(byStable || byId),
    hadMasterByCharNameKey: !!byName,
    cacheMatchesCanonical: !!(
      canonicalUrl &&
      (byStable || byId) &&
      (byStable === canonicalUrl || byId === canonicalUrl) &&
      (!byName || byName === canonicalUrl || isPcidKey(byName))
    ),
    cacheOutOfSync: !!(canonicalUrl && legacyDerivedUrl && canonicalUrl !== legacyDerivedUrl),
    readyForScenes,
  };
}

function isMariaGiuseppeTraceName(name) {
  const n = normCharName(name);
  return n.includes("maria") || n.includes("giuseppe");
}

/**
 * Trace cast: confronto sorgente canonica vs cache derivata (solo nomi con maria/giuseppe per log mirato).
 */
function buildMasterPipelineTraceRow(char, pcm, cacheMi, cacheMbn, characterApprovalMap, mastersMap) {
  if (!char?.id) return null;
  const sk = stableCharacterKey(char);
  const nk = normCharName(char.name);
  const row = pcmRowForCharacter(pcm, char);
  const canonicalUrl = row?.masterImageUrl?.trim() || null;
  const uiCardUrl = getDisplayMasterUrl(char, pcm);
  const byStable = sk && cacheMi?.[sk] ? String(cacheMi[sk]).trim() : null;
  const byId = cacheMi?.[char.id] ? String(cacheMi[char.id]).trim() : null;
  const byName = nk && cacheMbn?.[nk] ? String(cacheMbn[nk]).trim() : null;
  return {
    characterId: char.id,
    stableKey: sk,
    characterName: char.name,
    canonical_master_url: canonicalUrl,
    uiCardUrl: uiCardUrl,
    derived_masterImagesUrl: byStable || byId,
    derived_masterByCharNameUrl: byName,
    approvedMasterUrlMapUrl: mastersMap[sk] || null,
    approved: approvalEntryForCharacter(characterApprovalMap, char)?.approved === true,
    pendingManualReview: row?.pendingManualReview === true,
    canonical_source: row?.source || null,
    cache_differs_from_canonical: !!(
      canonicalUrl &&
      (((byStable || byId) && byStable !== canonicalUrl && byId !== canonicalUrl) ||
        (byName && !isHttpUrl(byName) && byName !== canonicalUrl) ||
        (byName && isHttpUrl(byName) && byName !== canonicalUrl))
    ),
  };
}

/**
 * Warning se titolo/riassunto citano un personaggio ma gli id risolti non lo includono, o il contrario.
 * @param {string[]} resolvedIds
 * @returns {string[]}
 */
function diagnoseTitleResolvedMismatch(scene, plan, resolvedIds) {
  const blob = normSceneTextBlob(scene);
  const chars = Array.isArray(plan?.characters) ? plan.characters : [];
  const warnings = [];
  const mentioned = chars.filter((c) => {
    const nk = normCharName(c.name);
    return nk.length >= 2 && blob.includes(nk);
  });
  for (const c of mentioned) {
    const sk = stableCharacterKey(c);
    if (!resolvedIds.includes(sk)) {
      warnings.push(
        `SEMANTICA: titolo/summary citano «${c.name}» (id ${c.id}${sk && sk !== c.id ? `, pcid ${sk}` : ""}) ma NON è tra gli id risolti [${resolvedIds.join(", ") || "—"}] — controllare characters_present / piano.`,
      );
    }
  }
  for (const rid of resolvedIds) {
    const c = findPlanCharacterByPresentRef(plan, rid);
    if (!c) continue;
    const nk = normCharName(c.name);
    if (nk.length >= 2 && !blob.includes(nk) && mentioned.length > 0) {
      const names = mentioned.map((m) => m.name).join(", ");
      warnings.push(
        `SEMANTICA: id risolto «${c.name}» (${rid}) ma testo scena sembra centrato su ${names} — possibile mismatch piano/LLM.`,
      );
    }
  }
  return warnings;
}

/** Personaggi il cui nome compare nel titolo/riassunto/description scena (testo normalizzato). */
function charactersMentionedInSceneText(scene, plan) {
  const blob = normSceneTextBlob(scene);
  const chars = Array.isArray(plan?.characters) ? plan.characters : [];
  return chars.filter((c) => {
    const nk = normCharName(c.name);
    return nk.length >= 2 && blob.includes(nk);
  });
}

/** Suggerimento placeholder nome progetto se l’utente non ne ha impostato uno. */
function fallbackProjectTitlePlaceholder(plan, prompt) {
  const logIt = resolveItalianPlanLogline(plan);
  if (logIt) {
    const t = logIt.replace(/\s+/g, " ");
    return t.length > 52 ? `${t.slice(0, 50)}…` : t;
  }
  const t0 = plan?.scenes?.[0]?.title_it;
  if (t0) {
    const t = String(t0).trim();
    return t.length > 52 ? `${t.slice(0, 50)}…` : t;
  }
  const pr = typeof prompt === "string" && prompt.trim();
  if (pr) {
    const t = pr.replace(/\s+/g, " ");
    return t.length > 48 ? `${t.slice(0, 46)}…` : t;
  }
  return "Progetto scenografico";
}

/** Merge una scena appena generata in `sceneResults` ordinati come il piano (stessa logica di setSceneResults post-pipeline). */
function mergePipelineSceneIntoResults(prevRows, scene, finalUrl, sceneBaseResult, updatedAt, del, plan) {
  const prev = Array.isArray(prevRows) ? prevRows : [];
  const map = new Map(prev.map((r) => [r.sceneId, r]));
  const prevRow = map.get(scene.id);
  const rowInput = {
    sceneId: scene.id,
    title: scene.title_it,
    sceneBaseUrl: sceneBaseResult.outputImage,
    sceneFinalUrl: finalUrl,
    sceneDisplayedVariant: SCENE_DISPLAY_VARIANT.FINAL,
    approved: false,
    approvedAt: null,
    lastEditPrompt: null,
    editHistory: prevRow?.editHistory ? [...prevRow.editHistory] : [],
    sceneVariantHistory: prevRow?.sceneVariantHistory ? [...prevRow.sceneVariantHistory].slice(-24) : [],
    lastUpdatedAt: updatedAt,
  };
  const normalized = normalizeSceneResultRow(rowInput);
  map.set(scene.id, normalized);
  return (plan.scenes || [])
    .filter((s) => !del.has(s.id))
    .map((s) => map.get(s.id))
    .filter(Boolean);
}

function shortUrlForSceneLog(u, max = 96) {
  if (u == null) return "(null)";
  const s = String(u);
  if (!s) return "(empty)";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function sceneRowDebugLine(r, deletedSet) {
  if (!r) return "(null)";
  const del = deletedSet && deletedSet.has(r.sceneId);
  const thumb = resolveSceneThumbnailUrl(r);
  return [
    `sceneId=${r.sceneId}`,
    `title=${JSON.stringify(String(r.title || ""))}`,
    `sceneDisplayedVariant=${r.sceneDisplayedVariant != null ? String(r.sceneDisplayedVariant) : "-"}`,
    `sceneDisplayedUrl=${shortUrlForSceneLog(r.sceneDisplayedUrl)}`,
    `imageUrl=${shortUrlForSceneLog(r.imageUrl)}`,
    `sceneBaseUrl=${shortUrlForSceneLog(r.sceneBaseUrl)}`,
    `baseImageUrl/scene_base=${shortUrlForSceneLog(r.baseImageUrl)}`,
    `sceneFinalUrl/final_output=${shortUrlForSceneLog(r.sceneFinalUrl)}`,
    `thumb_resolved=${shortUrlForSceneLog(thumb)}`,
    `approved=${!!r.approved}`,
    `deletedInPlan=${del}`,
    `displayedVariant_legacy=${r.displayedVariant != null ? String(r.displayedVariant) : "-"}`,
  ].join(" | ");
}

function logSceneResultsSnapshot(tag, rows, deletedSet) {
  const list = Array.isArray(rows) ? rows : [];
  const head = `[SCENE GENERATE · ${tag}] len=${list.length} ids=${JSON.stringify(list.map((r) => r?.sceneId))}`;
  const body = list.map((r, i) => `  [${i}] ${sceneRowDebugLine(r, deletedSet)}`).join("\n");
  console.log(`${head}\n${body}`);
}

function shouldTraceSceneRow(r) {
  if (!r?.sceneId) return false;
  if (r.sceneId === "scene_2") return true;
  const t = String(r.title || "");
  return t.includes("Maria nel villaggio");
}

function logTraceScene2Lifecycle(phase, lines) {
  const block = [`[TRACE scene_2 lifecycle · ${phase}]`, ...lines.map((l) => `  ${l}`)].join("\n");
  console.log(block);
}

export function ScenografieProjectEditor({
  projectId,
  projectNumber = 1,
  chapterId,
  chapterOrdinal = 1,
  onBack,
  onGoToVideoProduction,
  onSave,
  generatedImages,
  setGeneratedImages,
  imageStatus,
  setImageStatus,
  imageProgress,
  setImageProgress,
  imageStylePresets = [],
  sharedPipelineAbortRef = null,
  scenePipelineFlight = null,
  setScenePipelineFlight = null,
  initialRecoveryDeepLink = null,
  onConsumedRecoveryDeepLink,
}) {
  const [prompt, setPrompt] = useState("");
  /** Nome progetto scenografico (persistito). */
  const [projectTitle, setProjectTitle] = useState("");
  /** Titolo del progetto narrativo (workspace), solo lettura in editor. */
  const [workspaceNarrativeTitle, setWorkspaceNarrativeTitle] = useState("");
  /** Contesto consegna film a livello workspace (solo multi-capitolo, testo guida). */
  const [workspaceMontageContext, setWorkspaceMontageContext] = useState(null);
  /** Snapshot leggero capitoli (playback multi-sorgente, allineato alla Home). */
  const [workspaceChaptersLight, setWorkspaceChaptersLight] = useState([]);
  const [editorFilmPlaybackIndex, setEditorFilmPlaybackIndex] = useState(0);
  const [editorFilmPlaybackError, setEditorFilmPlaybackError] = useState(null);
  const [editorFilmPlaybackReloadKey, setEditorFilmPlaybackReloadKey] = useState(0);
  const [workspaceFilmVerification, setWorkspaceFilmVerification] = useState(null);
  const [editorFilmVerifyBusy, setEditorFilmVerifyBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState("");
  const [executing, setExecuting] = useState(false);
  const [executionLog, setExecutionLog] = useState([]);
  const [masterImages, setMasterImages] = useState({});
  /** Allineato a masterImages per skip nel batch senza attendere il re-render. */
  const masterImagesRef = useRef({});
  masterImagesRef.current = masterImages;
  /** URL master per nome normalizzato — sopravvive a nuovi piano con id diversi. */
  const [masterByCharName, setMasterByCharName] = useState({});
  const masterByCharNameRef = useRef({});
  masterByCharNameRef.current = masterByCharName;
  /** Sorgente canonica unica master personaggio (id piano). Cache: masterImages / masterByCharName. */
  const [projectCharacterMasters, setProjectCharacterMasters] = useState({});
  const projectCharacterMastersRef = useRef({});
  projectCharacterMastersRef.current = projectCharacterMasters;
  /** Narratori di progetto (voce ElevenLabs, distinti dal cast scenico). */
  const [projectNarrators, setProjectNarrators] = useState([]);
  /** Strumenti avanzati: swap / copia master (sorgente sempre PCM). */
  const [masterToolSwapA, setMasterToolSwapA] = useState("");
  const [masterToolSwapB, setMasterToolSwapB] = useState("");
  const [masterToolCopyFrom, setMasterToolCopyFrom] = useState("");
  const [masterToolCopyTo, setMasterToolCopyTo] = useState("");
  /** Deve restare subito dopo masterImages/masterByCharName (evita TDZ se altre espressioni leggono i master). */
  const hasPreservableMasters = useMemo(
    () =>
      Object.keys(projectCharacterMasters || {}).some((id) => String(projectCharacterMasters[id]?.masterImageUrl || "").trim()) ||
      Object.keys(masterImages || {}).length > 0 ||
      Object.keys(masterByCharName || {}).length > 0,
    [projectCharacterMasters, masterImages, masterByCharName],
  );
  const [sceneResults, setSceneResults] = useState([]);
  const [enableRepair, setEnableRepair] = useState(false);
  /** Stile visivo globale del progetto Scenografie (unico, dopo approvazione bloccato). */
  const [projectStyle, setProjectStyle] = useState(null);
  const [projectStyleLocked, setProjectStyleLocked] = useState(false);
  /** Scene selezionate per rigenerazione mirata (id piano). */
  const [selectedSceneIds, setSelectedSceneIds] = useState([]);
  const [persistReady, setPersistReady] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [newProjectConfirmOpen, setNewProjectConfirmOpen] = useState(false);
  /** plan | character_gen | character_approval | scene_gen | complete */
  const [scenografiaPhase, setScenografiaPhase] = useState("plan");
  /** none | production | completed — navigazione verso sezione video libera */
  const [scenografiaVideoPhase, setScenografiaVideoPhase] = useState("none");
  /** none | assembly | done — produzione filmato finale + auto-montaggio (struttura). */
  const [finalMontagePhase, setFinalMontagePhase] = useState("none");
  const [finalMontagePlan, setFinalMontagePlan] = useState({
    orderedClipIds: [],
    orderedTimelineEntryIds: [],
    narrativeBeatNotes: "",
  });
  const [finalFilmMontage, setFinalFilmMontage] = useState(() => emptyFinalFilmMontage());
  const [montageRenderBusy, setMontageRenderBusy] = useState(false);
  const [timelinePlan, setTimelinePlan] = useState({ approved: false, approvedAt: null, entries: [] });
  const dragTimelineIdxRef = useRef(null);
  const sceneReorderSyncBundleRef = useRef({});
  const dragPlanSceneIdxRef = useRef(null);
  const dragGallerySceneIdxRef = useRef(null);
  /** Clip video per scena (URL da collegare al motore). */
  const [sceneVideoClips, setSceneVideoClips] = useState([]);
  /** Id clip aperto nel Clip Builder (modal). */
  const [clipBuilderClipId, setClipBuilderClipId] = useState(null);
  /** Voice master ElevenLabs per personaggio (id piano → meta voce). */
  const [characterVoiceMasters, setCharacterVoiceMasters] = useState({});
  /** Feedback pipeline ElevenLabs → Kling sul clip aperto nel builder. */
  const [clipPipelineUi, setClipPipelineUi] = useState({ busy: false, stage: null, clipId: null });
  const [characterApprovalMap, setCharacterApprovalMap] = useState({});
  const [regeneratingCharId, setRegeneratingCharId] = useState(null);
  /** Durante «Genera master personaggi», quale card è in elaborazione. */
  const [batchMasterCharId, setBatchMasterCharId] = useState(null);
  /** Id scene del piano rimosse dal progetto (non rigenerate finché restano qui). */
  const [deletedSceneIds, setDeletedSceneIds] = useState([]);
  const [sceneCardFocusId, setSceneCardFocusId] = useState(null);
  const [modifyingSceneId, setModifyingSceneId] = useState(null);
  /** Hover card fase (workflow Scenografie — feedback premium). */
  const [hoveredPhase, setHoveredPhase] = useState(null);
  const [modifyDraftPrompt, setModifyDraftPrompt] = useState("");
  const [sceneEditBusyId, setSceneEditBusyId] = useState(null);
  /** Anteprima ingrandita (solo doppio click su immagine / miniatura). */
  const [sceneImageLightbox, setSceneImageLightbox] = useState(null);
  /** Modale registro attività (log pipeline). */
  const [executionLogModalOpen, setExecutionLogModalOpen] = useState(false);
  /** Modale modifica prompt master (Fase 2). */
  const [masterPromptModalCharId, setMasterPromptModalCharId] = useState(null);
  const [masterPromptDraft, setMasterPromptDraft] = useState("");
  const [masterPromptModalBusy, setMasterPromptModalBusy] = useState(false);
  const fallbackPipelineAbortRef = useRef(false);
  const abortRef = sharedPipelineAbortRef ?? fallbackPipelineAbortRef;
  /** Se true, al prossimo `handleExecute` si riusano i master esistenti (niente createMaster salvo mancanze). */
  const reuseMastersRef = useRef(false);
  /** ALL | NEW_ONLY | BATCH_ALL | SELECTED — cosa elabora `handleExecute`. */
  const sceneExecuteModeRef = useRef("ALL");
  /** Se valorizzato, `SELECTED` usa solo questo id (evita race su setState). */
  const singleSceneOverrideRef = useRef(null);
  const promptTextareaRef = useRef(null);
  /** Snapshot per salvataggio immediato (es. passaggio video). */
  const persistSnapshotRef = useRef(null);
  /** Dedup log debug card personaggio (solo quando URL/sorgenti cambiano). */
  const lastCharCardDebugSigRef = useRef("");
  /** Incrementato ad ogni nuovo save programmato o su cleanup: invalida save async obsoleti (no coda serializzata). */
  const currentSaveIdRef = useRef(0);

  const sceneGenFlightActive =
    scenePipelineFlight != null &&
    scenePipelineFlight.workspaceId === projectId &&
    scenePipelineFlight.chapterId === chapterId;

  const sceneExecuteBlocked = executing || sceneGenFlightActive;

  const showSceneGenProgressBanner =
    sceneGenFlightActive || (executing && scenografiaPhase === "scene_gen");

  const syncPromptTextareaHeight = useCallback(() => {
    const el = promptTextareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const sh = el.scrollHeight;
    const next = Math.min(Math.max(sh, PROMPT_TEXTAREA_MIN_PX), PROMPT_TEXTAREA_MAX_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = sh > PROMPT_TEXTAREA_MAX_PX ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    syncPromptTextareaHeight();
  }, [prompt, syncPromptTextareaHeight]);

  useEffect(() => {
    if (!sceneImageLightbox && !executionLogModalOpen && !masterPromptModalCharId) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setSceneImageLightbox(null);
      setExecutionLogModalOpen(false);
      if (!masterPromptModalBusy) setMasterPromptModalCharId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sceneImageLightbox, executionLogModalOpen, masterPromptModalCharId, masterPromptModalBusy]);

  useEffect(() => {
    let cancelled = false;
    setPersistReady(false);
    void (async () => {
      try {
        const raw = projectId ? await loadScenografiaProjectById(projectId) : null;
        if (cancelled) return;
        if (raw && isWorkspacePayload(raw)) {
          setWorkspaceNarrativeTitle(String(raw.narrativeProjectTitle || "").trim());
          const sortedCh = [...raw.chapters].sort(
            (a, b) => (a.sortOrder - b.sortOrder) || String(a.id).localeCompare(String(b.id))
          );
          setWorkspaceChaptersLight(
            sortedCh.map((c) => ({ id: c.id, sortOrder: c.sortOrder, data: c.data })),
          );
          setWorkspaceFilmVerification(
            raw.filmOutputVerification && typeof raw.filmOutputVerification === "object"
              ? { ...raw.filmOutputVerification }
              : null,
          );
          const cid = chapterId || sortedCh[0]?.id;
          if (sortedCh.length > 1) {
            const sum = summarizeScenografiaWorkspaceForIndex(raw);
            const recoveryId =
              sum.filmPrimaryChapterId != null && String(sum.filmPrimaryChapterId).trim()
                ? String(sum.filmPrimaryChapterId).trim()
                : null;
            const playableId =
              sum.filmPlayableSourceChapterId != null && String(sum.filmPlayableSourceChapterId).trim()
                ? String(sum.filmPlayableSourceChapterId).trim()
                : null;
            const cidStr = cid != null ? String(cid).trim() : "";
            setWorkspaceMontageContext({
              chaptersCount: sortedCh.length,
              filmDeliveryLabel: sum.filmDeliveryState || null,
              hint: sum.multiChapterFilmHint || null,
              thisIsRecoveryTarget: Boolean(recoveryId && cidStr && recoveryId === cidStr),
              thisIsPlayableSource: Boolean(playableId && cidStr && playableId === cidStr),
              recoveryChapterId: recoveryId,
              playableSourceChapterId: playableId,
            });
          } else {
            setWorkspaceMontageContext(null);
          }
          const ch = sortedCh.find((c) => c.id === cid) || sortedCh[0];
          const d = ch?.data;
          if (!d) {
            const b = emptyScenografiaProjectPayload();
            setPrompt(b.prompt || "");
            setProjectTitle(b.scenografiaProjectTitle || "");
            setPlan(null);
            setProjectStyle(null);
            setProjectStyleLocked(false);
            setMasterImages({});
            setMasterByCharName({});
            setProjectCharacterMasters({});
            setSceneResults([]);
            setDeletedSceneIds([]);
            setExecutionLog([]);
            setEnableRepair(!!b.enableRepair);
            setSelectedSceneIds([]);
            setScenografiaPhase("plan");
            setScenografiaVideoPhase("none");
            setFinalMontagePhase("none");
            setFinalMontagePlan({ orderedClipIds: [], orderedTimelineEntryIds: [], narrativeBeatNotes: "" });
            setFinalFilmMontage(emptyFinalFilmMontage());
            setTimelinePlan({ approved: false, approvedAt: null, entries: [] });
            setSceneVideoClips([]);
            setClipBuilderClipId(null);
            setCharacterVoiceMasters({});
            setProjectNarrators([]);
            setCharacterApprovalMap({});
            sceneExecuteModeRef.current = "ALL";
            reuseMastersRef.current = false;
          } else {
            const mergedD = mergeChapterDataWithProjectCharacterPool(d, raw);
            if (typeof d.prompt === "string") setPrompt(d.prompt);
            if (typeof d.scenografiaProjectTitle === "string") setProjectTitle(d.scenografiaProjectTitle);
            else setProjectTitle("");
            if (d.plan) {
              try {
                const planCopy = JSON.parse(JSON.stringify(d.plan));
                const v = validatePlan(planCopy);
                setPlan(v.valid ? planCopy : d.plan);
              } catch {
                setPlan(d.plan);
              }
            } else setPlan(null);
            if (d.projectStyle) setProjectStyle(d.projectStyle);
            else setProjectStyle(null);
            if (typeof d.projectStyleLocked === "boolean") setProjectStyleLocked(d.projectStyleLocked);
            const pcmIn =
              mergedD.projectCharacterMasters && typeof mergedD.projectCharacterMasters === "object"
                ? { ...mergedD.projectCharacterMasters }
                : {};
            setProjectCharacterMasters(pcmIn);
            if (d.plan?.characters?.length) {
              const s = syncDerivedMasterCachesFromCanonical(d.plan, pcmIn, "chapter_load");
              setMasterImages(s.masterImages);
              setMasterByCharName(s.masterByCharName);
              const drift = auditDerivedCacheDrift(d.plan, pcmIn, mergedD.masterImages, mergedD.masterByCharName);
              if (!drift.ok) {
                console.warn(
                  `${CANONICAL_PCM_LOG} load: chapter cache diverged from PCM (expected after merge to be rare)\n${JSON.stringify(drift.issues, null, 2)}`,
                );
              }
            } else {
              if (mergedD.masterImages && typeof mergedD.masterImages === "object") setMasterImages(mergedD.masterImages);
              if (mergedD.masterByCharName && typeof mergedD.masterByCharName === "object") {
                setMasterByCharName(mergedD.masterByCharName);
              }
            }
            if (Array.isArray(d.sceneResults)) {
              const loadLines = (d.sceneResults || []).map((row, i) => {
                if (!row || typeof row !== "object") return `  [${i}] (non oggetto)`;
                const keys = Object.keys(row).sort().join(", ");
                const n = normalizeSceneResultRow(row);
                return `  [${i}] sceneId=${row.sceneId} keys=[${keys}]\n       → thumb dopo normalize: ${shortUrlForSceneLog(resolveSceneThumbnailUrl(n))}`;
              });
              console.log(`[SCENE GENERATE · LOAD chapter da disco → sceneResults]\n${loadLines.join("\n")}`);
              setSceneResults(d.sceneResults.map((r) => normalizeSceneResultRow(r)));
            } else setSceneResults([]);
            if (Array.isArray(d.deletedSceneIds)) setDeletedSceneIds(d.deletedSceneIds);
            else setDeletedSceneIds([]);
            if (Array.isArray(d.executionLog)) setExecutionLog(d.executionLog);
            else setExecutionLog([]);
            if (typeof d.enableRepair === "boolean") setEnableRepair(d.enableRepair);
            if (Array.isArray(d.selectedSceneIds)) setSelectedSceneIds(d.selectedSceneIds);
            if (d.updatedAt) setLastSavedAt(d.updatedAt);
            if (typeof d.scenografiaVideoPhase === "string" && ["none", "production", "completed"].includes(d.scenografiaVideoPhase)) {
              setScenografiaVideoPhase(d.scenografiaVideoPhase);
            } else {
              setScenografiaVideoPhase("none");
            }
            if (typeof d.finalMontagePhase === "string" && ["none", "assembly", "done"].includes(d.finalMontagePhase)) {
              setFinalMontagePhase(d.finalMontagePhase);
            } else {
              setFinalMontagePhase("none");
            }
            if (d.finalMontagePlan && typeof d.finalMontagePlan === "object") {
              setFinalMontagePlan({
                orderedClipIds: Array.isArray(d.finalMontagePlan.orderedClipIds) ? d.finalMontagePlan.orderedClipIds : [],
                orderedTimelineEntryIds: Array.isArray(d.finalMontagePlan.orderedTimelineEntryIds)
                  ? d.finalMontagePlan.orderedTimelineEntryIds
                  : [],
                narrativeBeatNotes:
                  typeof d.finalMontagePlan.narrativeBeatNotes === "string" ? d.finalMontagePlan.narrativeBeatNotes : "",
                titleCardIntro: d.finalMontagePlan.titleCardIntro === true,
                endCredits: d.finalMontagePlan.endCredits === true,
              });
            } else {
              setFinalMontagePlan({
                orderedClipIds: [],
                orderedTimelineEntryIds: [],
                narrativeBeatNotes: "",
                titleCardIntro: false,
                endCredits: false,
              });
            }
            if (d.finalFilmMontage && typeof d.finalFilmMontage === "object") {
              setFinalFilmMontage(normalizeFinalFilmMontage(d.finalFilmMontage));
            } else {
              setFinalFilmMontage(emptyFinalFilmMontage());
            }
            if (d.timelinePlan && typeof d.timelinePlan === "object") {
              setTimelinePlan(normalizeTimelinePlan(d.timelinePlan));
            } else {
              setTimelinePlan({ approved: false, approvedAt: null, entries: [] });
            }
            if (Array.isArray(d.sceneVideoClips)) {
              setSceneVideoClips(d.sceneVideoClips.map((c) => normalizeSceneVideoClip(c)).filter(Boolean));
            } else {
              setSceneVideoClips([]);
            }
            if (d.characterVoiceMasters && typeof d.characterVoiceMasters === "object") {
              setCharacterVoiceMasters({ ...d.characterVoiceMasters });
            } else {
              setCharacterVoiceMasters({});
            }
            if (Array.isArray(d.projectNarrators)) {
              setProjectNarrators(ensureProjectNarratorDefaultFlags(normalizeProjectNarratorsList(d.projectNarrators)));
            } else {
              setProjectNarrators([]);
            }
            if (d.runtimeHints && typeof d.runtimeHints === "object") {
              if (typeof d.runtimeHints.sceneExecuteMode === "string") {
                sceneExecuteModeRef.current = d.runtimeHints.sceneExecuteMode;
              }
              if (typeof d.runtimeHints.reuseMastersNext === "boolean") {
                reuseMastersRef.current = d.runtimeHints.reuseMastersNext;
              }
            }
            const phases = ["plan", "character_gen", "character_approval", "scene_gen", "complete"];
            let phase =
              typeof d.scenografiaPhase === "string" && phases.includes(d.scenografiaPhase)
                ? d.scenografiaPhase
                : null;
            if (phase === "character_gen") phase = "character_approval";
            let approvals =
              mergedD.characterApprovalMap && typeof mergedD.characterApprovalMap === "object"
                ? { ...mergedD.characterApprovalMap }
                : {};
            if (d.plan && Object.keys(approvals).length === 0) {
              const needMaster = getCharactersNeedingMaster(d.plan);
              const pcmCheck = mergedD.projectCharacterMasters && typeof mergedD.projectCharacterMasters === "object" ? mergedD.projectCharacterMasters : {};
              const hasScenes = Array.isArray(d.sceneResults) && d.sceneResults.length > 0;
              const allMastered =
                needMaster.length === 0 || needMaster.every((c) => !!getDisplayMasterUrl(c, pcmCheck));
              if (!phase) {
                if (hasScenes && allMastered) phase = "complete";
                else if (allMastered) phase = "character_approval";
                else phase = "plan";
              }
              if (allMastered) {
                needMaster.forEach((c) => {
                  const u = getDisplayMasterUrl(c, pcmCheck);
                  if (u && !approvals[c.id]) {
                    approvals[c.id] = hasScenes
                      ? { approved: true, approvedAt: d.updatedAt || new Date().toISOString(), version: 1 }
                      : { approved: false, approvedAt: null, version: 1 };
                  }
                });
              }
            }
            if (phase) setScenografiaPhase(phase);
            setCharacterApprovalMap(approvals);
          }
        } else {
          setWorkspaceNarrativeTitle("");
          setWorkspaceMontageContext(null);
          setWorkspaceChaptersLight([]);
          setWorkspaceFilmVerification(null);
          const b = emptyScenografiaProjectPayload();
          setPrompt(b.prompt || "");
          setProjectTitle(b.scenografiaProjectTitle || "");
          setPlan(null);
          setProjectStyle(null);
          setProjectStyleLocked(false);
          setMasterImages({});
          setMasterByCharName({});
          setProjectCharacterMasters({});
          setSceneResults([]);
          setDeletedSceneIds([]);
          setExecutionLog([]);
          setEnableRepair(!!b.enableRepair);
          setSelectedSceneIds([]);
          setScenografiaPhase("plan");
          setScenografiaVideoPhase("none");
          setFinalMontagePhase("none");
          setFinalMontagePlan({ orderedClipIds: [], orderedTimelineEntryIds: [], narrativeBeatNotes: "" });
          setFinalFilmMontage(emptyFinalFilmMontage());
          setTimelinePlan({ approved: false, approvedAt: null, entries: [] });
          setSceneVideoClips([]);
          setClipBuilderClipId(null);
          setCharacterVoiceMasters({});
          setProjectNarrators([]);
          setCharacterApprovalMap({});
          sceneExecuteModeRef.current = "ALL";
          reuseMastersRef.current = false;
        }
      } finally {
        if (!cancelled) {
          setTimeout(() => {
            if (!cancelled) setPersistReady(true);
          }, 0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, chapterId]);

  useEffect(() => {
    if (!persistReady || !plan?.characters?.length) return;
    const rows = getCharactersNeedingMaster(plan).map((char) => {
      const nk = normCharName(char.name);
      const sk = stableCharacterKey(char);
      const row = pcmRowForCharacter(projectCharacterMasters, char);
      const canonicalUrl = row?.masterImageUrl ? String(row.masterImageUrl).trim() : null;
      const byStable = sk && masterImages[sk] ? String(masterImages[sk]).trim() : null;
      const byId = masterImages[char.id] ? String(masterImages[char.id]).trim() : null;
      const byName = nk && masterByCharName[nk] ? String(masterByCharName[nk]).trim() : null;
      const cacheMatchesCanonical =
        !!canonicalUrl &&
        (byStable === canonicalUrl || byId === canonicalUrl) &&
        (!byName || byName === canonicalUrl || isPcidKey(byName));
      let sharesCanonicalUrlWith = null;
      if (canonicalUrl) {
        for (const c of plan.characters) {
          if (c.id === char.id) continue;
          const ou = pcmRowForCharacter(projectCharacterMasters, c)?.masterImageUrl
            ? String(pcmRowForCharacter(projectCharacterMasters, c).masterImageUrl).trim()
            : null;
          if (ou && ou === canonicalUrl) {
            sharesCanonicalUrlWith = c.name;
            break;
          }
        }
      }
      return {
        characterId: char.id,
        stableKey: sk,
        characterName: char.name,
        canonicalUrl,
        canonicalSource: row?.source || null,
        pendingManualReview: row?.pendingManualReview === true,
        derived_masterImagesUrl: byStable || byId,
        derived_masterByCharNameUrl: byName,
        cacheMatchesCanonical,
        duplicateCanonicalUrlAs: sharesCanonicalUrlWith,
        characterApprovalApproved: approvalEntryForCharacter(characterApprovalMap, char)?.approved === true,
      };
    });
    const sig = rows.map((x) => `${x.characterId}|${x.canonicalUrl || ""}|${x.pendingManualReview}|${x.duplicateCanonicalUrlAs || ""}`).join(";");
    if (sig === lastCharCardDebugSigRef.current) return;
    lastCharCardDebugSigRef.current = sig;
    console.log(`[SCENOGRAFIE UI CHARACTER CARD DEBUG]\n${JSON.stringify(rows, null, 2)}`);
  }, [persistReady, plan, projectCharacterMasters, masterImages, masterByCharName, characterApprovalMap]);

  const buildCurrentChapterPayload = useCallback(
    (overrides = {}) => ({
      prompt,
      scenografiaProjectTitle: projectTitle,
      plan,
      projectStyle,
      projectStyleLocked,
      masterImages,
      masterByCharName,
      projectCharacterMasters,
      sceneResults,
      executionLog,
      enableRepair,
      selectedSceneIds,
      deletedSceneIds,
      scenografiaPhase,
      characterApprovalMap,
      scenografiaVideoPhase,
      sceneVideoClips,
      characterVoiceMasters,
      projectNarrators,
      finalMontagePhase,
      finalMontagePlan,
      finalFilmMontage,
      timelinePlan,
      runtimeHints: {
        sceneExecuteMode: sceneExecuteModeRef.current,
        reuseMastersNext: reuseMastersRef.current,
      },
      ...overrides,
    }),
    [
      prompt,
      projectTitle,
      plan,
      projectStyle,
      projectStyleLocked,
      masterImages,
      masterByCharName,
      projectCharacterMasters,
      sceneResults,
      executionLog,
      enableRepair,
      selectedSceneIds,
      deletedSceneIds,
      scenografiaPhase,
      characterApprovalMap,
      scenografiaVideoPhase,
      sceneVideoClips,
      characterVoiceMasters,
      projectNarrators,
      finalMontagePhase,
      finalMontagePlan,
      finalFilmMontage,
      timelinePlan,
    ],
  );

  useEffect(() => {
    if (!persistReady || !projectId || !chapterId) return;
    const t = setTimeout(() => {
      void (async () => {
        currentSaveIdRef.current += 1;
        const mySaveId = currentSaveIdRef.current;
        const payload = buildCurrentChapterPayload();
        const sceneRows = Array.isArray(payload.sceneResults) ? payload.sceneResults : [];
        const sceneIds = sceneRows.map((r) => r?.sceneId);
        const sceneUrlPreview = sceneRows.map((r) => ({
          sceneId: r?.sceneId,
          imageUrl: r?.imageUrl != null ? String(r.imageUrl).slice(0, 60) : "",
        }));
        const logPersist = (esito, wasStale) => {
          console.log(
            [
              "[SCENE SAVE · PERSIST]",
              `  esito: ${esito}`,
              `  mySaveId: ${mySaveId}`,
              `  currentSaveIdRef: ${currentSaveIdRef.current}`,
              `  wasStale: ${wasStale}`,
              `  projectId: ${projectId}`,
              `  chapterId: ${chapterId}`,
              `  sceneIds: ${JSON.stringify(sceneIds)}`,
              `  sceneUrlPreview: ${JSON.stringify(sceneUrlPreview)}`,
            ].join("\n"),
          );
        };
        const raw = await loadScenografiaProjectById(projectId);
        if (mySaveId !== currentSaveIdRef.current) {
          logPersist("SKIPPED_STALE", true);
          return;
        }
        if (!raw || !isWorkspacePayload(raw)) {
          logPersist("LOAD_FAILED", false);
          return;
        }
        const merged = upsertChapterDataInWorkspace(raw, chapterId, payload);
        const ok = await saveScenografiaProjectById(projectId, merged);
        const wasStaleAfterSave = mySaveId !== currentSaveIdRef.current;
        if (!ok) {
          logPersist("SAVE_FAILED", wasStaleAfterSave);
          return;
        }
        await upsertScenografiaProjectInIndex(projectId, merged);
        setLastSavedAt(new Date().toISOString());
        logPersist("WROTE", wasStaleAfterSave);
      })();
    }, 400);
    return () => {
      clearTimeout(t);
      currentSaveIdRef.current += 1;
    };
  }, [
    persistReady,
    projectId,
    chapterId,
    prompt,
    projectTitle,
    plan,
    projectStyle,
    projectStyleLocked,
    masterImages,
    masterByCharName,
    projectCharacterMasters,
    sceneResults,
    executionLog,
    enableRepair,
    selectedSceneIds,
    deletedSceneIds,
    scenografiaPhase,
    characterApprovalMap,
    scenografiaVideoPhase,
    sceneVideoClips,
    characterVoiceMasters,
    projectNarrators,
    finalMontagePhase,
    finalMontagePlan,
    finalFilmMontage,
    timelinePlan,
    buildCurrentChapterPayload,
  ]);

  useEffect(() => {
    persistSnapshotRef.current = {
      prompt,
      scenografiaProjectTitle: projectTitle,
      plan,
      projectStyle,
      projectStyleLocked,
      masterImages,
      masterByCharName,
      projectCharacterMasters,
      sceneResults,
      executionLog,
      enableRepair,
      selectedSceneIds,
      deletedSceneIds,
      scenografiaPhase,
      characterApprovalMap,
      scenografiaVideoPhase,
      sceneVideoClips,
      characterVoiceMasters,
      projectNarrators,
      finalMontagePhase,
      finalMontagePlan,
      finalFilmMontage,
      timelinePlan,
      runtimeHints: {
        sceneExecuteMode: sceneExecuteModeRef.current,
        reuseMastersNext: reuseMastersRef.current,
      },
    };
  }, [
    prompt,
    projectTitle,
    plan,
    projectStyle,
    projectStyleLocked,
    masterImages,
    masterByCharName,
    projectCharacterMasters,
    sceneResults,
    executionLog,
    enableRepair,
    selectedSceneIds,
    deletedSceneIds,
    scenografiaPhase,
    characterApprovalMap,
    scenografiaVideoPhase,
    sceneVideoClips,
    characterVoiceMasters,
    projectNarrators,
    finalMontagePhase,
    finalMontagePlan,
    finalFilmMontage,
    timelinePlan,
  ]);

  const persistChapterPayload = useCallback(
    async (payload) => {
      if (!projectId || !chapterId) return false;
      const raw = await loadScenografiaProjectById(projectId);
      if (!raw || !isWorkspacePayload(raw)) return false;
      const merged = upsertChapterDataInWorkspace(raw, chapterId, payload);
      const ok = await saveScenografiaProjectById(projectId, merged);
      if (ok) {
        await upsertScenografiaProjectInIndex(projectId, merged);
        setLastSavedAt(new Date().toISOString());
      }
      return ok;
    },
    [projectId, chapterId]
  );

  useEffect(() => {
    if (!plan?.scenes) return;
    const ids = new Set(plan.scenes.map((s) => s.id));
    setSelectedSceneIds((prev) => prev.filter((id) => ids.has(id)));
    setDeletedSceneIds((prev) => prev.filter((id) => ids.has(id)));
  }, [plan]);

  const addLog = useCallback((msg) => {
    setExecutionLog((prev) => [...prev, { time: new Date().toLocaleTimeString(), msg }]);
  }, []);

  /** Aggiorna PCM e risincronizza le sole cache derivate (masterImages / masterByCharName). */
  const commitProjectCharacterMastersSync = useCallback(
    (nextPcm, reason = "editor") => {
      setProjectCharacterMasters(nextPcm);
      if (plan?.characters?.length) {
        const sync = syncDerivedMasterCachesFromCanonical(plan, nextPcm, reason);
        setMasterImages(sync.masterImages);
        setMasterByCharName(sync.masterByCharName);
        const audit = auditDerivedCacheDrift(plan, nextPcm, sync.masterImages, sync.masterByCharName);
        if (!audit.ok) {
          console.warn(`${CANONICAL_PCM_LOG} post_sync_audit unexpected drift (should be clean)`);
        }
      }
    },
    [plan],
  );

  /** Solo piano e scene: i master restano in memoria per il prossimo analizza / genera. */
  const resetPlanKeepMasters = useCallback(() => {
    setPlan(null);
    setProjectStyle(null);
    setProjectStyleLocked(false);
    setSceneResults([]);
    setExecutionLog([]);
    setPlanError("");
    setSelectedSceneIds([]);
    reuseMastersRef.current = false;
    sceneExecuteModeRef.current = "ALL";
    setScenografiaPhase("plan");
    setCharacterApprovalMap({});
    setRegeneratingCharId(null);
    setDeletedSceneIds([]);
    setSceneCardFocusId(null);
    setModifyingSceneId(null);
    setModifyDraftPrompt("");
    setSceneEditBusyId(null);
    setProjectCharacterMasters((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], approved: false };
      }
      return next;
    });
  }, []);

  const openNewProjectConfirm = useCallback(() => {
    setNewProjectConfirmOpen(true);
  }, []);

  const cancelNewProjectConfirm = useCallback(() => {
    setNewProjectConfirmOpen(false);
  }, []);

  const confirmNewProjectReset = useCallback(() => {
    setNewProjectConfirmOpen(false);
    void (async () => {
      await deleteScenografiaProjectById(projectId);
      onBack?.();
    })();
  }, [projectId, onBack]);

  useEffect(() => {
    if (!newProjectConfirmOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") cancelNewProjectConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newProjectConfirmOpen, cancelNewProjectConfirm]);

  /** Estende il piano (nuove scene / sviluppi) senza perdere master né scene già ok. */
  const handlePlanContinue = async () => {
    if (!plan || !prompt.trim()) return;
    const previousPlan = plan;
    setPlanning(true);
    setPlanError("");
    reuseMastersRef.current = false;
    sceneExecuteModeRef.current = "ALL";

    try {
      const result = await planScenografiaContinue(plan, prompt.trim());
      if (!result) {
        setPlanError("Impossibile aggiornare il piano. Riprova.");
        return;
      }
      const validation = validatePlan(result);
      if (!validation.valid) {
        setPlanError(validation.error);
        return;
      }
      const validIds = new Set((result.scenes || []).map((s) => s.id));
      setDeletedSceneIds((prev) => prev.filter((id) => validIds.has(id)));
      setSceneResults((prev) => prev.filter((r) => validIds.has(r.sceneId)));
      setPlan(result);
      if (!projectStyleLocked) {
        setProjectStyle(buildProjectStyleFromPlan(result, imageStylePresets));
      }
      {
        const pcmRef = projectCharacterMastersRef.current;
        const hintPlan = previousPlan?.characters?.length ? previousPlan : result;
        const hints = syncDerivedMasterCachesFromCanonical(hintPlan, pcmRef, "plan_continue_hint_from_pcm");
        const r = reconcileCharacterMasterMaps(result, hints.masterImages, hints.masterByCharName, pcmRef, {});
        let nextApprovals = { ...characterApprovalMap };
        (result.characters || []).forEach((c) => {
          if (nextApprovals[c.id] == null) nextApprovals[c.id] = { approved: false, approvedAt: null, version: 0 };
        });
        Object.keys(nextApprovals).forEach((k) => {
          if (!(result.characters || []).some((x) => x.id === k)) delete nextApprovals[k];
        });
        const forcePcid =
          inferPcidMasterLayout(result, r.masterImages, r.masterByCharName) ||
          (result.characters || []).some((c) => isPcidKey(c?.pcid));
        const pcmNext = mergeProjectCharacterMastersFromLegacy(
          result,
          pcmRef,
          r.masterImages,
          r.masterByCharName,
          nextApprovals,
          { forcePcidMode: forcePcid },
        );
        const sync = syncDerivedMasterCachesFromCanonical(result, pcmNext, "plan_continue_after_merge");
        setMasterImages(sync.masterImages);
        setMasterByCharName(sync.masterByCharName);
        setProjectCharacterMasters(pcmNext);
        setCharacterApprovalMap(nextApprovals);
      }
      setScenografiaPhase("plan");
    } catch (err) {
      setPlanError(err.message || "Errore durante l'estensione del piano");
    } finally {
      setPlanning(false);
    }
  };

  const handlePlan = async (preserveMasters = false) => {
    if (!prompt.trim()) return;
    const planSnapshot = plan;
    setPlanning(true);
    setPlanError("");
    setPlan(null);
    setExecutionLog([]);
    setSceneResults([]);
    setSelectedSceneIds([]);
    setDeletedSceneIds([]);
    setScenografiaPhase("plan");
    if (!preserveMasters) {
      setProjectStyle(null);
      setProjectStyleLocked(false);
      setMasterImages({});
      setMasterByCharName({});
      setProjectCharacterMasters({});
      setCharacterApprovalMap({});
    } else {
      setProjectStyleLocked(false);
    }
    reuseMastersRef.current = false;

    try {
      const result = await planScenografia(prompt.trim());
      if (!result) {
        setPlanError("Impossibile analizzare il prompt. Riprova con più dettagli.");
        return;
      }
      const validation = validatePlan(result);
      if (!validation.valid) {
        setPlanError(validation.error);
        return;
      }
      setPlan(result);
      setProjectStyle(buildProjectStyleFromPlan(result, imageStylePresets));
      if (preserveMasters) {
        const pcmRef = projectCharacterMastersRef.current;
        const hintPlan = planSnapshot?.characters?.length ? planSnapshot : result;
        const hints = syncDerivedMasterCachesFromCanonical(hintPlan, pcmRef, "plan_new_hint_from_pcm");
        const r = reconcileCharacterMasterMaps(result, hints.masterImages, hints.masterByCharName, pcmRef, {});
        let nextApprovals = { ...characterApprovalMap };
        (result.characters || []).forEach((c) => {
          if (nextApprovals[c.id] == null) nextApprovals[c.id] = { approved: false, approvedAt: null, version: 0 };
        });
        Object.keys(nextApprovals).forEach((k) => {
          if (!(result.characters || []).some((x) => x.id === k)) delete nextApprovals[k];
        });
        const forcePcid =
          inferPcidMasterLayout(result, r.masterImages, r.masterByCharName) ||
          (result.characters || []).some((c) => isPcidKey(c?.pcid));
        const pcmNext = mergeProjectCharacterMastersFromLegacy(
          result,
          pcmRef,
          r.masterImages,
          r.masterByCharName,
          nextApprovals,
          { forcePcidMode: forcePcid },
        );
        const sync = syncDerivedMasterCachesFromCanonical(result, pcmNext, "plan_new_after_merge");
        setMasterImages(sync.masterImages);
        setMasterByCharName(sync.masterByCharName);
        setProjectCharacterMasters(pcmNext);
        setCharacterApprovalMap(nextApprovals);
      }
    } catch (err) {
      setPlanError(err.message || "Errore durante l'analisi");
    } finally {
      setPlanning(false);
    }
  };

  const handleExecute = async () => {
    if (!plan) return;
    if (sceneExecuteBlocked) return;
    const charsNeedingMaster = getCharactersNeedingMaster(plan);
    const masterPipelineRequired = charsNeedingMaster.length > 0;
    const masterGatePayload = { projectCharacterMasters, characterApprovalMap };
    const notReadyMasters = masterPipelineRequired
      ? charsNeedingMaster.filter((c) => !characterMasterReadyForScenes(c, masterGatePayload))
      : [];
    if (notReadyMasters.length > 0) {
      const noUrl = notReadyMasters.filter((c) => !charHasResolvedMaster(c, projectCharacterMasters));
      if (noUrl.length) {
        setPlanError(
          `Genera il master per: ${noUrl.map((c) => c.name).join(", ")} (pulsante sulla card o «Genera master personaggi»).`
        );
        return;
      }
      const needApprove = notReadyMasters.filter(
        (c) => !approvalEntryForCharacter(characterApprovalMap, c)?.approved,
      );
      if (needApprove.length) {
        setPlanError(
          `Approva con «Approva personaggio» sulla card: ${needApprove.map((c) => c.name).join(", ")} (stesso gate usato da identity lock).`
        );
        return;
      }
      setPlanError(
        `Personaggi non ammessi in pipeline scene (revisione manuale o sorgente master non valida): ${notReadyMasters.map((c) => c.name).join(", ")}. Controlla la card (bordo arancione) o i log ${CANONICAL_PCM_LOG}.`
      );
      return;
    }

    const lockedStyle =
      projectStyle || buildProjectStyleFromPlan(plan, imageStylePresets);
    const globalStyleNote = composeGlobalVisualStyle(lockedStyle).slice(0, 900);

    const hadScenesBefore = sceneResults.length > 0;
    const explicitReuseMasters = reuseMastersRef.current;
    reuseMastersRef.current = false;

    const exMode = sceneExecuteModeRef.current;
    sceneExecuteModeRef.current = "ALL";

    let regenSingleSceneId = null;
    let selectedRemovalIds = null;
    if (exMode === "SELECTED") {
      regenSingleSceneId = singleSceneOverrideRef.current || null;
      const override = singleSceneOverrideRef.current;
      selectedRemovalIds = override ? [override] : [...selectedSceneIds];
      if (override) singleSceneOverrideRef.current = null;
    }

    const existingById = Object.fromEntries(sceneResults.map((r) => [r.sceneId, r]));
    const del = new Set(deletedSceneIds || []);
    let scenesToRun = (plan.scenes || []).filter((s) => !del.has(s.id));
    if (exMode === "NEW_ONLY") {
      scenesToRun = scenesToRun.filter((s) => !existingById[s.id]);
    } else if (exMode === "BATCH_ALL") {
      scenesToRun = scenesToRun.filter((s) => {
        const r = existingById[s.id];
        return !r || !r.imageUrl;
      });
    } else if (exMode === "SELECTED") {
      const sel = new Set(selectedRemovalIds || []);
      scenesToRun = (plan.scenes || []).filter((s) => sel.has(s.id));
      if (!regenSingleSceneId) {
        scenesToRun = scenesToRun.filter((s) => {
          const r = existingById[s.id];
          return !r || !r.imageUrl;
        });
      }
    }

    if (scenesToRun.length === 0) {
      if (exMode === "BATCH_ALL") {
        setPlanError(
          "Tutte le scene del piano hanno già un'immagine. Per rifarne una usa «Rigenera» sulla card della scena."
        );
      } else if (exMode === "SELECTED" && !regenSingleSceneId && (selectedRemovalIds?.length ?? 0) > 0) {
        setPlanError(
          "Nessuna delle scene selezionate è senza immagine. Per rifare una scena già generata usa «Rigenera» sulla card."
        );
      } else {
        setPlanError("Nessuna scena da elaborare: controlla il piano o la selezione.");
      }
      return;
    }

    const partialRun = exMode !== "ALL";

    setProjectStyle(lockedStyle);
    setScenografiaPhase("scene_gen");
    setExecuting(true);
    setScenePipelineFlight?.({ workspaceId: projectId, chapterId });
    abortRef.current = false;
    setPlanError("");

    const stamp = new Date().toLocaleTimeString();
    if (exMode === "ALL") {
      setExecutionLog([]);
    } else {
      const modeLabel =
        exMode === "NEW_ONLY"
          ? "solo scene mancanti"
          : exMode === "BATCH_ALL"
            ? "genera tutte le scene mancanti"
            : regenSingleSceneId
              ? "rigenera scena singola"
              : "genera scene selezionate (senza immagine)";
      setExecutionLog((prev) => [...prev, { time: stamp, msg: `── Modalità: ${modeLabel} ──` }]);
    }

    if (exMode === "ALL") {
      setSceneResults([]);
    } else if (exMode === "SELECTED") {
      const rm = new Set(regenSingleSceneId ? selectedRemovalIds || [] : scenesToRun.map((s) => s.id));
      setSceneResults((prev) => prev.filter((r) => !rm.has(r.sceneId)));
    } else if (exMode === "BATCH_ALL") {
      const rm = new Set(scenesToRun.map((s) => s.id));
      setSceneResults((prev) => prev.filter((r) => !rm.has(r.sceneId)));
    }

    let workingSceneResults;
    if (exMode === "ALL") {
      workingSceneResults = [];
    } else if (exMode === "SELECTED") {
      const rm = new Set(regenSingleSceneId ? selectedRemovalIds || [] : scenesToRun.map((s) => s.id));
      workingSceneResults = sceneResults.filter((r) => !rm.has(r.sceneId));
    } else if (exMode === "BATCH_ALL") {
      const rm = new Set(scenesToRun.map((s) => s.id));
      workingSceneResults = sceneResults.filter((r) => !rm.has(r.sceneId));
    } else {
      workingSceneResults = sceneResults.slice();
    }

    try {
      const animated = lockedStyle.isAnimated;

      const pcmSnap = projectCharacterMastersRef.current;
      const sync = syncDerivedMasterCachesFromCanonical(plan, pcmSnap, "scene_pipeline_preflight");
      setMasterImages(sync.masterImages);
      setMasterByCharName(sync.masterByCharName);

      const masters = buildApprovedMasterUrlMap(plan, pcmSnap, characterApprovalMap);

      const traceCast = (plan.characters || []).filter((c) => isMariaGiuseppeTraceName(c.name));
      if (traceCast.length) {
        const traceRows = traceCast.map((c) =>
          buildMasterPipelineTraceRow(c, pcmSnap, sync.masterImages, sync.masterByCharName, characterApprovalMap, masters),
        );
        console.log(`[SCENOGRAFIE MASTER SOURCE TRACE · cast]\n${JSON.stringify(traceRows, null, 2)}`);
      }

      if (partialRun || explicitReuseMasters || hadScenesBefore) {
        addLog(
          partialRun
            ? `Scene (${scenesToRun.length}): solo master già approvati.`
            : explicitReuseMasters || hadScenesBefore
              ? "Rigenerazione scene con master approvati."
              : "Generazione scene."
        );
      }

      // ── Scene pipeline (master già approvati) ──
      const results = [];
      const totalRun = scenesToRun.length;
      const bumpSceneProgress = (sceneIdx, sub01) => {
        const t = Math.max(0, Math.min(1, sub01));
        const tr = Math.max(1, totalRun);
        const low = 20 + (sceneIdx / tr) * 60;
        const high = sceneIdx + 1 >= tr ? 94 : 20 + ((sceneIdx + 1) / tr) * 60;
        setImageProgress(Math.round(low + (high - low) * t));
      };
      if (plan?.characters?.length) {
        const poolRows = plan.characters.map((c) => {
          const meta = masterUrlMetaForLog(c, pcmSnap, sync.masterImages, sync.masterByCharName, characterApprovalMap);
          return {
            characterId: c.id,
            stableKey: meta.stableKey || stableCharacterKey(c),
            name: c.name,
            approved: meta.approved,
            masterImageUrl: meta.url,
            masterSource: meta.source,
            hadMasterImagesKey: meta.hadMasterImagesKey,
            hadMasterByCharNameKey: meta.hadMasterByCharNameKey,
          };
        });
        console.log(`[SCENOGRAFIE PROJECT CHARACTER POOL]\n${JSON.stringify(poolRows, null, 2)}`);
        addLog(`[pool] ${poolRows.length} personaggi — JSON completo in console: [SCENOGRAFIE PROJECT CHARACTER POOL]`);
      }
      for (let i = 0; i < totalRun; i++) {
        if (abortRef.current) break;
        const scene = scenesToRun[i];
        bumpSceneProgress(i, 0);

        addLog(`Scena ${i + 1}/${totalRun}: ${scene.title_it}…`);
        setImageStatus(`Scena: ${scene.title_it}`);

        try {
          const pipelineWarnings = [];
          const isEnvScene = isEnvironmentScene(scene);
          const sceneTypeRaw = normalizeSceneType(scene);
          const charResolution = resolveSceneCharacterIdsForPipeline(scene, plan);
          const sceneCharIds = isEnvScene ? [] : charResolution.ids;
          const protagonistId = sceneCharIds[0];
          const protagonistChar = protagonistId ? findPlanCharacterByPresentRef(plan, protagonistId) : null;

          const numSubjects = isEnvScene ? 0 : sceneCharIds.length > 1 ? sceneCharIds.length : 1;

          const supportingChars = isEnvScene
            ? ""
            : plan.characters
                .filter((c) => {
                  const sk = stableCharacterKey(c);
                  return sceneCharIds.includes(sk) && sk !== protagonistId;
                })
                .map((c) => c.appearance_prompt || c.name)
                .join(". ");

          const sceneProtagonistIds = isEnvScene ? [] : sceneCharIds.filter((id) => masters[id]);
          const missingMasterForLock = isEnvScene ? [] : sceneCharIds.filter((id) => !masters[id]);
          const lockNames = sceneProtagonistIds.map((id) => planCharacterDisplayName(plan, id)).join(" → ");
          const missingNames = missingMasterForLock.map((id) => planCharacterDisplayName(plan, id)).join(", ");

          const invalidPresentIds = collectInvalidPresentIds(scene, plan);
          if (invalidPresentIds.length) {
            const w = `characters_present contiene id assenti dal piano: ${invalidPresentIds.join(", ")}`;
            pipelineWarnings.push(w);
            addLog(`⚠ ${w}`);
          }

          const semanticWarnings = !isEnvScene ? diagnoseTitleResolvedMismatch(scene, plan, sceneCharIds) : [];
          semanticWarnings.forEach((w) => {
            pipelineWarnings.push(w);
            addLog(`⚠ ${w}`);
          });

          const charactersResolvedRows = sceneCharIds.map((id) => {
            const c = findPlanCharacterByPresentRef(plan, id);
            const meta = c ? masterUrlMetaForLog(c, pcmSnap, sync.masterImages, sync.masterByCharName, characterApprovalMap) : null;
            return {
              id,
              name: c?.name ?? "(sconosciuto)",
              masterForLockUrl_full: masters[id] || null,
              masterForLockUrl_preview: masters[id] ? shortUrl(masters[id], 120) : null,
              approved: meta?.approved ?? false,
              masterResolveSource: meta?.source ?? "none",
              hasApprovedMasterInLockMap: !!masters[id],
            };
          });

          const mentionedChars = !isEnvScene ? charactersMentionedInSceneText(scene, plan) : [];
          const expectedCharacterName = mentionedChars[0]?.name ?? null;
          const firstLockId = sceneProtagonistIds[0] || null;
          const firstLockChar = firstLockId ? findPlanCharacterByPresentRef(plan, firstLockId) : null;
          const resolvedMasterCharacterName = firstLockChar?.name ?? null;
          const firstLockMasterUrl = firstLockId ? masters[firstLockId] || null : null;
          if (
            expectedCharacterName &&
            resolvedMasterCharacterName &&
            normCharName(expectedCharacterName) !== normCharName(resolvedMasterCharacterName)
          ) {
            const mismatchPayload = {
              scene_id: scene.id,
              title_it: scene.title_it,
              summary_it: scene.summary_it,
              expectedCharacterName,
              resolvedMasterCharacterName,
              first_lock_character_id: firstLockId,
              first_lock_master_url: firstLockMasterUrl,
              characters_present_raw: scene.characters_present,
              resolved_ids: sceneCharIds,
            };
            console.error(`[SCENOGRAFIE ⚠ MISMATCH titolo vs master primo lock]\n${JSON.stringify(mismatchPayload, null, 2)}`);
            addLog(
              `⚠ MISMATCH: testo suggerisce «${expectedCharacterName}» ma primo lock usa master di «${resolvedMasterCharacterName}» (vedi console)`,
            );
            pipelineWarnings.push("title_vs_first_lock_master_mismatch");
          }

          const identityLog = {
            scene_id: scene.id,
            title_it: scene.title_it,
            scene_type: sceneTypeRaw,
            is_environment: isEnvScene,
            summary_it: scene.summary_it,
            characters_present_raw: scene.characters_present,
            invalid_present_ids: invalidPresentIds,
            resolution_source: charResolution.source,
            resolved_character_ids: sceneCharIds,
            resolved_characters: charactersResolvedRows,
            characters_mentioned_in_scene_text: mentionedChars.map((c) => ({
              id: c.id,
              stableKey: stableCharacterKey(c),
              name: c.name,
            })),
            expectedCharacterName,
            resolvedMasterCharacterName,
            first_lock_master_url: firstLockMasterUrl,
            identity_lock_order_ids: sceneProtagonistIds,
            identity_lock_order_names: lockNames,
            missing_approved_master_for_scene_ids: missingMasterForLock,
            missing_approved_master_names: missingNames || null,
            semantic_warnings: semanticWarnings,
          };
          console.log(`[SCENOGRAFIE PIPELINE · identità scena]\n${JSON.stringify(identityLog, null, 2)}`);
          addLog(
            `[diag] ${scene.title_it || scene.id} | type=${sceneTypeRaw} | ids=[${sceneCharIds.join(",")}] (${charResolution.source}) | lock→ ${lockNames || "—"} | atteso="${expectedCharacterName || "—"}" lock1="${resolvedMasterCharacterName || "—"}"${missingNames ? ` | ⚠no master: ${missingNames}` : ""}`,
          );

          if (!isEnvScene && sceneCharIds.length === 0) {
            addLog(`ERRORE: scena «${scene.title_it || scene.id}» senza personaggi risolti nel piano — skip.`);
            bumpSceneProgress(i, 1);
            continue;
          }

          const appearancePayload = isEnvScene
            ? { detailedDescription: "" }
            : { detailedDescription: protagonistChar?.appearance_prompt || "" };
          const outfitStr = isEnvScene ? "" : scene.outfit_override || protagonistChar?.appearance?.outfit || "";

          const sceneResult = await generateSceneBase({
            sceneDescription: scene.description,
            appearance: appearancePayload,
            outfit: outfitStr,
            environment: scene.environment || "",
            lighting: scene.lighting || "",
            palette: scene.mood || "",
            visualStyle: lockedStyle.plannerVisualNotes || "",
            stylePrefixes: [lockedStyle.stylePrompt],
            negativePrompt: lockedStyle.negativePrompt || undefined,
            numSubjects,
            supportingCharacters: supportingChars ? supportingChars : undefined,
            aspectRatio: "16:9",
          });

          const basePromptEcho = buildScenePrompt({
            sceneDescription: scene.description,
            appearance: appearancePayload,
            outfit: outfitStr,
            environment: scene.environment || "",
            lighting: scene.lighting || "",
            palette: scene.mood || "",
            visualStyle: lockedStyle.plannerVisualNotes || "",
            stylePrefixes: [lockedStyle.stylePrompt],
            numSubjects,
            supportingCharacters: supportingChars ? supportingChars : undefined,
          });
          const basePromptFinal = sceneResult.prompt || basePromptEcho;

          const baseLog = {
            scene_id: scene.id,
            title_it: scene.title_it,
            prompt_scene_base_final: basePromptFinal,
            prompt_length: basePromptFinal.length,
            appearance_used: appearancePayload,
            outfit: outfitStr || null,
            supporting_characters_snippet: supportingChars || null,
            num_subjects: numSubjects,
            scene_base_output_url: sceneResult.outputImage,
          };
          console.log(`[SCENOGRAFIE PIPELINE · scena base]\n${JSON.stringify(baseLog, null, 2)}`);
          addLog(
            `[base] ${scene.title_it || scene.id} | subj=${numSubjects} | prompt ${basePromptFinal.length}c | out=${shortUrl(sceneResult.outputImage, 72)}`,
          );

          addLog(
            isEnvScene
              ? `Scena ambiente: base generata (nessun identity lock / repair personaggi).`
              : `Scena base generata — applicazione identità…`,
          );
          if (isEnvScene) {
            bumpSceneProgress(i, 0.45);
          } else {
            bumpSceneProgress(i, 0.12);
          }
          let finalUrl = sceneResult.outputImage;
          const repairDiag = {
            repair_ui_enabled: enableRepair,
            repair_attempted: false,
            repair_applied_non_skipped: false,
            repair_status: null,
          };

          if (!isEnvScene) {
            const lockCount = sceneProtagonistIds.length;
            for (let pi = 0; pi < lockCount; pi++) {
              const pId = sceneProtagonistIds[pi];
              const pChar = findPlanCharacterByPresentRef(plan, pId);
              const label = pChar?.name || pId;
              const masterUrl = masters[pId] || null;
              const meta = pChar
                ? masterUrlMetaForLog(pChar, pcmSnap, sync.masterImages, sync.masterByCharName, characterApprovalMap)
                : null;
              const sceneInBefore = finalUrl;

              setImageStatus(`Identity lock: ${label}`);
              if (lockCount > 0) {
                bumpSceneProgress(i, 0.12 + 0.72 * (pi / lockCount));
              }
              try {
                const lockResult = await lockCharacterIdentity({
                  sceneImageUrl: finalUrl,
                  masterImageUrl: masterUrl,
                  isAnimated: animated,
                  globalVisualStyleNote: globalStyleNote,
                });
                finalUrl = lockResult.outputImage;
                const lockTrace = pChar
                  ? buildMasterPipelineTraceRow(
                      pChar,
                      pcmSnap,
                      sync.masterImages,
                      sync.masterByCharName,
                      characterApprovalMap,
                      masters,
                    )
                  : null;
                const lockLog = {
                  lock_step: pi + 1,
                  lock_total: sceneProtagonistIds.length,
                  character_id_applied: pId,
                  character_name_applied: label,
                  identity_lock_master_url: masterUrl,
                  identityLockUrl: masterUrl,
                  approved_map_url: masterUrl,
                  master_source_trace_same_row: lockTrace,
                  master_meta: meta,
                  identity_lock_scene_input_url: sceneInBefore,
                  identity_lock_output_url: finalUrl,
                };
                console.log(`[SCENOGRAFIE PIPELINE · identity lock]\n${JSON.stringify(lockLog, null, 2)}`);
                addLog(
                  `[lock ${pi + 1}/${sceneProtagonistIds.length}] nome="${label}" | masterURL=${shortUrl(masterUrl, 72)} | input=${shortUrl(sceneInBefore, 56)} → out=${shortUrl(finalUrl, 56)}`,
                );
              } catch (lockErr) {
                pipelineWarnings.push(`identity_lock fallito ${label}: ${lockErr.message}`);
                addLog(`Identity lock fallito per ${label}: ${lockErr.message}`);
                console.warn("[SCENOGRAFIE PIPELINE · identity lock ERR]", label, lockErr);
              }
              if (lockCount > 0) {
                bumpSceneProgress(i, 0.12 + 0.72 * ((pi + 1) / lockCount));
              }
            }
            if (lockCount === 0) {
              bumpSceneProgress(i, 0.78);
            }

            let repairInputUrl = null;
            let repairOutputUrl = null;
            let repairStatus = "off";
            if (enableRepair && sceneProtagonistIds.length > 0) {
              bumpSceneProgress(i, 0.86);
              setImageStatus("Repair pass");
              repairInputUrl = finalUrl;
              repairStatus = "on";
              repairDiag.repair_attempted = true;
              try {
                const repairResult = await repairCharacterScene({
                  imageUrl: finalUrl,
                  isAnimated: animated,
                  globalVisualStyleNote: globalStyleNote,
                });
                repairStatus = repairResult.status || "completed";
                repairDiag.repair_status = repairStatus;
                repairOutputUrl = repairResult.outputImage;
                console.log(
                  `[SCENOGRAFIE PIPELINE · repair]\n${JSON.stringify(
                    {
                      repair_active: true,
                      status: repairStatus,
                      repair_input_url: repairInputUrl,
                      repair_output_url: repairOutputUrl,
                    },
                    null,
                    2,
                  )}`,
                );
                if (repairResult.status !== "skipped") {
                  finalUrl = repairResult.outputImage;
                  repairDiag.repair_applied_non_skipped = true;
                  addLog(`[repair] out=${shortUrl(finalUrl, 72)} (status=${repairStatus})`);
                } else {
                  addLog(`[repair] skipped | in=out=${shortUrl(repairInputUrl, 72)}`);
                }
                bumpSceneProgress(i, 0.96);
              } catch (repErr) {
                repairStatus = "error";
                repairDiag.repair_status = "error";
                pipelineWarnings.push(`repair: ${repErr.message}`);
                addLog(`Repair skip: ${repErr.message}`);
                console.warn("[SCENOGRAFIE PIPELINE · repair ERR]", repErr);
                bumpSceneProgress(i, 0.92);
              }
            } else {
              repairDiag.repair_status = !enableRepair ? "ui_off" : "no_lock_targets";
              console.log(
                `[SCENOGRAFIE PIPELINE · repair]\n${JSON.stringify(
                  {
                    repair_active: false,
                    reason: !enableRepair ? "enableRepair=false" : "nessun lock personaggio",
                  },
                  null,
                  2,
                )}`,
              );
              addLog(`[repair] off (${!enableRepair ? "flag" : "no lock"})`);
              if (sceneProtagonistIds.length > 0) {
                bumpSceneProgress(i, 0.94);
              }
            }
          } else {
            repairDiag.repair_status = "environment_scene_skip";
            console.log(
              `[SCENOGRAFIE PIPELINE · identity/repair]\n${JSON.stringify({ skipped: true, reason: "environment_scene" }, null, 2)}`,
            );
            addLog(`[lock/repair] skip — scena ambiente (${sceneTypeRaw})`);
            bumpSceneProgress(i, 0.92);
          }

          bumpSceneProgress(i, 1);
          const outLog = {
            scene_id: scene.id,
            title_it: scene.title_it,
            ...repairDiag,
            scene_base_url: sceneResult.outputImage,
            final_output_url: finalUrl,
            pipeline_warnings: pipelineWarnings,
          };
          console.log(`[SCENOGRAFIE PIPELINE · output finale]\n${JSON.stringify(outLog, null, 2)}`);
          addLog(
            `[out] ${scene.title_it || scene.id} | finale=${shortUrl(finalUrl, 80)}${pipelineWarnings.length ? ` | ⚠${pipelineWarnings.length} warn` : ""}`,
          );

          const displayedImageChosen = finalUrl;
          console.log(
            [
              "[SCENE PIPELINE · PATCH stato → sceneResults (subito dopo pipeline)]",
              `  scene_id: ${scene.id}`,
              `  title_it: ${JSON.stringify(scene.title_it || "")}`,
              `  scene_base_url: ${shortUrlForSceneLog(sceneResult.outputImage)}`,
              `  final_output_url: ${shortUrlForSceneLog(finalUrl)}`,
              `  displayed_image_chosen (miniatura): ${shortUrlForSceneLog(displayedImageChosen)}`,
              "  oggetto riga (campi principali, non Object grezzo):",
              `    sceneId=${scene.id}`,
              `    title=${JSON.stringify(scene.title_it || "")}`,
              `    imageUrl=${shortUrlForSceneLog(finalUrl)}`,
              `    baseImageUrl=${shortUrlForSceneLog(sceneResult.outputImage)}`,
              `    sceneFinalUrl=${shortUrlForSceneLog(finalUrl)}`,
              `    sceneDisplayedVariant=final (policy default quando esiste la finale)`,
            ].join("\n"),
          );

          const updatedAt = new Date().toISOString();
          results.push({
            sceneId: scene.id,
            title: scene.title_it,
            imageUrl: finalUrl,
            baseImageUrl: sceneResult.outputImage,
            mastersUsed: sceneProtagonistIds.map((id) => masters[id]).filter(Boolean),
          });

          const nextRows = mergePipelineSceneIntoResults(
            workingSceneResults,
            scene,
            finalUrl,
            sceneResult,
            updatedAt,
            del,
            plan,
          );
          workingSceneResults = nextRows;

          const normalizedForTrace = nextRows.find((r) => r.sceneId === scene.id);
          if (normalizedForTrace && shouldTraceSceneRow(normalizedForTrace)) {
            logTraceScene2Lifecycle("dopo pipeline (input → normalize)", [
              `scene_base_url=${shortUrlForSceneLog(sceneResult.outputImage)}`,
              `final_output_url=${shortUrlForSceneLog(finalUrl)}`,
              `displayed_image_chosen=${shortUrlForSceneLog(displayedImageChosen)}`,
              `normalized_row: ${sceneRowDebugLine(normalizedForTrace, del)}`,
            ]);
          }

          console.log("[SCENE SAVE · DIRECT POST-PIPELINE]", { sceneId: scene.id });
          void persistChapterPayload(
            buildCurrentChapterPayload({
              sceneResults: nextRows,
              masterImages: sync.masterImages,
              masterByCharName: sync.masterByCharName,
              projectCharacterMasters: pcmSnap,
            }),
          )
            .then((ok) => {
              if (ok) console.log("[SCENE SAVE · DIRECT POST-PIPELINE · OK]", { sceneId: scene.id });
              else
                console.error(
                  "[SCENE SAVE · DIRECT POST-PIPELINE · FAIL]",
                  new Error("persistChapterPayload returned false"),
                  { sceneId: scene.id },
                );
            })
            .catch((e) => {
              console.error("[SCENE SAVE · DIRECT POST-PIPELINE · FAIL]", e);
            });

          setSceneResults((prev) => {
            logSceneResultsSnapshot("setSceneResults BEFORE", prev, del);
            const planActiveIds = (plan.scenes || []).filter((s) => !del.has(s.id)).map((s) => s.id);
            const withoutRow = planActiveIds.filter((sid) => !nextRows.some((rr) => rr.sceneId === sid));
            const prevIds = new Set(prev.map((x) => x.sceneId));
            const nextIds = new Set(nextRows.map((x) => x.sceneId));
            const lost = [...prevIds].filter((id) => !nextIds.has(id));
            logSceneResultsSnapshot("setSceneResults AFTER", nextRows, del);
            console.log(
              [
                "[SCENE GENERATE · setSceneResults FILTER / riordino piano]",
                `  piano scene attive (id): ${JSON.stringify(planActiveIds)}`,
                `  ids in nextRows (ordine card): ${JSON.stringify(nextRows.map((x) => x.sceneId))}`,
                `  scene piano senza riga dopo merge (no miniatura): ${JSON.stringify(withoutRow)}`,
                `  id persi rispetto a prev: ${JSON.stringify(lost)}`,
              ].join("\n"),
            );
            const trNext = nextRows.find(shouldTraceSceneRow);
            if (trNext) {
              logTraceScene2Lifecycle("dopo merge sceneResults", [
                "presente in nextRows: sì",
                `${sceneRowDebugLine(trNext, del)}`,
              ]);
            } else if (shouldTraceSceneRow({ sceneId: scene.id, title: scene.title_it })) {
              logTraceScene2Lifecycle("dopo merge sceneResults", [
                "ATTENZIONE: scena tracciata NON in nextRows",
                `scene_id batch=${scene.id}`,
                `withoutRow=${JSON.stringify(withoutRow)}`,
                `lost=${JSON.stringify(lost)}`,
              ]);
            }
            return nextRows;
          });

          // Save
          if (onSave) {
            try {
              const dataUrl = await imageUrlToBase64(finalUrl);
              await onSave(dataUrl, scene.description, {
                assetDomain: ASSET_DOMAIN.SCENOGRAFIE,
                projectImageMode: "scenografia",
                sceneId: scene.id,
                sceneTitle: scene.title_it,
                type: "scenografia_scene",
                scenografiaProjectStyle: {
                  presetId: lockedStyle.presetId,
                  label: lockedStyle.label,
                  plannerVisualNotes: lockedStyle.plannerVisualNotes,
                  isAnimated: lockedStyle.isAnimated,
                },
              });
            } catch (saveErr) {
              console.error("[SCENOGRAFIE] Save failed:", saveErr);
            }
          }
        } catch (sceneErr) {
          addLog(`ERRORE scena ${scene.title_it}: ${sceneErr.message}`);
          console.error("[SCENOGRAFIE] Scene failed:", scene.title_it, sceneErr);
        }
      }

      addLog(`Completato: ${results.length}/${totalRun} scene elaborate in questa esecuzione`);
      setImageStatus("");
      setImageProgress(100);
      setTimeout(() => setImageProgress(0), 1500);
      setProjectStyleLocked(true);
      setScenografiaPhase("complete");
      if (exMode === "SELECTED") setSelectedSceneIds([]);
    } catch (err) {
      addLog(`ERRORE PIPELINE: ${err.message}`);
      setImageStatus("");
      setImageProgress(0);
      setScenografiaPhase((ph) => (ph === "scene_gen" ? "character_approval" : ph));
    } finally {
      setExecuting(false);
      setScenePipelineFlight?.((cur) =>
        cur && cur.workspaceId === projectId && cur.chapterId === chapterId ? null : cur
      );
    }
  };

  const runGenerateAllPlannedScenes = () => {
    if (!plan || sceneExecuteBlocked) return;
    sceneExecuteModeRef.current = "BATCH_ALL";
    reuseMastersRef.current = (sceneResults || []).length > 0;
    setProjectStyleLocked(false);
    void handleExecute();
  };

  const runGenerateSelectedScenes = () => {
    if (!plan || sceneExecuteBlocked || selectedSceneIds.length === 0) return;
    sceneExecuteModeRef.current = "SELECTED";
    reuseMastersRef.current = (sceneResults || []).length > 0;
    setProjectStyleLocked(false);
    void handleExecute();
  };

  const regenerateSingleScene = (sceneId) => {
    if (!plan || sceneExecuteBlocked) return;
    singleSceneOverrideRef.current = sceneId;
    sceneExecuteModeRef.current = "SELECTED";
    reuseMastersRef.current = true;
    setSelectedSceneIds([sceneId]);
    setProjectStyleLocked(false);
    void handleExecute();
  };

  const handleAbort = () => {
    abortRef.current = true;
    setProjectStyleLocked(false);
    setScenografiaPhase((ph) =>
      ph === "character_gen" || ph === "scene_gen" ? "character_approval" : ph
    );
    addLog("Interruzione richiesta…");
  };

  const approveScene = useCallback((sceneId) => {
    const now = new Date().toISOString();
    setSceneResults((prev) =>
      prev.map((r) =>
        r.sceneId === sceneId
          ? normalizeSceneResultRow({ ...r, approved: true, approvedAt: now, lastUpdatedAt: now })
          : r
      )
    );
  }, []);

  const chooseSceneDisplayVariant = useCallback((sceneId, variant) => {
    setSceneResults((prev) =>
      prev.map((r) => {
        if (r.sceneId !== sceneId) return r;
        const hist = [
          ...(Array.isArray(r.sceneVariantHistory) ? r.sceneVariantHistory : []),
          { at: new Date().toISOString(), variant, trigger: "user_ui" },
        ].slice(-24);
        const row = normalizeSceneResultRow({
          ...r,
          sceneDisplayedVariant: variant,
          sceneVariantHistory: hist,
        });
        logSceneVariantState("user_choice", row);
        return row;
      })
    );
  }, []);

  const deleteScene = useCallback(
    (sceneId) => {
      const row = sceneResults.find((r) => r.sceneId === sceneId);
      if (!row) return;
      const ok = window.confirm(
        `Eliminare solo questa scena dal progetto?\n\n«${row.title}»\n\nNon viene eliminato l'intero progetto né i master personaggio.`
      );
      if (!ok) return;
      setDeletedSceneIds((d) => d.filter((id) => id !== sceneId));
      setSceneResults((prev) => prev.filter((r) => r.sceneId !== sceneId));
      setSelectedSceneIds((s) => s.filter((id) => id !== sceneId));
      setSceneCardFocusId((f) => (f === sceneId ? null : f));
      setModifyingSceneId((m) => {
        if (m === sceneId) {
          setModifyDraftPrompt("");
          return null;
        }
        return m;
      });
    },
    [sceneResults]
  );

  const startModifyScene = useCallback((sceneId) => {
    const row = sceneResults.find((r) => r.sceneId === sceneId);
    setModifyingSceneId(sceneId);
    setModifyDraftPrompt(row?.lastEditPrompt || "");
    setSceneCardFocusId(sceneId);
  }, [sceneResults]);

  const cancelModifyScene = useCallback(() => {
    setModifyingSceneId(null);
    setModifyDraftPrompt("");
  }, []);

  const confirmModifyScene = useCallback(async () => {
    const sid = modifyingSceneId;
    const draft = modifyDraftPrompt.trim();
    if (!plan || !sid || !draft) {
      setPlanError("Inserisci un prompt integrativo per modificare la scena.");
      return;
    }
    const row = sceneResults.find((r) => r.sceneId === sid);
    if (!row?.imageUrl && !row?.sceneDisplayedUrl) return;
    if (sceneEditBusyId || sceneExecuteBlocked) return;

    const lockedStyle = projectStyle || buildProjectStyleFromPlan(plan, imageStylePresets);
    const globalStyleNote = composeGlobalVisualStyle(lockedStyle).slice(0, 900);

    setSceneEditBusyId(sid);
    setPlanError("");
    addLog(`Modifica scena (solo immagine, senza master): ${row.title}…`);
    try {
      const sourceImg = row.sceneDisplayedUrl || row.imageUrl;
      const job = await editScenografiaSceneWithPrompt({
        sceneImageUrl: sourceImg,
        integrativePrompt: draft,
        globalVisualStyleNote: globalStyleNote,
        isAnimated: lockedStyle.isAnimated,
        onProgress: ({ message }) => {
          setImageStatus(message || "Modifica scena");
        },
      });
      const now = new Date().toISOString();
      const hist = [...(row.editHistory || []), { prompt: draft, at: now }].slice(-8);
      setSceneResults((prev) =>
        prev.map((r) => {
          if (r.sceneId !== sid) return r;
          const variant = r.sceneDisplayedVariant === SCENE_DISPLAY_VARIANT.BASE ? SCENE_DISPLAY_VARIANT.BASE : SCENE_DISPLAY_VARIANT.FINAL;
          const patch = {
            ...r,
            approved: false,
            approvedAt: null,
            lastEditPrompt: draft,
            editHistory: hist,
            lastUpdatedAt: now,
          };
          if (variant === SCENE_DISPLAY_VARIANT.BASE) patch.sceneBaseUrl = job.outputImage;
          else patch.sceneFinalUrl = job.outputImage;
          return normalizeSceneResultRow(patch);
        })
      );
      setModifyingSceneId(null);
      setModifyDraftPrompt("");
      addLog(`Modifica scena OK — ${row.title}`);
      if (onSave) {
        try {
          const dataUrl = await imageUrlToBase64(job.outputImage);
          const planScene = (plan.scenes || []).find((s) => s.id === sid);
          await onSave(dataUrl, planScene?.description || row.title, {
            assetDomain: ASSET_DOMAIN.SCENOGRAFIE,
            projectImageMode: "scenografia",
            sceneId: sid,
            sceneTitle: row.title,
            type: "scenografia_scene_edit",
            editPrompt: draft,
            scenografiaProjectStyle: {
              presetId: lockedStyle.presetId,
              label: lockedStyle.label,
              plannerVisualNotes: lockedStyle.plannerVisualNotes,
              isAnimated: lockedStyle.isAnimated,
            },
          });
        } catch (e) {
          console.error("[SCENOGRAFIE] Save post-edit failed:", e);
        }
      }
    } catch (e) {
      addLog(`ERRORE modifica scena: ${e.message}`);
      setPlanError(e.message || "Modifica scena fallita.");
    } finally {
      setSceneEditBusyId(null);
      setImageStatus("");
    }
  }, [
    modifyingSceneId,
    modifyDraftPrompt,
    plan,
    sceneResults,
    projectStyle,
    imageStylePresets,
    sceneEditBusyId,
    executing,
    sceneGenFlightActive,
    onSave,
    addLog,
    setImageStatus,
  ]);

  const rebuildSuggestedTimeline = useCallback(() => {
    setTimelinePlan({
      approved: false,
      approvedAt: null,
      entries: buildSuggestedTimelineEntries({ plan, sceneResults, deletedSceneIds, sceneVideoClips }),
    });
  }, [plan, sceneResults, deletedSceneIds, sceneVideoClips]);

  const confirmTimelineNarrative = useCallback(() => {
    setTimelinePlan((prev) =>
      prev.entries && prev.entries.length > 0
        ? { ...prev, approved: true, approvedAt: new Date().toISOString() }
        : prev
    );
  }, []);

  const unlockTimelineNarrative = useCallback(() => {
    setTimelinePlan((prev) => ({ ...prev, approved: false, approvedAt: null }));
  }, []);

  const moveTimelineEntry = useCallback((idx, dir) => {
    setTimelinePlan((prev) => {
      const entries = [...(prev.entries || [])];
      const j = idx + dir;
      if (j < 0 || j >= entries.length) return prev;
      const a = entries[idx];
      entries[idx] = entries[j];
      entries[j] = a;
      return { ...prev, entries, approved: false, approvedAt: null };
    });
  }, []);

  const setTimelineEntryDuration = useCallback((idx, raw) => {
    const n = raw === "" || raw == null ? null : Number(raw);
    setTimelinePlan((prev) => ({
      ...prev,
      approved: false,
      approvedAt: null,
      entries: prev.entries.map((e, i) =>
        i === idx ? { ...e, durationSec: n != null && Number.isFinite(n) && n >= 0 ? n : null } : e
      ),
    }));
  }, []);

  const onTimelineRowDragStart = (idx) => {
    dragTimelineIdxRef.current = idx;
  };

  const onTimelineRowDragEnd = () => {
    dragTimelineIdxRef.current = null;
  };

  const onTimelineRowDragOver = (e) => {
    e.preventDefault();
  };

  const onTimelineRowDrop = (targetIdx) => {
    const from = dragTimelineIdxRef.current;
    dragTimelineIdxRef.current = null;
    if (from == null || from === targetIdx) return;
    setTimelinePlan((prev) => {
      const entries = [...(prev.entries || [])];
      if (from < 0 || from >= entries.length) return prev;
      const [item] = entries.splice(from, 1);
      let ins = targetIdx;
      if (from < targetIdx) ins = targetIdx - 1;
      entries.splice(ins, 0, item);
      return { ...prev, entries, approved: false, approvedAt: null };
    });
  };

  const applyPresetChoice = useCallback(
    (presetId) => {
      if (!plan || projectStyleLocked || scenografiaPhase !== "plan") return;
      const p = imageStylePresets.find((x) => x.id === presetId);
      if (!p) return;
      setProjectStyle({
        presetId: p.id,
        label: p.label,
        stylePrompt: p.prompt,
        negativePrompt: p.negative_prompt || "",
        plannerVisualNotes:
          String(plan.visual_style || "").trim() ||
          `${p.label}, consistent look for the entire scenography project`,
        isAnimated: isAnimatedStyle([p.id]),
      });
    },
    [plan, projectStyleLocked, scenografiaPhase, imageStylePresets]
  );

  const allCharacterMastersApproved = useMemo(() => {
    if (!plan?.characters?.length) return false;
    const need = getCharactersNeedingMaster(plan);
    if (!need.length) return true;
    const gate = { projectCharacterMasters, characterApprovalMap };
    return need.every((c) => characterMasterReadyForScenes(c, gate));
  }, [plan, characterApprovalMap, projectCharacterMasters]);

  const masterNeedingIds = useMemo(
    () => new Set(getCharactersNeedingMaster(plan).map((c) => c.id)),
    [plan],
  );

  const mastersStillMissingForPlan = useMemo(
    () => getCharactersNeedingMaster(plan).filter((c) => !charHasResolvedMaster(c, projectCharacterMasters)).length,
    [plan, projectCharacterMasters],
  );

  const scenesMissingCount = useMemo(() => {
    if (!plan?.scenes?.length) return 0;
    const byId = Object.fromEntries((sceneResults || []).map((r) => [r.sceneId, r]));
    return plan.scenes.filter((s) => s?.id).filter((s) => {
      const r = byId[s.id];
      return !r?.imageUrl;
    }).length;
  }, [plan, sceneResults]);

  const selectedMissingCount = useMemo(() => {
    if (!plan?.scenes?.length || !selectedSceneIds.length) return 0;
    const byId = Object.fromEntries((sceneResults || []).map((r) => [r.sceneId, r]));
    return selectedSceneIds.filter((id) => {
      const s = plan.scenes.find((x) => x.id === id);
      if (!s) return false;
      const r = byId[id];
      return !r?.imageUrl;
    }).length;
  }, [plan, selectedSceneIds, sceneResults]);

  const gatePayload = useMemo(
    () => ({
      plan,
      characterApprovalMap,
      masterImages,
      projectCharacterMasters,
      sceneResults,
      deletedSceneIds,
      sceneVideoClips,
      timelinePlan,
    }),
    [
      plan,
      characterApprovalMap,
      masterImages,
      projectCharacterMasters,
      sceneResults,
      deletedSceneIds,
      sceneVideoClips,
      timelinePlan,
    ],
  );

  const approvedScenesForClips = useMemo(
    () => getApprovedActiveScenes({ plan, sceneResults, deletedSceneIds }),
    [plan, sceneResults, deletedSceneIds]
  );

  const projectUiStatus = useMemo(
    () =>
      deriveScenografiaUiStatus({
        plan,
        scenografiaPhase,
        characterApprovalMap,
        masterImages,
        projectCharacterMasters,
        sceneResults,
        deletedSceneIds,
        scenografiaVideoPhase,
        sceneVideoClips,
        finalMontagePhase,
        timelinePlan,
      }),
    [
      plan,
      scenografiaPhase,
      characterApprovalMap,
      masterImages,
      projectCharacterMasters,
      sceneResults,
      deletedSceneIds,
      scenografiaVideoPhase,
      sceneVideoClips,
      finalMontagePhase,
      timelinePlan,
    ]
  );

  const chapterPayloadForOps = useMemo(
    () => ({
      plan,
      sceneResults,
      sceneVideoClips,
      deletedSceneIds,
      projectCharacterMasters,
      characterApprovalMap,
      characterVoiceMasters,
      projectNarrators,
    }),
    [
      plan,
      sceneResults,
      sceneVideoClips,
      deletedSceneIds,
      projectCharacterMasters,
      characterApprovalMap,
      characterVoiceMasters,
      projectNarrators,
    ],
  );

  const completionGapPayload = useMemo(
    () => ({
      plan,
      scenografiaPhase,
      characterApprovalMap,
      masterImages,
      projectCharacterMasters,
      sceneResults,
      deletedSceneIds,
      scenografiaVideoPhase,
      sceneVideoClips,
      finalMontagePhase,
      timelinePlan,
      projectNarrators,
      finalFilmMontage,
    }),
    [
      plan,
      scenografiaPhase,
      characterApprovalMap,
      masterImages,
      projectCharacterMasters,
      sceneResults,
      deletedSceneIds,
      scenografiaVideoPhase,
      sceneVideoClips,
      finalMontagePhase,
      timelinePlan,
      projectNarrators,
      finalFilmMontage,
    ],
  );

  const completionGaps = useMemo(() => computeChapterCompletionGaps(completionGapPayload), [completionGapPayload]);

  const chapterMontageDelivery = useMemo(
    () =>
      deriveFilmOutputReadinessFromChapterData({
        finalFilmMontage,
        finalMontagePhase,
        scenografiaVideoPhase,
      }),
    [finalFilmMontage, finalMontagePhase, scenografiaVideoPhase],
  );

  const montageNextStepLine = useMemo(
    () =>
      consumerMontageNextStepIt({
        readiness: chapterMontageDelivery.readiness,
        finalMontagePhase,
        montageStatus: finalFilmMontage?.status,
        outputUrl: finalFilmMontage?.outputUrl,
      }),
    [
      chapterMontageDelivery.readiness,
      finalMontagePhase,
      finalFilmMontage?.status,
      finalFilmMontage?.outputUrl,
    ],
  );

  const chapterMontageConsumer = useMemo(
    () =>
      deriveChapterMontageConsumerSummary({
        finalFilmMontage,
        finalMontagePhase,
        scenografiaVideoPhase,
      }),
    [finalFilmMontage, finalMontagePhase, scenografiaVideoPhase],
  );
  const chapterFilmConfidence = chapterMontageConsumer.confidence;

  const workspaceSummaryFilm = useMemo(() => {
    if (!workspaceChaptersLight.length) return null;
    const ws = {
      workspaceVersion: SCENOGRAFIA_WORKSPACE_VERSION,
      chapters: workspaceChaptersLight,
      filmOutputVerification: workspaceFilmVerification,
      narrativeProjectTitle: workspaceNarrativeTitle || "",
      narrativeProjectDescription: "",
      projectTitle: (projectTitle || workspaceNarrativeTitle || "").trim(),
      projectDescription: "",
    };
    return summarizeScenografiaWorkspaceForIndex(ws);
  }, [workspaceChaptersLight, workspaceFilmVerification, workspaceNarrativeTitle, projectTitle]);

  const chapterFilmSimple = useMemo(
    () =>
      deriveFinalOutputSimplePresentation(chapterFilmConfidence, {
        hasUrl: Boolean(finalFilmMontage?.outputUrl),
        filmDeliveryState: chapterMontageConsumer.filmDeliveryState,
        filmOutputReadiness: chapterMontageConsumer.readiness,
        filmVerificationEffective: workspaceSummaryFilm?.filmVerificationEffective ?? null,
      }),
    [
      chapterFilmConfidence,
      chapterMontageConsumer.filmDeliveryState,
      chapterMontageConsumer.readiness,
      finalFilmMontage?.outputUrl,
      workspaceSummaryFilm?.filmVerificationEffective,
    ],
  );

  const workspaceFilmPlaybackPlan = useMemo(
    () => buildFinalFilmPlaybackCandidates({ chapters: workspaceChaptersLight }),
    [workspaceChaptersLight],
  );

  const editorFilmPlaybackEntries = useMemo(() => {
    const merged = mergePlaybackEntriesChapterFirst(
      finalFilmMontage?.outputUrl,
      chapterId,
      workspaceFilmPlaybackPlan,
    );
    if (merged.entries.length) return merged.entries;
    const u =
      finalFilmMontage?.outputUrl != null && String(finalFilmMontage.outputUrl).trim()
        ? String(finalFilmMontage.outputUrl).trim()
        : null;
    return u
      ? [{ url: u, sourceLabel: "Output · questo capitolo", chapterId: chapterId || null }]
      : [];
  }, [finalFilmMontage?.outputUrl, chapterId, workspaceFilmPlaybackPlan]);

  const editorPlaybackMoment = useMemo(
    () =>
      describeFinalFilmPlaybackMoment(
        chapterFilmSimple.tier,
        chapterMontageConsumer.readiness,
        workspaceSummaryFilm?.filmVerificationEffective ?? null,
      ),
    [chapterFilmSimple.tier, chapterMontageConsumer.readiness, workspaceSummaryFilm?.filmVerificationEffective],
  );

  const handleVerifyWorkspaceFilmOutput = useCallback(async () => {
    if (!projectId) return;
    setEditorFilmVerifyBusy(true);
    try {
      const res = await runAndPersistFilmOutputVerification(projectId);
      if (res.ok && res.persistedVerification) {
        setWorkspaceFilmVerification(res.persistedVerification);
      }
    } finally {
      setEditorFilmVerifyBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    setEditorFilmPlaybackIndex(0);
    setEditorFilmPlaybackError(null);
    setEditorFilmPlaybackReloadKey((k) => k + 1);
  }, [finalFilmMontage?.outputUrl, chapterId, workspaceChaptersLight]);

  const applyRecoveryDeepLink = useCallback((link) => {
    if (!link || typeof link !== "object") return;
    const focus = link.focus != null ? String(link.focus).trim() : "";
    const sceneId = link.sceneId != null ? String(link.sceneId).trim() : "";
    const clipId = link.clipId != null ? String(link.clipId).trim() : "";
    window.requestAnimationFrame(() => {
      const scrollTo = (id) => {
        const el = typeof document !== "undefined" ? document.getElementById(id) : null;
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      if (clipId) {
        if (sceneId) setSceneCardFocusId(sceneId);
        setClipBuilderClipId(clipId);
        scrollTo(`ax-scenografie-clip-${clipId}`);
        return;
      }
      if (sceneId) {
        setSceneCardFocusId(sceneId);
        scrollTo(`ax-scenografie-scene-${sceneId}`);
        return;
      }
      if (focus === "montage") {
        scrollTo("ax-scenografie-anchor-montage");
        if (typeof document !== "undefined" && !document.getElementById("ax-scenografie-anchor-montage")) {
          scrollTo("ax-scenografie-anchor-clips");
        }
      } else if (focus === "clips") scrollTo("ax-scenografie-anchor-clips");
      else if (focus === "timeline") scrollTo("ax-scenografie-anchor-timeline");
      else if (focus === "scenes") scrollTo("ax-scenografie-anchor-scenes");
      else if (focus === "characters") scrollTo("ax-scenografie-anchor-cast");
      else if (focus === "narrators") scrollTo("ax-scenografie-anchor-narrators");
    });
  }, []);

  useEffect(() => {
    if (!initialRecoveryDeepLink) return undefined;
    const t = window.setTimeout(() => {
      applyRecoveryDeepLink(initialRecoveryDeepLink);
      onConsumedRecoveryDeepLink?.();
    }, 220);
    return () => window.clearTimeout(t);
  }, [initialRecoveryDeepLink, applyRecoveryDeepLink, onConsumedRecoveryDeepLink]);

  const canOpenVideoProduction =
    allCharacterMastersApprovedForVideo(gatePayload) &&
    allActiveScenesApproved(gatePayload) &&
    scenografiaVideoPhase === "none" &&
    !sceneExecuteBlocked &&
    !planning;

  const canStartFinalMontage =
    allCharacterMastersApprovedForVideo(gatePayload) &&
    allActiveScenesApproved(gatePayload) &&
    clipsReadyForFinalMontage(gatePayload) &&
    timelineNarrativeApproved(gatePayload) &&
    finalMontagePhase === "none" &&
    !sceneExecuteBlocked &&
    !planning;

  const handleGoToVideoProduction = useCallback(async () => {
    if (!projectId || !canOpenVideoProduction) return;
    const base = persistSnapshotRef.current;
    if (!base) return;
    const payload = { ...base, scenografiaVideoPhase: "production" };
    const ok = await persistChapterPayload(payload);
    if (ok) setScenografiaVideoPhase("production");
    onGoToVideoProduction?.({ projectId, plan: base.plan, sceneResults: base.sceneResults });
  }, [projectId, onGoToVideoProduction, canOpenVideoProduction, persistChapterPayload]);

  const handleMarkVideoCompleted = useCallback(async () => {
    if (!projectId) return;
    const base = persistSnapshotRef.current;
    if (!base) return;
    const payload = { ...base, scenografiaVideoPhase: "completed" };
    await persistChapterPayload(payload);
    setScenografiaVideoPhase("completed");
  }, [projectId, persistChapterPayload]);

  const handleStartFinalMontage = useCallback(async () => {
    if (!projectId || !canStartFinalMontage) return;
    const base = persistSnapshotRef.current;
    if (!base) return;
    const fromTimeline = buildMontagePlanFromTimeline(base);
    const nextPlan = {
      ...(base.finalMontagePlan && typeof base.finalMontagePlan === "object" ? base.finalMontagePlan : {}),
      ...fromTimeline,
    };
    const { compiledMontagePlan, montageExecutionPlan, finalFilmBuildPlan } = compileMontagePlans({
      timelinePlan: base.timelinePlan,
      finalMontagePlan: nextPlan,
      sceneVideoClips: base.sceneVideoClips,
    });
    console.info("[AXSTUDIO · montage · compiled plan]", compiledMontagePlan);
    const nextFilm = normalizeFinalFilmMontage({
      ...emptyFinalFilmMontage(),
      status: "ready",
      lastCompiledAt: compiledMontagePlan.compiledAt,
      compiledMontagePlan,
      montageExecutionPlan,
      finalFilmBuildPlan,
    });
    const payload = { ...base, finalMontagePhase: "assembly", finalMontagePlan: nextPlan, finalFilmMontage: nextFilm };
    await persistChapterPayload(payload);
    setFinalMontagePhase("assembly");
    setFinalMontagePlan(nextPlan);
    setFinalFilmMontage(nextFilm);
    addLog("Montaggio finale: piano compilato dalla timeline approvata. Puoi generare il filmato.");
  }, [projectId, canStartFinalMontage, addLog, persistChapterPayload]);

  const handleRefreshMontagePlan = useCallback(async () => {
    if (!projectId || finalMontagePhase !== "assembly" || montageRenderBusy) return;
    const base = persistSnapshotRef.current;
    if (!base) return;
    const fmp = base.finalMontagePlan && typeof base.finalMontagePlan === "object" ? base.finalMontagePlan : {};
    const { compiledMontagePlan, montageExecutionPlan, finalFilmBuildPlan } = compileMontagePlans({
      timelinePlan: base.timelinePlan,
      finalMontagePlan: fmp,
      sceneVideoClips: base.sceneVideoClips,
    });
    console.info("[AXSTUDIO · montage · compiled plan]", compiledMontagePlan);
    const nextFilm = normalizeFinalFilmMontage({
      ...(base.finalFilmMontage && typeof base.finalFilmMontage === "object" ? base.finalFilmMontage : {}),
      status: "ready",
      lastCompiledAt: compiledMontagePlan.compiledAt,
      compiledMontagePlan,
      montageExecutionPlan,
      finalFilmBuildPlan,
      outputUrl: null,
      lastError: null,
      lastWorkflowFailure: null,
      lastMontageAttemptAt: null,
      lastRenderStartedAt: null,
      lastRenderCompletedAt: null,
      outputUrlSetAt: null,
      lastRenderSummary: null,
    });
    const payload = { ...base, finalFilmMontage: nextFilm };
    await persistChapterPayload(payload);
    setFinalFilmMontage(nextFilm);
    addLog("Piano montaggio aggiornato (durate e ordine dalla timeline corrente).");
  }, [projectId, finalMontagePhase, montageRenderBusy, persistChapterPayload, addLog]);

  const handleGenerateFinalFilm = useCallback(async () => {
    if (!projectId || montageRenderBusy || finalMontagePhase !== "assembly") return;
    const base = persistSnapshotRef.current;
    if (!base) return;
    setMontageRenderBusy(true);
    let working = { ...base };
    try {
      const fmp = base.finalMontagePlan && typeof base.finalMontagePlan === "object" ? base.finalMontagePlan : {};
      const { compiledMontagePlan, montageExecutionPlan, finalFilmBuildPlan } = compileMontagePlans({
        timelinePlan: base.timelinePlan,
        finalMontagePlan: fmp,
        sceneVideoClips: base.sceneVideoClips,
      });
      console.info("[AXSTUDIO · montage · compiled plan]", compiledMontagePlan);
      const val = validateMontageRenderable(compiledMontagePlan);
      if (!val.ok) {
        const err = val.reasons.join("; ");
        const lastWorkflowFailure = buildMontageFailureRecord({
          kind: "validate",
          userMessage: "Il montaggio non può partire: controlla clip mancanti, URL o timeline.",
          technical: err,
        });
        logConsumerReliabilityEvent("montage_validate_failed", { ...lastWorkflowFailure, projectId });
        working = {
          ...working,
          finalFilmMontage: normalizeFinalFilmMontage({
            ...(base.finalFilmMontage && typeof base.finalFilmMontage === "object" ? base.finalFilmMontage : {}),
            status: "failed",
            lastError: lastWorkflowFailure.errorMessageUser,
            lastWorkflowFailure,
            lastMontageAttemptAt: new Date().toISOString(),
            lastCompiledAt: compiledMontagePlan.compiledAt,
            compiledMontagePlan,
            montageExecutionPlan,
            finalFilmBuildPlan,
          }),
        };
        await persistChapterPayload(working);
        setFinalFilmMontage(working.finalFilmMontage);
        addLog(`Montaggio: validazione fallita — ${err}`);
        return;
      }
      const renderStartedAt = new Date().toISOString();
      working = {
        ...working,
        finalFilmMontage: normalizeFinalFilmMontage({
          ...(base.finalFilmMontage && typeof base.finalFilmMontage === "object" ? base.finalFilmMontage : {}),
          status: "rendering",
          lastCompiledAt: compiledMontagePlan.compiledAt,
          lastRenderStartedAt: renderStartedAt,
          compiledMontagePlan,
          montageExecutionPlan,
          finalFilmBuildPlan,
          lastError: null,
          lastWorkflowFailure: null,
          lastMontageAttemptAt: renderStartedAt,
        }),
      };
      await persistChapterPayload(working);
      setFinalFilmMontage(working.finalFilmMontage);
      console.info("[AXSTUDIO · montage · execution]", montageExecutionPlan);
      const { outputUrl, blobSizeBytes, renderSummary } = await runFinalMontageRender(compiledMontagePlan, {
        onProgress: (s) => console.info("[AXSTUDIO · montage · execution]", s),
      });
      console.info("[AXSTUDIO · montage · output]", {
        outputUrl,
        blobSizeBytes,
        renderModeUsed: renderSummary?.renderModeUsed,
        concatHadToReencode: renderSummary?.concatHadToReencode,
      });
      working = {
        ...working,
        finalFilmMontage: normalizeFinalFilmMontage({
          ...working.finalFilmMontage,
          status: "complete",
          lastRenderCompletedAt: new Date().toISOString(),
          outputUrlSetAt: new Date().toISOString(),
          outputUrl,
          lastError: null,
          lastWorkflowFailure: null,
          lastRenderSummary: renderSummary,
          montageExecutionPlan: {
            ...montageExecutionPlan,
            renderModeResolved: renderSummary?.renderModeUsed ?? null,
            concatHadToReencode: renderSummary?.concatHadToReencode ?? null,
            lastRunCompletedAt: renderSummary?.at ?? null,
          },
          compiledMontagePlan,
          finalFilmBuildPlan,
        }),
      };
      await persistChapterPayload(working);
      setFinalFilmMontage(working.finalFilmMontage);
      addLog(`Filmato finale pronto: ${outputUrl}`);
    } catch (e) {
      const msg = e?.message || String(e);
      console.info("[AXSTUDIO · montage · output]", { error: msg });
      const lastWorkflowFailure = buildMontageFailureRecord({
        kind: "render",
        userMessage:
          "Il filmato finale non è stato creato. Controlla la connessione, lo spazio in memoria e riprova il render.",
        technical: msg,
      });
      logConsumerReliabilityEvent("montage_render_failed", { ...lastWorkflowFailure, projectId });
      working = {
        ...working,
        finalFilmMontage: normalizeFinalFilmMontage({
          ...(working.finalFilmMontage && typeof working.finalFilmMontage === "object" ? working.finalFilmMontage : {}),
          status: "failed",
          lastError: lastWorkflowFailure.errorMessageUser,
          lastWorkflowFailure,
          lastMontageAttemptAt: new Date().toISOString(),
          lastRenderCompletedAt: new Date().toISOString(),
          outputUrlSetAt: null,
        }),
      };
      await persistChapterPayload(working);
      setFinalFilmMontage(working.finalFilmMontage);
      addLog(`Montaggio: errore — ${msg}`);
    } finally {
      setMontageRenderBusy(false);
    }
  }, [projectId, montageRenderBusy, finalMontagePhase, persistChapterPayload, addLog]);

  const handleMarkFinalMontageDone = useCallback(async () => {
    if (!projectId) return;
    const base = persistSnapshotRef.current;
    if (!base) return;
    const payload = { ...base, finalMontagePhase: "done" };
    await persistChapterPayload(payload);
    setFinalMontagePhase("done");
    addLog("Montaggio finale segnato come completato.");
  }, [projectId, addLog, persistChapterPayload]);

  const openClipBuilder = useCallback((clipId) => {
    setClipBuilderClipId(clipId);
  }, []);

  const closeClipBuilder = useCallback(() => {
    setClipBuilderClipId(null);
  }, []);

  const patchActiveClip = useCallback(
    (partial) => {
      if (!clipBuilderClipId) return;
      const now = new Date().toISOString();
      setSceneVideoClips((prev) =>
        prev.map((c) =>
          c.id === clipBuilderClipId ? normalizeSceneVideoClip({ ...c, ...partial, updatedAt: now }) : c
        )
      );
    },
    [clipBuilderClipId]
  );

  const patchCharacterVoiceMaster = useCallback(
    (characterId, partial) => {
      const ch = plan?.characters?.find((c) => c.id === characterId);
      const mapKey = ch ? stableCharacterKey(ch) : characterId;
      setCharacterVoiceMasters((prev) => {
        const next = { ...prev };
        if (partial.isNarratorDefault === true) {
          for (const k of Object.keys(next)) {
            if (k === mapKey) continue;
            const o = normalizeCharacterVoiceMaster(next[k], k);
            if (o.isNarratorDefault) {
              next[k] = normalizeCharacterVoiceMaster({ ...o, isNarratorDefault: false }, k);
            }
          }
        }
        const cur = normalizeCharacterVoiceMaster(next[mapKey], mapKey);
        let mergePartial = { ...partial };
        const prevVid = String(cur.voiceId || "").trim();
        const nextVid = partial.voiceId != null ? String(partial.voiceId).trim() : prevVid;
        if (nextVid && prevVid && nextVid !== prevVid) {
          const hist = [
            ...(cur.voiceAssignmentHistory || []),
            {
              voiceId: cur.voiceId,
              voiceLabel: cur.voiceLabel,
              at: new Date().toISOString(),
              note: "reassigned_before_clip_regeneration",
            },
          ];
          mergePartial = { ...mergePartial, voiceAssignmentHistory: hist.slice(-12) };
        }
        const n = normalizeCharacterVoiceMaster({ ...cur, ...mergePartial }, mapKey);
        next[mapKey] = n;
        if (typeof console !== "undefined" && console.info && mergePartial.voiceId != null) {
          console.info("[AXSTUDIO · character voice master]", {
            mapKey,
            characterId,
            voiceId: n.voiceId,
            voiceSourceType: n.voiceSourceType || null,
          });
        }
        return next;
      });
    },
    [plan],
  );

  const addSceneVideoClip = useCallback((sceneId) => {
    setSceneVideoClips((prev) => {
      const sortOrder = prev.filter((c) => c.sceneId === sceneId).length;
      const nu = createEmptySceneVideoClip(sceneId, sortOrder);
      setClipBuilderClipId(nu.id);
      return [...prev, nu];
    });
  }, []);

  const approveVideoClip = useCallback((clipId) => {
    const now = new Date().toISOString();
    setSceneVideoClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? normalizeSceneVideoClip({ ...c, status: SCENE_VIDEO_CLIP_STATUS.APPROVED, updatedAt: now }) : c
      )
    );
  }, []);

  const markVideoClipDeleted = useCallback((clipId) => {
    const now = new Date().toISOString();
    setSceneVideoClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? normalizeSceneVideoClip({ ...c, status: SCENE_VIDEO_CLIP_STATUS.DELETED, updatedAt: now }) : c
      )
    );
    setClipBuilderClipId((id) => (id === clipId ? null : id));
  }, []);

  const regenerateVideoClip = useCallback((clipId) => {
    const now = new Date().toISOString();
    setSceneVideoClips((prev) =>
      prev.map((c) =>
        c.id === clipId
          ? normalizeSceneVideoClip({
              ...c,
              status: SCENE_VIDEO_CLIP_STATUS.DRAFT,
              videoUrl: null,
              audioUrl: null,
              audioDurationSeconds: null,
              providerVideo: "",
              providerVoice: "",
              generationModel: "",
              generationStatus: "idle",
              lastGenerationError: null,
              updatedAt: now,
            })
          : c
      )
    );
    setClipBuilderClipId(clipId);
    addLog("Clip in bozza: dati generazione azzerati — puoi rilanciare la pipeline dal Clip Builder.");
  }, [addLog]);

  const markClipNeedsReviewFromBuilder = useCallback(() => {
    const id = clipBuilderClipId;
    if (!id) return;
    const c = sceneVideoClips.find((x) => x.id === id);
    const draft = String(c?.lastEditPrompt || "").trim();
    if (!draft) return;
    const now = new Date().toISOString();
    setSceneVideoClips((prev) =>
      prev.map((cl) => {
        if (cl.id !== id) return cl;
        const hist = [...(cl.editHistory || []), { prompt: draft, at: now }].slice(-12);
        return normalizeSceneVideoClip({
          ...cl,
          status: SCENE_VIDEO_CLIP_STATUS.NEEDS_CHANGES,
          lastEditPrompt: draft,
          editHistory: hist,
          updatedAt: now,
        });
      })
    );
    addLog("Richiesta modifica clip registrata (motore video da integrare).");
  }, [clipBuilderClipId, sceneVideoClips, addLog]);

  const handleGenerateClipFromBuilder = useCallback(async () => {
    const id = clipBuilderClipId;
    if (!id || clipPipelineUi.busy) return;
    const c = sceneVideoClips.find((x) => x.id === id);
    if (!c) return;
    const { ok, reasons } = getClipGenerationReadiness(c, {
      characterVoiceMasters,
      projectCharacterMasters,
      projectNarrators,
      plan,
      sceneResults,
    });
    if (!ok) {
      reasons.forEach((r) => addLog(`Clip: ${r}`));
      return;
    }
    setClipPipelineUi({ busy: true, stage: "audio", clipId: id });
    try {
      await runScenografieClipVideoPipeline({
        clip: c,
        plan,
        sceneResults,
        characterVoiceMasters,
        projectCharacterMasters,
        projectNarrators,
        projectMeta: {
          id: projectId,
          title: workspaceNarrativeTitle || projectTitle || null,
        },
        chapterMeta: { id: chapterId, ordinal: chapterOrdinal },
        patchClip: (partial) => {
          const now = new Date().toISOString();
          setSceneVideoClips((prev) =>
            prev.map((cl) => (cl.id === id ? normalizeSceneVideoClip({ ...cl, ...partial, updatedAt: now }) : cl))
          );
        },
        onProgress: (phase, detail) => {
          setClipPipelineUi((s) => ({ ...s, stage: phase }));
          if (detail) addLog(detail);
        },
      });
      addLog(`Clip «${c.title || c.label || id}»: generazione completata — in revisione.`);
    } catch (e) {
      if (typeof console !== "undefined" && console.warn) console.warn("[Scenografie clip]", e);
      const userMsg = sanitizeClipPipelineErrorForUser(e);
      addLog(`Errore generazione clip: ${userMsg}`);
    } finally {
      setClipPipelineUi({ busy: false, stage: null, clipId: null });
    }
  }, [
    clipBuilderClipId,
    clipPipelineUi.busy,
    sceneVideoClips,
    characterVoiceMasters,
    plan,
    sceneResults,
    addLog,
    projectId,
    workspaceNarrativeTitle,
    projectTitle,
    chapterId,
    chapterOrdinal,
    projectCharacterMasters,
    projectNarrators,
  ]);

  const clipBuilderOpenClip = useMemo(
    () =>
      sceneVideoClips.find(
        (c) => c.id === clipBuilderClipId && c.status !== SCENE_VIDEO_CLIP_STATUS.DELETED
      ) || null,
    [sceneVideoClips, clipBuilderClipId]
  );

  const runProtagonistMastersBatch = async () => {
    if (!plan || !projectStyle) {
      setPlanError("Definisci prima lo stile progetto (preset) dal piano.");
      return;
    }
    if (executing || sceneGenFlightActive) return;
    const lockedStyle = projectStyle || buildProjectStyleFromPlan(plan, imageStylePresets);
    const globalVisual = composeGlobalVisualStyle(lockedStyle);
    setProjectStyle(lockedStyle);
    setPlanError("");
    const needMaster = getCharactersNeedingMaster(plan);
    if (!needMaster.length) {
      addLog("Nessun master obbligatorio: il piano non include scene con personaggi. Puoi passare a «Genera tutte le scene».");
      setScenografiaPhase("character_approval");
      return;
    }
    const hasResolvedRef = (c) => !!getDisplayMasterUrl(c, projectCharacterMastersRef.current);
    const toGenerate = needMaster.filter((c) => !hasResolvedRef(c));
    if (toGenerate.length === 0) {
      addLog("Tutti i master obbligatori sono già nel progetto (id o nome). Approva le card se necessario, poi «Genera tutte le scene».");
      setScenografiaPhase("character_approval");
      return;
    }
    setScenografiaPhase("character_gen");
    setExecuting(true);
    abortRef.current = false;
    setExecutionLog([]);
    setImageProgress(0);
    try {
      let done = 0;
      const totalGen = Math.max(1, toGenerate.length);
      for (const char of needMaster) {
        if (abortRef.current) break;
        if (hasResolvedRef(char)) continue;
        setBatchMasterCharId(char.id);
        done += 1;
        setImageStatus(`Master: ${char.name}`);
        setImageProgress(Math.round(8 + (done / totalGen) * 40));
        try {
          const pcmKey = stableCharacterKey(char);
          const prevRow = (pcmKey && projectCharacterMastersRef.current[pcmKey]) || {};
          const extraPrompt = buildMasterExtraPromptForCharacter(char, prevRow);
          const masterResult = await createMasterCharacter({
            appearance: {},
            outfit: char.appearance?.outfit || "",
            visualStyle: globalVisual,
            extraPrompt,
            aspectRatio: "9:16",
          });
          const out = masterResult.outputImage;
          const savedPrompt = String(prevRow.characterMasterPrompt || "").trim();
          const pcmNext = {
            ...projectCharacterMastersRef.current,
            [pcmKey]: {
              ...prevRow,
              characterId: char.id,
              characterName: char.name,
              masterImageUrl: out,
              approved: false,
              updatedAt: new Date().toISOString(),
              source: "generated_master",
              pendingManualReview: false,
              lastCharacterRegenerationPrompt:
                savedPrompt || String(prevRow.lastCharacterRegenerationPrompt || "").trim() || "",
              characterPromptHistory: savedPrompt
                ? appendCharacterPromptHistory(prevRow.characterPromptHistory, savedPrompt)
                : Array.isArray(prevRow.characterPromptHistory)
                  ? prevRow.characterPromptHistory
                  : [],
            },
          };
          commitProjectCharacterMastersSync(pcmNext, "batch_master_generated");
          setCharacterApprovalMap((prev) => ({
            ...prev,
            [pcmKey]: { approved: false, approvedAt: null, version: (prev[pcmKey]?.version ?? 0) + 1 },
          }));
        } catch (err) {
          setExecutionLog((prev) => [
            ...prev,
            { time: new Date().toLocaleTimeString(), msg: `ERRORE master ${char.name}: ${err.message}` },
          ]);
        } finally {
          setBatchMasterCharId(null);
        }
      }
      setScenografiaPhase("character_approval");
    } finally {
      setExecuting(false);
      setBatchMasterCharId(null);
      setImageStatus("");
      setImageProgress(0);
    }
  };

  /** Prima generazione o rigenerazione: aggiorna preview, invalida approvazione, persiste via snapshot progetto. */
  const generateOrRegenerateCharacterMaster = async (charId, opts = {}) => {
    if (!plan || !projectStyle || pipelineLocked) return;
    if (sceneExecuteBlocked) return;
    if (regeneratingCharId != null || batchMasterCharId != null) return;
    const char = plan.characters.find((c) => c.id === charId);
    if (!char) return;
    if (!getCharactersNeedingMaster(plan).some((c) => c.id === charId)) return;
    const explicit =
      opts && opts.explicitMasterPrompt != null ? String(opts.explicitMasterPrompt).trim() : "";
    const lockedStyle = projectStyle || buildProjectStyleFromPlan(plan, imageStylePresets);
    const globalVisual = composeGlobalVisualStyle(lockedStyle);
    setPlanError("");
    setRegeneratingCharId(charId);
    const pcmKeyPre = stableCharacterKey(char);
    setCharacterApprovalMap((prev) => ({
      ...prev,
      [pcmKeyPre]: { approved: false, approvedAt: null, version: (prev[pcmKeyPre]?.version ?? 0) + 1 },
    }));
    try {
      const pcmKey = stableCharacterKey(char);
      const prevRow = (pcmKey && projectCharacterMastersRef.current[pcmKey]) || {};
      const rowForPrompt =
        explicit !== "" ? { ...prevRow, characterMasterPrompt: explicit } : prevRow;
      const extraPrompt = buildMasterExtraPromptForCharacter(char, rowForPrompt);
      const masterResult = await createMasterCharacter({
        appearance: {},
        outfit: char.appearance?.outfit || "",
        visualStyle: globalVisual,
        extraPrompt,
        aspectRatio: "9:16",
      });
      const out = masterResult.outputImage;
      const savedPrompt =
        explicit !== "" ? explicit : String(prevRow.characterMasterPrompt || "").trim();
      const pcmNext = {
        ...projectCharacterMastersRef.current,
        [pcmKey]: {
          ...prevRow,
          characterId: char.id,
          characterName: char.name,
          masterImageUrl: out,
          approved: false,
          updatedAt: new Date().toISOString(),
          source: "regenerated_master",
          pendingManualReview: false,
          characterMasterPrompt: savedPrompt || String(prevRow.characterMasterPrompt || "").trim(),
          lastCharacterRegenerationPrompt:
            savedPrompt || String(prevRow.lastCharacterRegenerationPrompt || "").trim() || "",
          characterPromptHistory: savedPrompt
            ? appendCharacterPromptHistory(prevRow.characterPromptHistory, savedPrompt)
            : Array.isArray(prevRow.characterPromptHistory)
              ? prevRow.characterPromptHistory
              : [],
        },
      };
      commitProjectCharacterMastersSync(pcmNext, "single_master_regenerated");
    } catch (err) {
      setPlanError(err.message || `Generazione master fallita per ${char.name}`);
    } finally {
      setRegeneratingCharId(null);
    }
  };

  const approveProtagonistMaster = (charId) => {
    const ch = findPlanCharacterByLocalId(plan, charId);
    if (!ch) return;
    const pcmKey = stableCharacterKey(ch);
    const url = getDisplayMasterUrl(ch, projectCharacterMasters);
    if (!url) return;
    const row = pcmRowForCharacter(projectCharacterMasters, ch) || {};
    const pcmNext = {
      ...projectCharacterMasters,
      [pcmKey]: {
        ...row,
        characterId: ch.id,
        characterName: ch.name,
        masterImageUrl: url,
        approved: true,
        updatedAt: new Date().toISOString(),
        source: PCM_SOURCE_USER_CANONICAL_LOCK,
        pendingManualReview: false,
      },
    };
    commitProjectCharacterMastersSync(pcmNext, "approve_canonical_lock");
    setCharacterApprovalMap((prev) => ({
      ...prev,
      [pcmKey]: {
        approved: true,
        approvedAt: new Date().toISOString(),
        version: prev[pcmKey]?.version ?? 1,
      },
    }));
  };

  /**
   * Usa un URL immagine già presente (es. fotogramma scena di un altro capitolo) come nuovo master ufficiale di progetto.
   * Aggiorna PCM + cache legacy; archivia il master precedente in `priorMasterImageUrls` (solo URL).
   */
  const promoteImageUrlToProjectMaster = useCallback(
    (charId, imageUrl) => {
      const masterPromoteLocked =
        finalMontagePhase === "assembly" ||
        finalMontagePhase === "done" ||
        scenografiaVideoPhase === "completed";
      if (!plan || masterPromoteLocked) return;
      const ch = findPlanCharacterByLocalId(plan, charId);
      if (!ch) return;
      const pcmKey = stableCharacterKey(ch);
      const u = String(imageUrl || "").trim();
      if (!u) return;
      const ok = window.confirm(
        `Impostare come master ufficiale di progetto per «${ch.name}» questa immagine?\n\n` +
          `È il fotogramma attuale della scena (non un ritratto isolato). Sostituisce il master attivo in tutti i capitoli per le nuove generazioni e identity lock; le scene già generate non si aggiornano da sole.\n\n` +
          `Confermi?`
      );
      if (!ok) return;
      const { nextPcm } = promoteCanonicalProjectCharacterMaster(plan, projectCharacterMastersRef.current, ch, u, {
        source: PCM_SOURCE_USER_CANONICAL_LOCK,
        approved: true,
      });
      const now = new Date().toISOString();
      commitProjectCharacterMastersSync(nextPcm, "promote_scene_frame_to_canonical");
      setCharacterApprovalMap((prev) => ({
        ...prev,
        [pcmKey]: {
          approved: true,
          approvedAt: now,
          version: (prev[pcmKey]?.version ?? 0) + 1,
        },
      }));
      addLog(`${CANONICAL_PCM_LOG} promote_scene_frame «${ch.name}» ← ${shortUrl(u, 72)}`);
    },
    [plan, finalMontagePhase, scenografiaVideoPhase, commitProjectCharacterMastersSync, addLog]
  );

  const applyMasterCanonicalSwap = useCallback(() => {
    const masterToolsLocked =
      finalMontagePhase === "assembly" ||
      finalMontagePhase === "done" ||
      scenografiaVideoPhase === "completed";
    if (!plan || masterToolsLocked) return;
    const a = findPlanCharacterByLocalId(plan, masterToolSwapA);
    const b = findPlanCharacterByLocalId(plan, masterToolSwapB);
    if (!a || !b || a.id === b.id) return;
    const ok = window.confirm(
      `Scambiare i master canonici tra «${a.name}» e «${b.name}»?\n\n` +
        `Le approvazioni per entrambi verranno azzerate (da riapprovare).`,
    );
    if (!ok) return;
    const { nextPcm, ka, kb } = swapCanonicalProjectCharacterMasters(plan, projectCharacterMastersRef.current, a, b);
    commitProjectCharacterMastersSync(nextPcm, "manual_swap_canonical_rows");
    setCharacterApprovalMap((prev) => ({
      ...prev,
      [ka]: { approved: false, approvedAt: null, version: (prev[ka]?.version ?? 0) + 1 },
      [kb]: { approved: false, approvedAt: null, version: (prev[kb]?.version ?? 0) + 1 },
    }));
    addLog(`${CANONICAL_PCM_LOG} manual_swap «${a.name}» ↔ «${b.name}»`);
  }, [
    plan,
    finalMontagePhase,
    scenografiaVideoPhase,
    masterToolSwapA,
    masterToolSwapB,
    commitProjectCharacterMastersSync,
    addLog,
  ]);

  const applyMasterCanonicalCopy = useCallback(() => {
    const masterToolsLocked =
      finalMontagePhase === "assembly" ||
      finalMontagePhase === "done" ||
      scenografiaVideoPhase === "completed";
    if (!plan || masterToolsLocked) return;
    const fromC = findPlanCharacterByLocalId(plan, masterToolCopyFrom);
    const toC = findPlanCharacterByLocalId(plan, masterToolCopyTo);
    if (!fromC || !toC || fromC.id === toC.id) return;
    const ok = window.confirm(
      `Copiare il master canonico di «${fromC.name}» su «${toC.name}»?\n\n` +
        `Il volto sorgente resta invariato; la destinazione va in revisione manuale e va riapprovata.`,
    );
    if (!ok) return;
    const { nextPcm, kt } = reassignCanonicalMasterToCharacter(plan, projectCharacterMastersRef.current, fromC, toC, {
      clearSource: false,
      markPendingReview: true,
      resetApprovalOnTarget: true,
    });
    commitProjectCharacterMastersSync(nextPcm, "manual_reassign_copy_canonical");
    setCharacterApprovalMap((prev) => ({
      ...prev,
      [kt]: { approved: false, approvedAt: null, version: (prev[kt]?.version ?? 0) + 1 },
    }));
    addLog(`${CANONICAL_PCM_LOG} manual_reassign_copy ${fromC.name} → ${toC.name}`);
  }, [
    plan,
    finalMontagePhase,
    scenografiaVideoPhase,
    masterToolCopyFrom,
    masterToolCopyTo,
    commitProjectCharacterMastersSync,
    addLog,
  ]);

  const shortDescription = useMemo(
    () => buildNarrativeHeaderDescription(plan, deletedSceneIds),
    [plan, deletedSceneIds]
  );
  const planLoglineIt = useMemo(() => resolveItalianPlanLogline(plan), [plan]);
  const titlePlaceholder = useMemo(() => fallbackProjectTitlePlaceholder(plan, prompt), [plan, prompt]);
  const scenesInPlanHeader = useMemo(() => {
    if (!plan?.scenes?.length) return 0;
    const del = new Set(deletedSceneIds || []);
    return plan.scenes.filter((s) => !del.has(s.id)).length;
  }, [plan, deletedSceneIds]);

  const sceneResultsInPlanOrder = useMemo(
    () => reorderSceneResultsArray(sceneResults, plan, deletedSceneIds),
    [sceneResults, plan, deletedSceneIds],
  );

  useEffect(() => {
    if (!persistReady || !plan) return;
    const del = new Set(deletedSceneIds || []);
    const ordered = sceneResultsInPlanOrder;
    const byId = Object.fromEntries((sceneResults || []).map((r) => [r.sceneId, r]));
    const planScenes = (plan.scenes || []).filter((s) => s?.id && !del.has(s.id));
    const lines = [
      "[SCENE GENERATE · UI lista card (fonte render + motivi esclusione)]",
      `  sceneResults (state) len=${sceneResults.length} ids=${JSON.stringify(sceneResults.map((r) => r?.sceneId))}`,
      `  sceneResultsInPlanOrder len=${ordered.length} ids=${JSON.stringify(ordered.map((r) => r?.sceneId))}`,
      "  card (ordine render):",
      ...ordered.map((r, i) => {
        const thumb = resolveSceneThumbnailUrl(r);
        return `    [${i}] sceneId=${r.sceneId} title=${JSON.stringify(r.title || "")} thumb_src=${shortUrlForSceneLog(thumb)}`;
      }),
      "  ogni scena del piano (attiva):",
    ];
    for (const s of planScenes) {
      const r = byId[s.id];
      if (!r) {
        lines.push(
          `    ${s.id} title=${JSON.stringify(s.title_it || "")}: ESCLUSO — nessuna riga sceneResults (filtro: no row / non ancora generata)`,
        );
        continue;
      }
      const thumb = resolveSceneThumbnailUrl(r);
      if (!thumb) {
        lines.push(
          `    ${s.id} title=${JSON.stringify(s.title_it || "")}: ESCLUSO miniatura — riga senza imageUrl né alias (filtro: no image) | ${sceneRowDebugLine(r, del)}`,
        );
        continue;
      }
      const inOrdered = ordered.some((x) => x.sceneId === s.id);
      if (!inOrdered) {
        lines.push(
          `    ${s.id} title=${JSON.stringify(s.title_it || "")}: ANOMALIA — riga+thumb ma non in sceneResultsInPlanOrder | ${sceneRowDebugLine(r, del)}`,
        );
        continue;
      }
      lines.push(
        `    ${s.id} title=${JSON.stringify(s.title_it || "")}: IN LISTA | thumb_src=${shortUrlForSceneLog(thumb)} | ${sceneRowDebugLine(r, del)}`,
      );
    }
    console.log(lines.join("\n"));
    const tr = ordered.find((r) => shouldTraceSceneRow(r)) || (sceneResults || []).find(shouldTraceSceneRow);
    if (tr) {
      logTraceScene2Lifecycle("render lista (useEffect)", [
        `thumb card: ${shortUrlForSceneLog(resolveSceneThumbnailUrl(tr))}`,
        `in sceneResultsInPlanOrder: ${ordered.some((x) => shouldTraceSceneRow(x)) ? "sì" : "no"}`,
        `in sceneResults raw: ${(sceneResults || []).some((x) => shouldTraceSceneRow(x)) ? "sì" : "no"}`,
        `${sceneRowDebugLine(tr, del)}`,
      ]);
    }
  }, [persistReady, plan, deletedSceneIds, sceneResults, sceneResultsInPlanOrder]);

  const pipelineLocked =
    finalMontagePhase === "assembly" ||
    finalMontagePhase === "done" ||
    scenografiaVideoPhase === "completed";

  sceneReorderSyncBundleRef.current = {
    plan,
    sceneVideoClips,
    timelinePlan,
    finalMontagePlan,
    deletedSceneIds,
    sceneResults,
  };

  const reorderPlanScenesAndSyncClips = useCallback(
    (fromIdx, toIdx) => {
      if (pipelineLocked) return;
      if (fromIdx == null || toIdx == null || fromIdx === toIdx) return;
      const b = sceneReorderSyncBundleRef.current;
      if (!b.plan?.scenes?.length) return;
      const nextPlan = reorderPlanScenesImmutable(b.plan, fromIdx, toIdx);
      if (nextPlan === b.plan) return;
      const sync = syncAfterScenePlanReorder({
        plan: nextPlan,
        sceneVideoClips: b.sceneVideoClips,
        timelinePlan: b.timelinePlan,
        finalMontagePlan: b.finalMontagePlan,
        deletedSceneIds: b.deletedSceneIds,
      });
      setPlan(nextPlan);
      setSceneVideoClips(sync.sceneVideoClips);
      setTimelinePlan(sync.timelinePlan);
      setFinalMontagePlan(sync.finalMontagePlan);
      setSceneResults((sr) => reorderSceneResultsArray(sr, nextPlan, b.deletedSceneIds));
    },
    [pipelineLocked],
  );

  const p1 = phaseUi(1);
  const p2 = phaseUi(2);
  const p3 = phaseUi(3);
  const p4 = phaseUi(4);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "0 24px 24px" }}>
      {/* ── Header dettaglio capitolo (dentro progetto narrativo) ── */}
      <div
        style={{
          marginBottom: 20,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          paddingBottom: 16,
          borderBottom: `1px solid ${AX.border}`,
        }}
      >
        <div style={{ flex: "1 1 280px", minWidth: 0, maxWidth: "min(100%, 560px)" }}>
          {workspaceNarrativeTitle ? (
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: AX.text2,
                marginBottom: 8,
                letterSpacing: "-0.01em",
              }}
            >
              {workspaceNarrativeTitle}
            </div>
          ) : null}
          <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            Titolo capitolo
          </div>
          <input
            type="text"
            value={projectTitle}
            onChange={(e) => setProjectTitle(e.target.value)}
            placeholder={titlePlaceholder}
            disabled={pipelineLocked}
            aria-label="Titolo capitolo scenografico"
            style={{
              width: "100%",
              maxWidth: 480,
              boxSizing: "border-box",
              padding: "9px 12px",
              borderRadius: 10,
              border: `1px solid ${AX.border}`,
              background: AX.surface,
              color: AX.text,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              outline: "none",
              opacity: pipelineLocked ? 0.65 : 1,
            }}
          />
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, rowGap: 6 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: AX.electric,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: 6,
                background: "rgba(41,182,255,0.1)",
                border: `1px solid rgba(41,182,255,0.25)`,
              }}
            >
              Capitolo {chapterOrdinal}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                color: AX.electric,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: 6,
                background: "rgba(41,182,255,0.1)",
                border: `1px solid rgba(41,182,255,0.25)`,
              }}
            >
              {scenesInPlanHeader === 1 ? "1 scena in piano" : `${scenesInPlanHeader} scene in piano`}
            </span>
            {projectStyle?.label && String(projectStyle.label).trim() && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: AX.electric,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "rgba(41,182,255,0.1)",
                  border: `1px solid rgba(41,182,255,0.25)`,
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={String(projectStyle.label).trim()}
              >
                {String(projectStyle.label).trim()}
              </span>
            )}
            {projectUiStatus !== "clip_approval" && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: "rgba(123,77,255,0.12)",
                  color: AX.violet,
                  border: `1px solid rgba(123,77,255,0.28)`,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={SCENOGRAFIA_UI_STATUS_LABEL[projectUiStatus] || projectUiStatus}
              >
                {SCENOGRAFIA_UI_STATUS_LABEL[projectUiStatus] || projectUiStatus}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 12, marginBottom: 4 }}>
            Descrizione breve
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: shortDescription ? AX.text2 : AX.muted,
              lineHeight: 1.45,
              whiteSpace: "pre-line",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              fontStyle: shortDescription ? "normal" : "italic",
            }}
          >
            {shortDescription || "Deriva dal prompt narrativo o dal riassunto del piano dopo «Analizza prompt»."}
          </p>
        </div>
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          {scenografiaVideoPhase === "production" && (
            <button
              type="button"
              onClick={() => void handleMarkVideoCompleted()}
              disabled={sceneExecuteBlocked}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${AX.border}`,
                background: AX.surface,
                color: AX.text2,
                fontWeight: 600,
                fontSize: 11,
                cursor: sceneExecuteBlocked ? "not-allowed" : "pointer",
              }}
            >
              Video libero: completato
            </button>
          )}
          {finalMontagePhase === "assembly" && (
            <button
              type="button"
              onClick={() => void handleMarkFinalMontageDone()}
              disabled={sceneExecuteBlocked}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${AX.electric}`,
                background: AX.surface,
                color: AX.electric,
                fontWeight: 700,
                fontSize: 11,
                cursor: sceneExecuteBlocked ? "not-allowed" : "pointer",
              }}
            >
              Montaggio: completato
            </button>
          )}
        </div>
      </div>

      {pipelineLocked && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 10,
            border: `1px solid rgba(41,182,255,0.35)`,
            background: "rgba(41,182,255,0.08)",
            fontSize: 12,
            color: AX.text2,
            fontWeight: 600,
          }}
        >
          {finalMontagePhase === "assembly"
            ? "Montaggio filmato finale in corso: modifica a character, scene e clip disabilitata. Il motore di auto-montaggio verrà collegato a questa fase."
            : finalMontagePhase === "done" || scenografiaVideoPhase === "completed"
              ? "Progetto completato: modifica disabilitata."
              : "Modifica disabilitata."}
        </div>
      )}

      {plan && (
        <div
          style={{
            marginBottom: 16,
            padding: 14,
            borderRadius: 12,
            border: `1px solid rgba(59,130,246,0.35)`,
            background: "rgba(30,58,138,0.12)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: AX.electric,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            Verso il film finito
          </div>
          <div style={{ fontSize: 11, color: AX.muted, lineHeight: 1.45, marginBottom: 8 }}>
            <strong style={{ color: AX.text2 }}>Stato reale del capitolo</strong> (clip, timeline, montaggio). Non è l&apos;anteprima del
            wizard «da traccia»: quella resta una proposta finché non confermi qui.
          </div>
          <div style={{ fontSize: 13, color: AX.text, fontWeight: 700, lineHeight: 1.45, marginBottom: 8 }}>
            {completionGaps.headline}
          </div>
          <div style={{ fontSize: 12, color: AX.text2, lineHeight: 1.5, marginBottom: 10 }}>
            <strong style={{ color: AX.text }}>Prossimo passo consigliato:</strong> {completionGaps.nextStep}
          </div>
          {completionGaps.items.filter((x) => !x.ok).length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: AX.muted, lineHeight: 1.55 }}>
              {completionGaps.items
                .filter((x) => !x.ok)
                .slice(0, 7)
                .map((x, i) => (
                  <li key={`${x.label}-${i}`} style={{ marginBottom: 6 }}>
                    <span style={{ color: AX.text2 }}>{x.label}</span>
                    {x.deepLink ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          disabled={pipelineLocked}
                          onClick={() => applyRecoveryDeepLink(x.deepLink)}
                          style={{
                            background: "none",
                            border: "none",
                            color: AX.electric,
                            cursor: pipelineLocked ? "not-allowed" : "pointer",
                            textDecoration: "underline",
                            padding: 0,
                            font: "inherit",
                            fontWeight: 700,
                          }}
                        >
                          Apri il passaggio
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
            </ul>
          ) : (
            <div style={{ fontSize: 11, color: AX.muted }}>Controlli principali ok — passa al montaggio o alla consegna finale.</div>
          )}
        </div>
      )}

      {persistReady &&
        (plan || sceneResults.length > 0 || Object.keys(masterImages).length > 0 || Object.keys(masterByCharName).length > 0) && (
          <div
            style={{
              marginBottom: 14,
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(41,182,255,0.08)",
              border: `1px solid rgba(41,182,255,0.25)`,
              fontSize: 12,
              color: AX.text2,
              lineHeight: 1.5,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ color: AX.electric }}>Progetto scenografico attivo</strong>
              {" — "}
              master, scene generate, piano e stile restano finché non scegli «Nuovo progetto / Scarta tutto».
              {lastSavedAt && (
                <span style={{ display: "block", marginTop: 6, fontSize: 11, color: AX.muted }}>
                  Ultimo salvataggio locale: {new Date(lastSavedAt).toLocaleString()}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setExecutionLogModalOpen(true)}
              aria-label="Apri registro attività e log di esecuzione"
              title="Registro attività"
              style={{
                flexShrink: 0,
                marginTop: 2,
                padding: 4,
                border: "none",
                borderRadius: 10,
                background: "transparent",
                color: AX.electric,
                cursor: "pointer",
                lineHeight: 0,
                opacity: 0.92,
              }}
            >
              <HiInformationCircle size={22} aria-hidden />
            </button>
          </div>
        )}

      {/* FASE 1 — Generazione Trama */}
      <div
        style={{ ...p1.shell, ...p1.shellHover(hoveredPhase === 1) }}
        onMouseEnter={() => setHoveredPhase(1)}
        onMouseLeave={() => setHoveredPhase(null)}
      >
        <div aria-hidden style={p1.topHairline} />
        <div style={p1.head}>
          <div style={p1.kickerRow}>
            <span style={p1.stepBadge}>{p1.step}</span>
            <div style={p1.kicker}>Trama narrativa</div>
          </div>
          <h2 style={p1.title}>Generazione Trama</h2>
          <p style={p1.sub}>
            Prompt narrativo, piano LLM, cast previsto e direzione artistica: tutto ciò che serve per leggere la storia
            prima di costruire volti e inquadrature.
          </p>
        </div>
        <div style={p1.body}>
          <textarea
            ref={promptTextareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Descrivi la scena, la storia, i personaggi e l'ambientazione in italiano…"
            disabled={planning || sceneExecuteBlocked || pipelineLocked}
            style={{
              width: "100%",
              minHeight: PROMPT_TEXTAREA_MIN_PX,
              maxHeight: PROMPT_TEXTAREA_MAX_PX,
              padding: "16px 18px",
              borderRadius: 12,
              border: `1px solid ${AX.border}`,
              background: AX.surface,
              color: AX.text,
              fontSize: 15,
              lineHeight: 1.62,
              fontFamily: "inherit",
              resize: "vertical",
              boxSizing: "border-box",
              outline: "none",
              transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = AX.electric;
              e.target.style.boxShadow = `0 0 0 1px ${AX.electric}40`;
            }}
            onBlur={(e) => {
              e.target.style.borderColor = AX.border;
              e.target.style.boxShadow = "none";
            }}
          />
          {planError && (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: 13 }}>
              {planError}
            </div>
          )}
          {plan &&
            (!executing ||
              scenografiaPhase === "character_gen" ||
              scenografiaPhase === "scene_gen" ||
              sceneGenFlightActive) && (
          <>
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${AX.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Piano narrativo
            </div>
          {planLoglineIt && (
            <p style={{ fontSize: 13, color: AX.text2, marginBottom: 14, lineHeight: 1.5 }}>{planLoglineIt}</p>
          )}

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              Personaggi nel piano
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {plan.characters.map((char) => {
                const roleLab = characterRoleLabelIt(char);
                const needs = masterNeedingIds.has(char.id);
                return (
                  <div
                    key={char.id}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: `1px solid ${AX.border}`,
                      fontSize: 12,
                      color: AX.text,
                      background: AX.surface,
                    }}
                  >
                    <HiUser size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                    <strong>{char.name}</strong>
                    {roleLab ? <span style={{ color: AX.muted, marginLeft: 6, fontSize: 11 }}>· {roleLab.toLowerCase()}</span> : null}
                    <span style={{ color: needs ? AX.magenta : AX.muted, marginLeft: 6, fontSize: 10, fontWeight: 700 }}>
                      {needs ? "master richiesto" : "nessun master"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Scene pianificate
            </div>
            <p style={{ fontSize: 12, color: AX.text2, margin: "0 0 8px", lineHeight: 1.5 }}>
              <strong style={{ color: AX.text }}>{plan.scenes.length}</strong> momenti nel piano. Ordine narrativo, checkbox di
              batch e immagini sono gestiti nella <strong style={{ color: AX.electric }}>FASE 3</strong>.
            </p>
            <ol style={{ margin: 0, paddingLeft: 18, color: AX.text2, fontSize: 12, lineHeight: 1.55 }}>
              {plan.scenes.map((s) => (
                <li key={s.id}>
                  <span style={{ color: AX.text, fontWeight: 600 }}>{s.title_it}</span>{" "}
                  <span style={{ fontSize: 10, color: AX.muted }}>({sceneTypeUiLabelIt(s)})</span>
                </li>
              ))}
            </ol>
          </div>

          {projectStyle && imageStylePresets.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${AX.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Stile progetto
              </div>
              <div style={{ fontSize: 13, color: AX.text, marginBottom: 8 }}>
                Preset: <strong style={{ color: AX.electric }}>{projectStyle.label}</strong>
                {projectStyle.isAnimated && <span style={{ marginLeft: 8, fontSize: 11, color: AX.magenta }}>(output animato / stilizzato)</span>}
              </div>
              <label style={{ fontSize: 11, color: AX.text2, display: "block", marginBottom: 6 }}>
                Cambia preset (solo in fase Piano, prima dei master)
              </label>
              <select
                value={projectStyle.presetId}
                disabled={projectStyleLocked || sceneExecuteBlocked || scenografiaPhase !== "plan" || pipelineLocked}
                onChange={(e) => applyPresetChoice(e.target.value)}
                style={{
                  width: "100%",
                  maxWidth: 420,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${AX.border}`,
                  background: AX.surface,
                  color: AX.text,
                  fontSize: 13,
                  cursor: projectStyleLocked || sceneExecuteBlocked || scenografiaPhase !== "plan" || pipelineLocked ? "not-allowed" : "pointer",
                }}
              >
                {imageStylePresets.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <p style={{ fontSize: 11, color: AX.muted, marginTop: 8, lineHeight: 1.4 }}>
                Una sola direzione artistica per master, scene e identity lock.
              </p>
            </div>
          )}
          </div>
          </>
          )}
        </div>
        <div style={p1.footer}>
          <button
            type="button"
            onClick={() => handlePlan(false)}
            disabled={!prompt.trim() || planning || sceneExecuteBlocked || pipelineLocked}
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              border: "none",
              background: AX.gradPrimary,
              color: "#fff",
              fontWeight: 700,
              fontSize: 12,
              cursor: !prompt.trim() || planning || sceneExecuteBlocked || pipelineLocked ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 6px 20px rgba(41,182,255,0.2)",
              opacity: !prompt.trim() || planning || sceneExecuteBlocked || pipelineLocked ? 0.5 : 1,
            }}
            title="Analizza il prompt e costruisci / aggiorna il piano narrativo"
          >
            {planning ? (
              <>
                <div
                  style={{
                    width: 12,
                    height: 12,
                    border: "2px solid rgba(255,255,255,0.35)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                Analisi…
              </>
            ) : (
              <>
                <HiSparkles size={15} /> Analizza prompt
              </>
            )}
          </button>
          {plan && (
            <>
              <button
                type="button"
                onClick={handlePlanContinue}
                disabled={!prompt.trim() || planning || sceneExecuteBlocked || pipelineLocked}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: `1px solid ${AX.violet}`,
                  background: AX.surface,
                  color: AX.violet,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: !prompt.trim() || planning || sceneExecuteBlocked || pipelineLocked ? "not-allowed" : "pointer",
                  opacity: !prompt.trim() || planning || sceneExecuteBlocked || pipelineLocked ? 0.45 : 1,
                }}
                title="Aggiunge sviluppi al piano senza cancellare le scene già presenti se restano valide"
              >
                <HiPlus size={14} /> Estendi piano
              </button>
              <button
                type="button"
                onClick={() => handlePlan(true)}
                disabled={!prompt.trim() || planning || pipelineLocked || !hasPreservableMasters}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: `1px solid ${AX.border}`,
                  background: AX.surface,
                  color: AX.text2,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor:
                    !prompt.trim() || planning || pipelineLocked || !hasPreservableMasters ? "not-allowed" : "pointer",
                  opacity: !prompt.trim() || planning || pipelineLocked || !hasPreservableMasters ? 0.45 : 1,
                }}
                title={
                  hasPreservableMasters
                    ? "Nuovo piano da prompt conservando i master esistenti dove possibile"
                    : "Disponibile dopo il primo master salvato"
                }
              >
                <HiArrowPath size={14} /> Rigenera piano
              </button>
              <button
                type="button"
                onClick={resetPlanKeepMasters}
                disabled={pipelineLocked}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: `1px solid ${AX.border}`,
                  background: AX.surface,
                  color: AX.text2,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: pipelineLocked ? "not-allowed" : "pointer",
                  opacity: pipelineLocked ? 0.45 : 1,
                }}
                title="Azzera piano e scene; i master restano"
              >
                <HiXMark size={14} /> Scarta piano
              </button>
              <button
                type="button"
                onClick={openNewProjectConfirm}
                disabled={pipelineLocked}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "1px solid rgba(239,68,68,0.5)",
                  background: "rgba(239,68,68,0.06)",
                  color: "#f87171",
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: pipelineLocked ? "not-allowed" : "pointer",
                  opacity: pipelineLocked ? 0.45 : 1,
                }}
                title="Elimina l'intero progetto scenografico"
              >
                <HiXMark size={14} /> Elimina progetto
              </button>
            </>
          )}
        </div>
      </div>

      {/* FASE 2 — Generazione Personaggi */}
      {plan && (
        <div
          id="ax-scenografie-anchor-cast"
          style={{ ...p2.shell, ...p2.shellHover(hoveredPhase === 2) }}
          onMouseEnter={() => setHoveredPhase(2)}
          onMouseLeave={() => setHoveredPhase(null)}
        >
          <div aria-hidden style={p2.topHairline} />
          <div style={p2.head}>
            <div style={p2.kickerRow}>
              <span style={p2.stepBadge}>{p2.step}</span>
              <div style={p2.kicker}>Cast e volti</div>
            </div>
            <h2 style={p2.title}>Generazione Personaggi</h2>
            <p style={p2.sub}>
              Narratori di progetto (voce ElevenLabs, senza volto) e sotto il cast con master immagine. Voice master
              ElevenLabs sotto ogni personaggio.
            </p>
          </div>
          <div style={p2.body}>
            <div style={{ marginBottom: 28 }} id="ax-scenografie-anchor-narrators">
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: AX.muted,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 10,
                }}
              >
                Narratori
              </div>
              <ScenografieNarratorSection
                ax={AX}
                narrators={projectNarrators}
                onChangeNarrators={setProjectNarrators}
                disabled={pipelineLocked || sceneExecuteBlocked}
              />
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: AX.muted,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 12,
              }}
            >
              Personaggi · master volto
            </div>
            {getCharactersNeedingMaster(plan).length === 0 ? (
              <p style={{ fontSize: 13, color: AX.text2, margin: 0, lineHeight: 1.55 }}>
                Nessun personaggio di questo piano richiede un master immagine dedicato.
              </p>
            ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 16,
              }}
            >
              {getCharactersNeedingMaster(plan).map((char) => {
                const url = getDisplayMasterUrl(char, projectCharacterMasters);
                const ap = approvalEntryForCharacter(characterApprovalMap, char);
                const approved = ap?.approved === true;
                const masterGate = { projectCharacterMasters, characterApprovalMap };
                const readyForScenes = characterMasterReadyForScenes(char, masterGate);
                const masterInFlight =
                  regeneratingCharId === char.id ||
                  (executing && scenografiaPhase === "character_gen" && batchMasterCharId === char.id);
                /** Overlay solo sulla card con master in generazione/rigenerazione (non durante scene pipeline). */
                const showCharCardOverlay = masterInFlight;
                /** Disabilita controlli durante batch scene, batch master, o rigenerazione su un’altra card. */
                const charCardControlsLocked =
                  masterInFlight ||
                  sceneExecuteBlocked ||
                  (regeneratingCharId != null && regeneratingCharId !== char.id);
                const hasMaster = !!url;
                const cardBorder = readyForScenes
                  ? AX.electric
                  : hasMaster && approved && !readyForScenes
                    ? "rgba(245,158,11,0.7)"
                    : hasMaster
                      ? AX.border
                      : "rgba(255,79,163,0.55)";
                const roleLab = characterRoleLabelIt(char);
                const statusLineNoRole = masterInFlight
                  ? "In lavorazione"
                  : readyForScenes
                    ? "Approvato · pronto per scene e lock"
                    : hasMaster && approved && !readyForScenes
                      ? "Approvato in UI ma non ammesso in pipeline (revisione / sorgente master)"
                      : hasMaster
                        ? "Master in PCM — approva per sbloccare scene"
                        : "In attesa";
                return (
                  <div
                    key={char.id}
                    className={!hasMaster ? "ax-scen-char-placeholder" : undefined}
                    style={{
                      borderRadius: 14,
                      overflow: "hidden",
                      border: `2px solid ${cardBorder}`,
                      background: AX.surface,
                    }}
                  >
                    <div
                      style={{
                        aspectRatio: "9/16",
                        maxHeight: 360,
                        width: "100%",
                        background: AX.bg,
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}
                    >
                      {hasMaster ? (
                        <>
                          <img
                            src={url}
                            alt={char.name}
                            style={{
                              maxWidth: "100%",
                              maxHeight: "100%",
                              width: "auto",
                              height: "auto",
                              objectFit: "contain",
                              objectPosition: "center center",
                              display: "block",
                            }}
                          />
                        </>
                      ) : (
                        <div
                          style={{
                            height: "100%",
                            minHeight: 200,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 10,
                            padding: 20,
                            textAlign: "center",
                            color: AX.muted,
                            fontSize: 13,
                            lineHeight: 1.45,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 900,
                              letterSpacing: "0.12em",
                              textTransform: "uppercase",
                              padding: "4px 10px",
                              borderRadius: 999,
                              background: "rgba(255,79,163,0.18)",
                              color: "#fda4cf",
                              border: "1px solid rgba(255,79,163,0.45)",
                            }}
                          >
                            Mancante
                          </span>
                          <HiUser size={32} style={{ opacity: 0.55 }} />
                          <span style={{ fontWeight: 800, color: AX.text, fontSize: 14 }}>Personaggio da generare</span>
                          <span style={{ fontSize: 12, color: AX.text2 }}>
                            Nessun master progetto per questo ruolo. Genera una volta: sarà riusato in tutti i capitoli che lo richiedono.
                          </span>
                        </div>
                      )}
                      {showCharCardOverlay && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: "rgba(0,0,0,0.45)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: AX.text,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          Aggiornamento…
                        </div>
                      )}
                    </div>
                    <div style={{ padding: "12px 14px 14px", textAlign: "center" }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: AX.text, marginBottom: 4, lineHeight: 1.35 }}>
                        {char.name}
                      </div>
                      <div style={{ marginBottom: 10, lineHeight: 1.45 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: roleLab ? 600 : 800,
                            letterSpacing: roleLab ? "0" : "0.04em",
                            color: roleLab
                              ? char.character_role === CHARACTER_ROLE.RECURRING
                                ? AX.violet
                                : AX.electric
                              : approved
                                ? AX.electric
                                : hasMaster
                                  ? AX.text2
                                  : AX.muted,
                          }}
                        >
                          {roleLab || statusLineNoRole}
                        </div>
                        {approved && ap?.approvedAt ? (
                          <div style={{ fontSize: 10, color: AX.muted, marginTop: 4 }}>
                            {new Date(ap.approvedAt).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {!hasMaster ? (
                          <button
                            type="button"
                            onClick={() => void generateOrRegenerateCharacterMaster(char.id)}
                            disabled={charCardControlsLocked || pipelineLocked}
                            style={{
                              flex: 1,
                              minWidth: 140,
                              padding: "9px 14px",
                              borderRadius: 10,
                              border: "none",
                              background: charCardControlsLocked || pipelineLocked ? AX.border : AX.gradPrimary,
                              color: "#fff",
                              fontWeight: 700,
                              fontSize: 12,
                              letterSpacing: "0.02em",
                              cursor: charCardControlsLocked || pipelineLocked ? "not-allowed" : "pointer",
                              opacity: charCardControlsLocked || pipelineLocked ? 0.55 : 1,
                              boxShadow: charCardControlsLocked || pipelineLocked ? "none" : "0 4px 18px rgba(41,182,255,0.25)",
                            }}
                          >
                            <HiSparkles size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                            Genera personaggio
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void generateOrRegenerateCharacterMaster(char.id)}
                            disabled={charCardControlsLocked || pipelineLocked}
                            style={{
                              flex: 1,
                              minWidth: 120,
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: `1px solid ${AX.violet}`,
                              background: "transparent",
                              color: AX.violet,
                              fontWeight: 700,
                              fontSize: 12,
                              cursor: charCardControlsLocked || pipelineLocked ? "not-allowed" : "pointer",
                              opacity: charCardControlsLocked || pipelineLocked ? 0.45 : 1,
                            }}
                          >
                            <HiArrowPath size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                            Rigenera personaggio
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const row = pcmRowForCharacter(projectCharacterMasters, char);
                            setMasterPromptDraft(
                              typeof row?.characterMasterPrompt === "string" ? row.characterMasterPrompt : ""
                            );
                            setMasterPromptModalCharId(char.id);
                          }}
                          disabled={charCardControlsLocked || pipelineLocked}
                          title="Come vuoi vedere questo personaggio"
                          style={{
                            flex: 1,
                            minWidth: 120,
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: `1px solid ${AX.border}`,
                            background: AX.surface,
                            color: AX.text2,
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: charCardControlsLocked || pipelineLocked ? "not-allowed" : "pointer",
                            opacity: charCardControlsLocked || pipelineLocked ? 0.45 : 1,
                          }}
                        >
                          <HiPencilSquare size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                          Modifica
                        </button>
                        <button
                          type="button"
                          onClick={() => approveProtagonistMaster(char.id)}
                          disabled={!hasMaster || approved || charCardControlsLocked || pipelineLocked}
                          style={{
                            flex: 1,
                            minWidth: 120,
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "none",
                            background: approved ? AX.border : AX.gradPrimary,
                            color: approved ? AX.muted : "#fff",
                            fontWeight: 700,
                            fontSize: 12,
                            cursor:
                              !hasMaster || approved || charCardControlsLocked || pipelineLocked
                                ? "not-allowed"
                                : "pointer",
                            opacity:
                              !hasMaster || approved || charCardControlsLocked || pipelineLocked ? 0.55 : 1,
                          }}
                        >
                          <HiCheck size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                          Approva personaggio
                        </button>
                      </div>
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${AX.border}`, textAlign: "left" }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                          <HiMicrophone size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                          Voice master · ElevenLabs (catalogo API + preset IT)
                        </div>
                        {(() => {
                          const vRaw = voiceMasterRawForRef(characterVoiceMasters, char.id, plan);
                          const vm = normalizeCharacterVoiceMaster(vRaw, stableCharacterKey(char));
                          return (
                            <>
                              <ScenografieCharacterVoicePicker
                                ax={AX}
                                vm={vm}
                                disabled={charCardControlsLocked || pipelineLocked}
                                onAssign={(partial) => patchCharacterVoiceMaster(char.id, partial)}
                              />
                              <label
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  fontSize: 11,
                                  color: AX.text2,
                                  cursor: charCardControlsLocked || pipelineLocked ? "not-allowed" : "pointer",
                                  marginTop: 10,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={vm.isNarratorDefault}
                                  disabled={charCardControlsLocked || pipelineLocked}
                                  onChange={(e) => patchCharacterVoiceMaster(char.id, { isNarratorDefault: e.target.checked })}
                                />
                                Default narratore progetto (compatibile con narratore dedicato in roadmap)
                              </label>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
            {getCharactersNeedingMaster(plan).length > 0 ? (
              <details
                style={{
                  marginTop: 20,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${AX.border}`,
                  background: AX.bg,
                }}
              >
                <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 12, color: AX.text }}>
                  Correzione master canonici (PCM)
                </summary>
                <p style={{ fontSize: 11, color: AX.text2, lineHeight: 1.5, margin: "10px 0 12px" }}>
                  Operano solo su <strong>projectCharacterMasters</strong>; le mappe legacy si rigenerano in automatico.
                  Dopo swap o copia, riapprova le card interessate.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: AX.text2 }}>Scambia master tra</span>
                  <select
                    value={masterToolSwapA}
                    onChange={(e) => setMasterToolSwapA(e.target.value)}
                    style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${AX.border}`, background: AX.surface, color: AX.text, fontSize: 11 }}
                  >
                    <option value="">—</option>
                    {getCharactersNeedingMaster(plan).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: AX.text2 }}>e</span>
                  <select
                    value={masterToolSwapB}
                    onChange={(e) => setMasterToolSwapB(e.target.value)}
                    style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${AX.border}`, background: AX.surface, color: AX.text, fontSize: 11 }}
                  >
                    <option value="">—</option>
                    {getCharactersNeedingMaster(plan).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={applyMasterCanonicalSwap}
                    disabled={
                      !masterToolSwapA ||
                      !masterToolSwapB ||
                      masterToolSwapA === masterToolSwapB ||
                      pipelineLocked
                    }
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: `1px solid ${AX.violet}`,
                      background: "transparent",
                      color: AX.violet,
                      fontWeight: 700,
                      fontSize: 11,
                      cursor: pipelineLocked ? "not-allowed" : "pointer",
                      opacity: pipelineLocked ? 0.45 : 1,
                    }}
                  >
                    Scambia
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: AX.text2 }}>Copia master di</span>
                  <select
                    value={masterToolCopyFrom}
                    onChange={(e) => setMasterToolCopyFrom(e.target.value)}
                    style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${AX.border}`, background: AX.surface, color: AX.text, fontSize: 11 }}
                  >
                    <option value="">—</option>
                    {getCharactersNeedingMaster(plan).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: AX.text2 }}>su</span>
                  <select
                    value={masterToolCopyTo}
                    onChange={(e) => setMasterToolCopyTo(e.target.value)}
                    style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${AX.border}`, background: AX.surface, color: AX.text, fontSize: 11 }}
                  >
                    <option value="">—</option>
                    {getCharactersNeedingMaster(plan).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={applyMasterCanonicalCopy}
                    disabled={
                      !masterToolCopyFrom ||
                      !masterToolCopyTo ||
                      masterToolCopyFrom === masterToolCopyTo ||
                      pipelineLocked
                    }
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: `1px solid ${AX.border}`,
                      background: AX.surface,
                      color: AX.text,
                      fontWeight: 700,
                      fontSize: 11,
                      cursor: pipelineLocked ? "not-allowed" : "pointer",
                      opacity: pipelineLocked ? 0.45 : 1,
                    }}
                  >
                    Copia su destinazione
                  </button>
                </div>
              </details>
            ) : null}
          </div>
          <div style={p2.footer}>
            {scenografiaPhase === "plan" && projectStyle && mastersStillMissingForPlan > 0 && (
              <button
                type="button"
                onClick={runProtagonistMastersBatch}
                disabled={sceneExecuteBlocked || planning || pipelineLocked}
                style={{
                  padding: "9px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: AX.gradPrimary,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: sceneExecuteBlocked || planning || pipelineLocked ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: sceneExecuteBlocked || planning || pipelineLocked ? 0.55 : 1,
                  boxShadow: "0 6px 20px rgba(41,182,255,0.2)",
                }}
              >
                <HiUser size={14} /> Genera master mancanti
              </button>
            )}
          </div>
        </div>
      )}

      {/* FASE 3 — Generazione Scene */}
      {plan && (
        <div
          id="ax-scenografie-anchor-scenes"
          style={{ ...p3.shell, ...p3.shellHover(hoveredPhase === 3) }}
          onMouseEnter={() => setHoveredPhase(3)}
          onMouseLeave={() => setHoveredPhase(null)}
        >
          <div aria-hidden style={p3.topHairline} />
          <div style={p3.head}>
            <div style={p3.kickerRow}>
              <span style={p3.stepBadge}>{p3.step}</span>
              <div style={p3.kicker}>Scene e immagini</div>
            </div>
            <h2 style={p3.title}>Generazione Scene</h2>
            <p style={p3.sub}>
              Ordine del piano, selezione per batch, immagini e revisione fine sulle singole card (Approva, Modifica,
              Rigenera, Elimina).
            </p>
          </div>
          <div style={p3.body}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: AX.text2, cursor: "pointer", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={enableRepair}
                onChange={(e) => setEnableRepair(e.target.checked)}
                style={{ accentColor: AX.electric }}
              />
              Repair pass (rifinitura volti dopo identity lock — applicato in pipeline scene)
            </label>
            {showSceneGenProgressBanner && (
              <div
                style={{
                  marginBottom: 14,
                  borderRadius: 10,
                  border: `1px solid ${AX.border}`,
                  background: AX.surface,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(280px, 1.45fr) minmax(120px, 1.55fr) auto",
                    alignItems: "stretch",
                    minHeight: 58,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 14px",
                      borderRight: `1px solid ${AX.border}`,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        flexShrink: 0,
                        border: "2px solid rgba(41,182,255,0.3)",
                        borderTopColor: AX.electric,
                        borderRadius: "50%",
                        animation: "spin 0.8s linear infinite",
                      }}
                    />
                    <div
                      style={{
                        fontSize: 13,
                        color: AX.electric,
                        fontWeight: 600,
                        lineHeight: 1.45,
                        whiteSpace: "normal",
                        wordBreak: "break-word",
                        overflowWrap: "anywhere",
                        minWidth: 0,
                      }}
                    >
                      {imageStatus || "Elaborazione…"}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      gap: 8,
                      padding: "10px 14px",
                      borderRight: `1px solid ${AX.border}`,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontSize: 11, color: AX.muted, fontWeight: 700, letterSpacing: "0.04em" }}>
                        Avanzamento
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          color: AX.text2,
                          fontWeight: 800,
                          fontVariantNumeric: "tabular-nums",
                        }}
                        aria-live="polite"
                      >
                        {Math.min(100, Math.max(0, Math.round(Number(imageProgress) || 0)))}%
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, Math.max(0, Math.round(Number(imageProgress) || 0)))}
                      style={{
                        height: 12,
                        borderRadius: 6,
                        background: "rgba(255,255,255,0.06)",
                        overflow: "hidden",
                        border: `1px solid ${AX.border}`,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(100, Math.max(0, Number(imageProgress) || 0))}%`,
                          background: `linear-gradient(90deg, ${AX.electric}, rgba(123,77,255,0.95))`,
                          borderRadius: 5,
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", padding: "10px 14px" }}>
                    <button
                      type="button"
                      onClick={handleAbort}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 6,
                        border: `1px solid rgba(239,68,68,0.45)`,
                        background: "transparent",
                        color: "#ef4444",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Interrompi
                    </button>
                  </div>
                </div>
              </div>
            )}
            {scenografiaPhase === "character_approval" && !allCharacterMastersApproved && (
              <div style={{ fontSize: 12, color: AX.magenta, fontWeight: 600, marginBottom: 12 }}>
                Approva ogni personaggio con master nella FASE 2 prima di generare le scene.
              </div>
            )}
            <h4 style={{ fontSize: 12, fontWeight: 700, color: AX.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              Elenco scene ({plan.scenes.length}) — trascina per ordine; checkbox per batch
            </h4>
            <p style={{ fontSize: 11, color: AX.text2, margin: "0 0 10px", lineHeight: 1.45 }}>
              Le checkbox alimentano «Genera scene selezionate» nel piè di fase (solo voci senza immagine).
            </p>
            {plan.scenes.map((scene, i) => (
              <div
                key={scene.id}
                draggable={!pipelineLocked && plan.scenes.length > 1}
                onDragStart={() => {
                  if (!pipelineLocked && plan.scenes.length > 1) dragPlanSceneIdxRef.current = i;
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={() => {
                  const from = dragPlanSceneIdxRef.current;
                  dragPlanSceneIdxRef.current = null;
                  if (from != null) reorderPlanScenesAndSyncClips(from, i);
                }}
                onDragEnd={() => {
                  dragPlanSceneIdxRef.current = null;
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: AX.surface,
                  border: `1px solid ${AX.border}`,
                  marginBottom: 6,
                  fontSize: 12,
                  cursor: !pipelineLocked && plan.scenes.length > 1 ? "grab" : "default",
                }}
              >
                <div style={{ fontWeight: 600, color: AX.text, marginBottom: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {!pipelineLocked && plan.scenes.length > 1 && (
                    <span style={{ color: AX.muted, display: "flex", alignItems: "center", flexShrink: 0 }} title="Trascina per riordinare le scene">
                      <HiBars3 size={16} />
                    </span>
                  )}
                  <input
                    type="checkbox"
                    checked={selectedSceneIds.includes(scene.id)}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setSelectedSceneIds((prev) =>
                        on ? [...prev, scene.id] : prev.filter((x) => x !== scene.id)
                      );
                    }}
                    style={{ accentColor: AX.magenta, flexShrink: 0 }}
                    aria-label={`Seleziona scena ${scene.title_it}`}
                  />
                  <HiPhoto size={12} style={{ flexShrink: 0 }} />
                  <span>
                    {i + 1}. {scene.title_it}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: `1px solid ${isEnvironmentScene(scene) ? "rgba(52,211,153,0.45)" : AX.border}`,
                      color: isEnvironmentScene(scene) ? "#6ee7b7" : AX.electric,
                      background: isEnvironmentScene(scene) ? "rgba(16,185,129,0.12)" : "rgba(41,182,255,0.08)",
                    }}
                  >
                    {sceneTypeUiLabelIt(scene)}
                  </span>
                </div>
                <div style={{ color: AX.text2, fontSize: 11 }}>
                  {resolveItalianSceneSummaryForDisplay(scene, plan, { maxLen: 160 })}
                </div>
              </div>
            ))}
            {sceneResults.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <h4 style={{ fontSize: 12, fontWeight: 700, color: AX.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                  Scene generate ({sceneResults.length})
                </h4>
                <p style={{ fontSize: 11, color: AX.text2, margin: "0 0 10px", lineHeight: 1.45 }}>
                  Ordine = piano; trascina le card per aggiornare clip e timeline.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {sceneResultsInPlanOrder.map((r) => {
              const thumbSrc = resolveSceneThumbnailUrl(r);
              const planSceneRow = plan?.scenes?.find((s) => s.id === r.sceneId);
              const rowIsEnvironment = planSceneRow ? isEnvironmentScene(planSceneRow) : false;
              const sceneBusy = sceneEditBusyId === r.sceneId;
              const pipelineBusy = sceneExecuteBlocked || !!sceneEditBusyId || pipelineLocked;
              const btnBase = {
                padding: "7px 8px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                cursor: pipelineBusy ? "not-allowed" : "pointer",
                opacity: pipelineBusy ? 0.5 : 1,
                border: "none",
                flex: "1 1 90px",
                minWidth: 0,
              };
              const planFromIdx = plan?.scenes ? plan.scenes.findIndex((s) => s.id === r.sceneId) : -1;
              const canDragGallery = !pipelineLocked && plan?.scenes?.length > 1 && planFromIdx >= 0;
              return (
                <div
                  key={r.sceneId}
                  id={`ax-scenografie-scene-${r.sceneId}`}
                  role="group"
                  aria-label={`Scena ${r.title}`}
                  draggable={canDragGallery}
                  onDragStart={() => {
                    if (canDragGallery) dragGallerySceneIdxRef.current = planFromIdx;
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={() => {
                    const from = dragGallerySceneIdxRef.current;
                    dragGallerySceneIdxRef.current = null;
                    if (from != null && planFromIdx >= 0) reorderPlanScenesAndSyncClips(from, planFromIdx);
                  }}
                  onDragEnd={() => {
                    dragGallerySceneIdxRef.current = null;
                  }}
                  style={{
                    borderRadius: 12,
                    overflow: "hidden",
                    border: `1px solid ${AX.border}`,
                    background: AX.card,
                    outline: sceneCardFocusId === r.sceneId ? `2px solid ${AX.electric}` : "none",
                    outlineOffset: 0,
                    cursor: canDragGallery ? "grab" : "default",
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                    minHeight: 0,
                  }}
                  onClick={() => setSceneCardFocusId(r.sceneId)}
                >
                  <div
                    style={{ position: "relative", width: "100%" }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!thumbSrc) return;
                      const u = String(thumbSrc);
                      const video =
                        u.startsWith("data:video") || /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(u);
                      setSceneImageLightbox({ url: u, title: r.title || "Scena", kind: video ? "video" : "image" });
                    }}
                  >
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={r.title}
                        style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          aspectRatio: "16/9",
                          background: AX.surface,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: AX.muted,
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        Nessuna immagine
                      </div>
                    )}
                    {r.approved && (
                      <div
                        style={{
                          position: "absolute",
                          top: 8,
                          left: 8,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 8px",
                          borderRadius: 8,
                          background: "rgba(16,120,72,0.92)",
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        <HiCheck size={12} />
                        Approvata
                      </div>
                    )}
                    {sceneBusy && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "rgba(6,6,12,0.55)",
                          color: "#fff",
                          fontSize: 13,
                          fontWeight: 700,
                        }}
                      >
                        Modifica in corso…
                      </div>
                    )}
                  </div>
                  {planSceneRow ? (() => {
                    const sem = deriveSceneOperationalSemantics(planSceneRow, chapterPayloadForOps);
                    const checklist = buildSceneChecklistRuntimeItems(planSceneRow, chapterPayloadForOps);
                    const semColor =
                      sem.key === SCENE_OPERATIONAL.SCENE_MONTAGE_READY
                        ? "#4ade80"
                        : sem.key === SCENE_OPERATIONAL.CLIP_FAILED || sem.key === SCENE_OPERATIONAL.BLOCKED_CAST
                          ? "#fb7185"
                          : sem.key === SCENE_OPERATIONAL.CLIP_RECOVERABLE ||
                              sem.key === SCENE_OPERATIONAL.CLIPS_NOT_MONTAGE_READY
                            ? "#fbbf24"
                            : AX.electric;
                    return (
                      <div
                        style={{ padding: "8px 10px", borderTop: `1px solid ${AX.border}`, background: AX.surface }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              color: semColor,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                            }}
                          >
                            Stato: {sem.labelIt}
                          </span>
                          <button
                            type="button"
                            disabled={pipelineLocked}
                            onClick={() => applyRecoveryDeepLink({ focus: "clips", sceneId: r.sceneId })}
                            style={{
                              padding: "4px 8px",
                              borderRadius: 8,
                              border: `1px solid ${AX.electric}`,
                              background: "transparent",
                              color: AX.electric,
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: pipelineLocked ? "not-allowed" : "pointer",
                            }}
                          >
                            Apri area clip
                          </button>
                        </div>
                        <details style={{ fontSize: 10, color: AX.text2 }}>
                          <summary style={{ cursor: "pointer", userSelect: "none", fontWeight: 700 }}>Checklist (dati reali)</summary>
                          <ul style={{ margin: "8px 0 0", paddingLeft: 16, lineHeight: 1.5 }}>
                            {checklist.map((it) => (
                              <li key={it.id} style={{ marginBottom: 4 }}>
                                <span style={{ color: AX.text }}>
                                  {it.state === "done" ? "✓" : it.state === "blocked" ? "!" : "○"} {it.label}
                                </span>
                                {it.hint ? (
                                  <span style={{ color: AX.muted, display: "block", marginTop: 2 }}>{it.hint}</span>
                                ) : null}
                                {it.deepLink && it.state !== "done" ? (
                                  <div style={{ marginTop: 4 }}>
                                    <button
                                      type="button"
                                      disabled={pipelineLocked}
                                      onClick={() => applyRecoveryDeepLink(it.deepLink)}
                                      style={{
                                        padding: "2px 6px",
                                        borderRadius: 6,
                                        border: `1px solid ${AX.border}`,
                                        background: AX.card,
                                        color: AX.electric,
                                        fontSize: 10,
                                        fontWeight: 700,
                                        cursor: pipelineLocked ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      Vai
                                    </button>
                                  </div>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    );
                  })() : null}
                  {(() => {
                    const baseU = r.sceneBaseUrl || r.baseImageUrl;
                    const finalU = r.sceneFinalUrl;
                    const bStr = baseU != null ? String(baseU).trim() : "";
                    const fStr = finalU != null ? String(finalU).trim() : "";
                    const distinct = Boolean(bStr && fStr && bStr !== fStr);
                    const isBase = r.sceneDisplayedVariant === SCENE_DISPLAY_VARIANT.BASE;
                    const badge = (label, on) => ({
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "4px 8px",
                      borderRadius: 8,
                      border: `1px solid ${on ? AX.electric : AX.border}`,
                      color: on ? "#fff" : AX.text2,
                      background: on ? "rgba(41,182,255,0.35)" : AX.card,
                    });
                    return (
                      <div
                        style={{
                          padding: "10px 10px 8px",
                          borderTop: `1px solid ${AX.border}`,
                          background: "rgba(129,140,248,0.07)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            color: AX.muted,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            marginBottom: 8,
                          }}
                        >
                          Variante immagine
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8, alignItems: "center" }}>
                          <span style={badge("Base", isBase)}>Base</span>
                          <span style={badge("Finale", !isBase)}>Finale</span>
                          <span style={badge(`Attiva · ${isBase ? "base" : "finale"}`, true)}>Attiva</span>
                        </div>
                        {distinct ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            <button
                              type="button"
                              disabled={pipelineBusy || isBase}
                              onClick={() => chooseSceneDisplayVariant(r.sceneId, SCENE_DISPLAY_VARIANT.BASE)}
                              style={{
                                flex: "1 1 130px",
                                padding: "8px 10px",
                                borderRadius: 10,
                                border: `1px solid ${AX.border}`,
                                background: isBase ? "rgba(41,182,255,0.2)" : AX.surface,
                                color: AX.text,
                                fontWeight: 700,
                                fontSize: 11,
                                cursor: pipelineBusy || isBase ? "not-allowed" : "pointer",
                                opacity: pipelineBusy ? 0.5 : 1,
                              }}
                            >
                              Usa scena base
                            </button>
                            <button
                              type="button"
                              disabled={pipelineBusy || !isBase}
                              onClick={() => chooseSceneDisplayVariant(r.sceneId, SCENE_DISPLAY_VARIANT.FINAL)}
                              style={{
                                flex: "1 1 130px",
                                padding: "8px 10px",
                                borderRadius: 10,
                                border: `1px solid ${AX.border}`,
                                background: !isBase ? "rgba(41,182,255,0.2)" : AX.surface,
                                color: AX.text,
                                fontWeight: 700,
                                fontSize: 11,
                                cursor: pipelineBusy || !isBase ? "not-allowed" : "pointer",
                                opacity: pipelineBusy ? 0.5 : 1,
                              }}
                            >
                              Usa scena finale
                            </button>
                          </div>
                        ) : (
                          <p style={{ fontSize: 10, color: AX.muted, margin: 0, lineHeight: 1.45 }}>
                            Base e finale coincidono o una sola versione è disponibile — nessuno scambio necessario.
                          </p>
                        )}
                        <p style={{ fontSize: 10, color: AX.muted, margin: "8px 0 0", lineHeight: 1.45 }}>
                          Galleria, clip e Kling usano sempre la variante <strong style={{ color: AX.text }}>attiva</strong> (persistita sul capitolo).
                        </p>
                      </div>
                    );
                  })()}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      padding: "8px 8px 6px",
                      borderTop: `1px solid ${AX.border}`,
                      background: AX.surface,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={pipelineBusy || r.approved}
                      onClick={() => approveScene(r.sceneId)}
                      style={{
                        ...btnBase,
                        background: r.approved ? AX.border : "rgba(41,182,255,0.95)",
                        color: "#fff",
                      }}
                    >
                      Approva
                    </button>
                    <button
                      type="button"
                      disabled={pipelineBusy}
                      onClick={() => startModifyScene(r.sceneId)}
                      style={{ ...btnBase, background: "rgba(123,77,255,0.95)", color: "#fff" }}
                    >
                      Modifica
                    </button>
                    <button
                      type="button"
                      disabled={pipelineBusy || (!rowIsEnvironment && !allCharacterMastersApproved)}
                      onClick={() => regenerateSingleScene(r.sceneId)}
                      style={{ ...btnBase, background: "rgba(255,159,28,0.95)", color: "#111" }}
                      title={
                        rowIsEnvironment
                          ? "Rigenera solo questa scena (ambiente, senza master)"
                          : "Rigenera solo questa scena (master già approvati)"
                      }
                    >
                      Rigenera
                    </button>
                    <button
                      type="button"
                      disabled={pipelineBusy}
                      onClick={() => deleteScene(r.sceneId)}
                      style={{ ...btnBase, background: "rgba(180,40,60,0.95)", color: "#fff" }}
                    >
                      Elimina
                    </button>
                  </div>
                  {(() => {
                    if (!planSceneRow || !plan || !thumbSrc || rowIsEnvironment) return null;
                    const { ids } = resolveSceneCharacterIdsForPipeline(planSceneRow, plan);
                    if (!ids.length) return null;
                    return (
                      <div
                        style={{
                          padding: "8px 8px 10px",
                          borderTop: `1px solid ${AX.border}`,
                          background: "rgba(41,182,255,0.04)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {ids.map((cid) => {
                            const c = plan.characters.find((x) => x.id === cid);
                            if (!c) return null;
                            return (
                              <button
                                key={cid}
                                type="button"
                                disabled={pipelineBusy}
                                onClick={() => promoteImageUrlToProjectMaster(cid, thumbSrc)}
                                title={`Sostituisce il master ufficiale di «${c.name}» con questa immagine di scena in tutto il progetto.`}
                                style={{
                                  ...btnBase,
                                  background: "rgba(16,120,72,0.9)",
                                  color: "#fff",
                                  flex: "1 1 120px",
                                }}
                              >
                                Imposta come master: {c.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  {modifyingSceneId === r.sceneId && (
                    <div
                      style={{ padding: 10, borderTop: `1px solid ${AX.border}`, background: AX.surface }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: AX.text2, marginBottom: 6 }}>
                        Prompt integrativo (solo la modifica richiesta; stile e identità restano quelli del progetto)
                      </div>
                      <textarea
                        value={modifyDraftPrompt}
                        onChange={(e) => setModifyDraftPrompt(e.target.value)}
                        placeholder="Es. sorride leggermente, aggiungi una tazza sul tavolo, luce più calda sul volto…"
                        rows={3}
                        disabled={sceneBusy}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          borderRadius: 10,
                          border: `1px solid ${AX.border}`,
                          background: AX.card,
                          color: AX.text,
                          fontSize: 13,
                          padding: 10,
                          resize: "vertical",
                          minHeight: 72,
                          marginBottom: 8,
                        }}
                      />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <button
                          type="button"
                          disabled={sceneBusy || !modifyDraftPrompt.trim()}
                          onClick={() => void confirmModifyScene()}
                          style={{
                            flex: 1,
                            minWidth: 120,
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "none",
                            background: AX.gradPrimary,
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: sceneBusy || !modifyDraftPrompt.trim() ? "not-allowed" : "pointer",
                            opacity: sceneBusy || !modifyDraftPrompt.trim() ? 0.45 : 1,
                          }}
                        >
                          Conferma modifica
                        </button>
                        <button
                          type="button"
                          disabled={sceneBusy}
                          onClick={cancelModifyScene}
                          style={{
                            flex: 1,
                            minWidth: 120,
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: `1px solid ${AX.border}`,
                            background: "transparent",
                            color: AX.text2,
                            fontWeight: 600,
                            fontSize: 12,
                            cursor: sceneBusy ? "not-allowed" : "pointer",
                          }}
                        >
                          Annulla
                        </button>
                      </div>
                    </div>
                  )}
                  <div
                    style={{
                      padding: "8px 10px",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: "auto",
                      borderTop: `1px solid ${AX.border}`,
                      background: AX.surface,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSceneIds.includes(r.sceneId)}
                      onChange={(e) => {
                        const on = e.target.checked;
                        e.stopPropagation();
                        setSelectedSceneIds((prev) =>
                          on ? [...prev, r.sceneId] : prev.filter((x) => x !== r.sceneId)
                        );
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ accentColor: AX.magenta }}
                      aria-label={`Seleziona ${r.title}`}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: AX.text }}>{r.title}</div>
                        {planSceneRow && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: "0.04em",
                              padding: "2px 8px",
                              borderRadius: 999,
                              border: `1px solid ${rowIsEnvironment ? "rgba(52,211,153,0.45)" : AX.border}`,
                              color: rowIsEnvironment ? "#6ee7b7" : AX.electric,
                              background: rowIsEnvironment ? "rgba(16,185,129,0.12)" : "rgba(41,182,255,0.08)",
                            }}
                          >
                            {sceneTypeUiLabelIt(planSceneRow)}
                          </span>
                        )}
                      </div>
                      {r.lastUpdatedAt && (
                        <div style={{ fontSize: 10, color: AX.muted, marginTop: 2 }}>
                          Agg. {new Date(r.lastUpdatedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
            )}
          </div>
          <div style={p3.footer}>
            {allCharacterMastersApproved && scenesMissingCount > 0 && (
              <button
                type="button"
                onClick={runGenerateAllPlannedScenes}
                disabled={sceneExecuteBlocked || planning || pipelineLocked}
                style={{
                  padding: "9px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: AX.gradPrimary,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: sceneExecuteBlocked || planning || pipelineLocked ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: sceneExecuteBlocked || planning || pipelineLocked ? 0.55 : 1,
                  boxShadow: "0 6px 20px rgba(41,182,255,0.2)",
                }}
                title="Genera in batch tutte le scene del piano che non hanno ancora un'immagine"
              >
                <HiPhoto size={14} /> Genera tutte le scene
              </button>
            )}
            {allCharacterMastersApproved && selectedSceneIds.length > 0 && (
              <button
                type="button"
                onClick={runGenerateSelectedScenes}
                disabled={sceneExecuteBlocked || planning || pipelineLocked || selectedMissingCount === 0}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: `1px solid ${AX.magenta}`,
                  background: AX.surface,
                  color: AX.magenta,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor:
                    sceneExecuteBlocked || planning || pipelineLocked || selectedMissingCount === 0
                      ? "not-allowed"
                      : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: sceneExecuteBlocked || planning || pipelineLocked || selectedMissingCount === 0 ? 0.45 : 1,
                }}
                title="Genera in batch solo le scene spuntate che non hanno ancora un'immagine"
              >
                <HiCheck size={14} /> Genera scene selezionate
              </button>
            )}
          </div>
        </div>
      )}

      {sceneResults.length > 0 && approvedScenesForClips.length > 0 && (
        <div
          aria-hidden
          style={{
            marginTop: 8,
            marginBottom: 20,
            height: 1,
            background: AX.border,
            opacity: 0.65,
            borderRadius: 1,
            flexShrink: 0,
          }}
        />
      )}

      {/* FASE 4 — Generazione Clip video */}
      {(approvedScenesForClips.length > 0 || clipsReadyForFinalMontage(gatePayload)) && (
        <div
          id="ax-scenografie-anchor-clips"
          style={{ ...p4.shell, ...p4.shellHover(hoveredPhase === 4) }}
          onMouseEnter={() => setHoveredPhase(4)}
          onMouseLeave={() => setHoveredPhase(null)}
        >
          <div aria-hidden style={p4.topHairline} />
          <div style={p4.head}>
            <div style={p4.kickerRow}>
              <span style={p4.stepBadge}>{p4.step}</span>
              <div style={p4.kicker}>Motion e timeline</div>
            </div>
            <h2 style={p4.title}>Generazione Clip video</h2>
            <p style={p4.sub}>
              Clip per scena approvata, smoke test, Clip Builder e timeline narrativa verso il filmato finale.
            </p>
          </div>
          <div style={p4.body}>
            {approvedScenesForClips.length > 0 && (
            <div style={{ marginBottom: 8 }}>
          <p style={{ fontSize: 12, color: AX.text2, marginBottom: 12, lineHeight: 1.55 }}>
            Ogni clip è legato a una <strong style={{ color: AX.text }}>scena approvata</strong>. Dal Clip Builder: validazione → ElevenLabs (TTS) → fal storage → <strong style={{ color: AX.text }}>Kling Avatar v2 Pro</strong>. Dialogato V1: un solo MP3 con battute unite; stessa voice master ElevenLabs per tutti i parlanti.
          </p>
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 12,
              border: `1px dashed ${AX.border}`,
              background: AX.surface,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, letterSpacing: "0.06em", marginBottom: 8 }}>
              Smoke test interni (checklist)
            </div>
            <div style={{ fontSize: 11, color: AX.text2, lineHeight: 1.55, marginBottom: 8 }}>
              <strong style={{ color: AX.text }}>A — Narrato:</strong> scena approvata · testo narratore · voce ElevenLabs valida · «Genera clip» · verifica stato «Pronto da rivedere» e URL video.
            </div>
            <div style={{ fontSize: 11, color: AX.text2, lineHeight: 1.55 }}>
              <strong style={{ color: AX.text }}>B — Dialogato V1:</strong> scena approvata · ≥1 battuta · voice master con <strong style={{ color: AX.text }}>stesso</strong> voice ID ElevenLabs per ogni personaggio che parla · «Genera clip» · stessa verifica.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {approvedScenesForClips.map((scene) => {
              const clipsHere = sceneVideoClips.filter((c) => c.sceneId === scene.id && c.status !== SCENE_VIDEO_CLIP_STATUS.DELETED);
              return (
                <div
                  key={scene.id}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: `1px solid ${AX.border}`,
                    background: AX.surface,
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: AX.text }}>{scene.title_it}</div>
                    <button
                      type="button"
                      disabled={pipelineLocked}
                      onClick={() => addSceneVideoClip(scene.id)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: `1px solid ${AX.electric}`,
                        background: "transparent",
                        color: AX.electric,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: pipelineLocked ? "not-allowed" : "pointer",
                        opacity: pipelineLocked ? 0.45 : 1,
                      }}
                    >
                      <HiPlus size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                      Nuovo clip
                    </button>
                  </div>
                  {clipsHere.length === 0 ? (
                    <div style={{ fontSize: 12, color: AX.muted }}>Nessun clip: crea almeno uno con «Nuovo clip» (si apre il Clip Builder).</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {clipsHere.map((clip) => {
                        const stLabel = SCENE_VIDEO_CLIP_STATUS_LABEL[clip.status] || clip.status;
                        const canAct = !pipelineLocked;
                        const isGen =
                          clip.status === SCENE_VIDEO_CLIP_STATUS.GENERATING_AUDIO ||
                          clip.status === SCENE_VIDEO_CLIP_STATUS.GENERATING_VIDEO;
                        const typeLabel = clip.clipType === CLIP_TYPE.DIALOGUE ? "Dialogato" : "Narrato";
                        const titleDisp = (clip.title || clip.label || "").trim() || "Senza titolo";
                        const autoSec = estimateClipDurationAuto(clip);
                        const effDur = resolveClipDurationSeconds(clip);
                        const genOk = getClipGenerationReadiness(clip, {
                          characterVoiceMasters,
                          projectCharacterMasters,
                          plan,
                          sceneResults,
                        }).ok;
                        const clipOp = deriveClipOperationalSemantics(clip, {
                          plan,
                          characterVoiceMasters,
                          projectCharacterMasters,
                          sceneResults,
                        });
                        return (
                          <div
                            key={clip.id}
                            id={`ax-scenografie-clip-${clip.id}`}
                            style={{
                              padding: 12,
                              borderRadius: 10,
                              border: `1px solid ${AX.border}`,
                              background: AX.card,
                            }}
                          >
                            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, marginBottom: 8, alignItems: "center" }}>
                              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 11, fontWeight: 800, color: AX.magenta }}>{stLabel}</span>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 800,
                                    color:
                                      clipOp.key === CLIP_OPERATIONAL.FAILED ||
                                      clipOp.key === CLIP_OPERATIONAL.FAILED_RECOVERABLE
                                        ? "#fb7185"
                                        : clipOp.key === CLIP_OPERATIONAL.BLOCKED
                                          ? "#fbbf24"
                                          : AX.muted,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                  }}
                                  title="Stato operativo (AXSTUDIO)"
                                >
                                  {clipOperationalLabelIt(clipOp.key)}
                                </span>
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    border: `1px solid ${AX.border}`,
                                    color: AX.text2,
                                  }}
                                >
                                  {typeLabel}
                                </span>
                                {genOk && (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: AX.electric }}>Dati minimi OK</span>
                                )}
                              </div>
                              <span style={{ fontSize: 10, color: AX.muted }}>{clip.id.slice(0, 14)}…</span>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: AX.text, marginBottom: 6 }}>{titleDisp}</div>
                            <div style={{ fontSize: 11, color: AX.text2, marginBottom: 8, lineHeight: 1.45 }}>
                              Durata:{" "}
                              <strong style={{ color: AX.text }}>
                                {effDur != null ? `${effDur}s` : "—"}
                                {clip.durationMode !== "manual" && autoSec > 0 ? ` (stima auto ${autoSec}s)` : ""}
                              </strong>
                              {clip.videoUrl ? (
                                <span style={{ marginLeft: 10, color: AX.electric }}>· Video collegato</span>
                              ) : (
                                <span style={{ marginLeft: 10, color: AX.muted }}>· Video non ancora generato</span>
                              )}
                            </div>
                            {(clip.providerVoice || clip.providerVideo || clip.generationModel) && (
                              <div style={{ fontSize: 10, color: AX.muted, marginBottom: 6, lineHeight: 1.45 }}>
                                {clip.providerVoice ? `Voce: ${clip.providerVoice}` : ""}
                                {clip.providerVoice && clip.providerVideo ? " · " : ""}
                                {clip.providerVideo ? `Video: ${clip.providerVideo}` : ""}
                                {clip.generationModel ? ` · ${String(clip.generationModel).slice(0, 42)}` : ""}
                              </div>
                            )}
                            {clip.lastGenerationError && clip.status === SCENE_VIDEO_CLIP_STATUS.FAILED && (
                              <div style={{ fontSize: 10, color: "#fca5a5", marginBottom: 8, lineHeight: 1.45 }}>
                                <strong>Errore clip:</strong> {clip.lastWorkflowFailure?.errorMessageUser || clip.lastGenerationError}
                                {clip.lastWorkflowFailure?.suggestedAction ? (
                                  <span style={{ display: "block", marginTop: 4, color: AX.muted }}>
                                    →{" "}
                                    {SUGGESTED_ACTION_LABEL_IT[clip.lastWorkflowFailure.suggestedAction] ||
                                      clip.lastWorkflowFailure.suggestedAction}
                                  </span>
                                ) : null}
                              </div>
                            )}
                            {clip.videoUrl && (
                              <video
                                src={clip.videoUrl}
                                controls
                                style={{
                                  width: "100%",
                                  maxHeight: 160,
                                  borderRadius: 8,
                                  marginBottom: 8,
                                  background: "#000",
                                }}
                              />
                            )}
                            {clip.lastEditPrompt && (
                              <div style={{ fontSize: 10, color: AX.muted, marginBottom: 8 }}>Prompt: {clip.lastEditPrompt}</div>
                            )}
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              <button
                                type="button"
                                disabled={
                                  !canAct ||
                                  isGen ||
                                  clip.status === SCENE_VIDEO_CLIP_STATUS.APPROVED ||
                                  clip.status === SCENE_VIDEO_CLIP_STATUS.FINAL
                                }
                                onClick={() => approveVideoClip(clip.id)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: "none",
                                  background: AX.gradPrimary,
                                  color: "#fff",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor:
                                    !canAct ||
                                    isGen ||
                                    clip.status === SCENE_VIDEO_CLIP_STATUS.APPROVED ||
                                    clip.status === SCENE_VIDEO_CLIP_STATUS.FINAL
                                      ? "not-allowed"
                                      : "pointer",
                                  opacity:
                                    !canAct ||
                                    isGen ||
                                    clip.status === SCENE_VIDEO_CLIP_STATUS.APPROVED ||
                                    clip.status === SCENE_VIDEO_CLIP_STATUS.FINAL
                                      ? 0.45
                                      : 1,
                                }}
                              >
                                Approva
                              </button>
                              <button
                                type="button"
                                disabled={!canAct || isGen}
                                onClick={() => openClipBuilder(clip.id)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: `1px solid ${AX.violet}`,
                                  background: "transparent",
                                  color: AX.violet,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: !canAct || isGen ? "not-allowed" : "pointer",
                                }}
                              >
                                Clip Builder
                              </button>
                              <button
                                type="button"
                                disabled={!canAct || isGen}
                                onClick={() => regenerateVideoClip(clip.id)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: `1px solid ${AX.border}`,
                                  background: AX.surface,
                                  color: AX.text2,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: !canAct || isGen ? "not-allowed" : "pointer",
                                }}
                              >
                                Rigenera
                              </button>
                              <button
                                type="button"
                                disabled={!canAct || isGen}
                                onClick={() => markVideoClipDeleted(clip.id)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: "none",
                                  background: "rgba(180,40,60,0.9)",
                                  color: "#fff",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: !canAct ? "not-allowed" : "pointer",
                                }}
                              >
                                Elimina
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
            </div>
            )}

      {clipBuilderOpenClip && plan && (
        <ScenografieClipBuilder
          ax={AX}
          plan={plan}
          sceneResults={sceneResults}
          approvedScenes={approvedScenesForClips}
          characterVoiceMasters={characterVoiceMasters}
          projectCharacterMasters={projectCharacterMasters}
          projectNarrators={projectNarrators}
          onVoiceMasterPatch={patchCharacterVoiceMaster}
          directorProject={projectId ? { id: projectId, title: projectTitle } : null}
          directorChapter={chapterId ? { id: chapterId, ordinal: chapterOrdinal } : null}
          clip={clipBuilderOpenClip}
          onPatch={patchActiveClip}
          onClose={closeClipBuilder}
          pipelineLocked={pipelineLocked}
          pipelineBusy={clipPipelineUi.busy && clipPipelineUi.clipId === clipBuilderOpenClip.id}
          pipelineStage={clipPipelineUi.busy && clipPipelineUi.clipId === clipBuilderOpenClip.id ? clipPipelineUi.stage : null}
          onRequestGenerate={handleGenerateClipFromBuilder}
          onMarkNeedsReview={markClipNeedsReviewFromBuilder}
        />
      )}

            {clipsReadyForFinalMontage(gatePayload) && (
            <div
              id="ax-scenografie-anchor-timeline"
              style={{
                marginTop: approvedScenesForClips.length > 0 ? 22 : 0,
                paddingTop: approvedScenesForClips.length > 0 ? 18 : 0,
                borderTop: approvedScenesForClips.length > 0 ? `1px solid ${AX.border}` : "none",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: AX.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                Timeline / storyboard
              </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: AX.text, margin: "0 0 8px" }}>Revisione e ordine narrativo</h3>
          <p style={{ fontSize: 12, color: AX.text2, marginBottom: 12, lineHeight: 1.55 }}>
            Trascina le righe per riordinare. Il filmato finale userà <strong style={{ color: AX.text }}>solo questo ordine</strong>, non l&apos;ordine di creazione. Conferma la timeline prima del montaggio.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <button
              type="button"
              disabled={pipelineLocked || timelinePlan.approved}
              onClick={rebuildSuggestedTimeline}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: `1px solid ${AX.electric}`,
                background: "transparent",
                color: AX.electric,
                fontWeight: 700,
                fontSize: 12,
                cursor: pipelineLocked || timelinePlan.approved ? "not-allowed" : "pointer",
                opacity: pipelineLocked || timelinePlan.approved ? 0.45 : 1,
              }}
            >
              Rigenera ordine suggerito
            </button>
            <button
              type="button"
              disabled={pipelineLocked || !timelinePlan.entries?.length || timelinePlan.approved}
              onClick={confirmTimelineNarrative}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "none",
                background: AX.gradPrimary,
                color: "#fff",
                fontWeight: 800,
                fontSize: 12,
                cursor: pipelineLocked || !timelinePlan.entries?.length || timelinePlan.approved ? "not-allowed" : "pointer",
                opacity: pipelineLocked || !timelinePlan.entries?.length || timelinePlan.approved ? 0.45 : 1,
              }}
            >
              Conferma timeline narrativa
            </button>
            {timelinePlan.approved && !pipelineLocked && (
              <button
                type="button"
                onClick={unlockTimelineNarrative}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: `1px solid ${AX.border}`,
                  background: AX.surface,
                  color: AX.text2,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Modifica ordine (sblocca)
              </button>
            )}
          </div>
          {timelinePlan.approved && (
            <div style={{ fontSize: 11, fontWeight: 700, color: AX.electric, marginBottom: 12 }}>
              Timeline approvata
              {timelinePlan.approvedAt ? ` · ${new Date(timelinePlan.approvedAt).toLocaleString()}` : ""}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(timelinePlan.entries || []).map((entry, idx) => {
              const sceneMeta = plan?.scenes?.find((s) => s.id === entry.sceneId);
              const sceneRow = sceneResults.find((r) => r.sceneId === entry.sceneId);
              const clip = entry.kind === "clip" && entry.clipId ? sceneVideoClips.find((c) => c.id === entry.clipId) : null;
              const title =
                entry.kind === "scene"
                  ? sceneMeta?.title_it || entry.sceneId
                  : `Clip · ${sceneMeta?.title_it || entry.sceneId}`;
              const thumb = entry.kind === "scene" ? sceneRow?.imageUrl : clip?.videoUrl || sceneRow?.imageUrl;
              const tlLocked = timelinePlan.approved || pipelineLocked;
              return (
                <div
                  key={entry.id}
                  draggable={!tlLocked}
                  onDragStart={() => onTimelineRowDragStart(idx)}
                  onDragEnd={onTimelineRowDragEnd}
                  onDragOver={onTimelineRowDragOver}
                  onDrop={() => onTimelineRowDrop(idx)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 52px 120px 1fr auto",
                    gap: 10,
                    alignItems: "center",
                    padding: 10,
                    borderRadius: 10,
                    border: `1px solid ${AX.border}`,
                    background: AX.surface,
                    opacity: 1,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800, color: AX.electric, minWidth: 28 }}>{idx + 1}</span>
                  <div
                    style={{
                      width: 52,
                      height: 40,
                      borderRadius: 8,
                      overflow: "hidden",
                      background: AX.bg,
                      border: `1px solid ${AX.border}`,
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!thumb) return;
                      const u = String(thumb);
                      const video =
                        u.startsWith("data:video") || /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(u);
                      setSceneImageLightbox({ url: u, title: String(title), kind: video ? "video" : "image" });
                    }}
                  >
                    {thumb ? (
                      <img src={thumb} alt="Anteprima timeline" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ fontSize: 9, color: AX.muted, padding: 4 }}>—</div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: AX.text, lineHeight: 1.25 }}>{title}</div>
                    <div style={{ fontSize: 10, color: AX.muted, marginTop: 2 }}>
                      {entry.kind === "scene" ? "Quadro scena" : "Clip video"}
                    </div>
                  </div>
                  <label style={{ fontSize: 11, color: AX.text2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    Durata (s)
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      disabled={tlLocked}
                      value={entry.durationSec ?? ""}
                      onChange={(e) => setTimelineEntryDuration(idx, e.target.value)}
                      style={{
                        width: 72,
                        padding: "4px 8px",
                        borderRadius: 8,
                        border: `1px solid ${AX.border}`,
                        background: AX.card,
                        color: AX.text,
                        fontSize: 12,
                      }}
                    />
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "stretch" }}>
                    <span
                      title="Trascina per spostare"
                      style={{
                        fontSize: 10,
                        color: AX.muted,
                        cursor: tlLocked ? "default" : "grab",
                        userSelect: "none",
                        textAlign: "center",
                      }}
                    >
                      ⋮⋮
                    </span>
                    <button
                      type="button"
                      disabled={tlLocked || idx === 0}
                      onClick={() => moveTimelineEntry(idx, -1)}
                      style={{ padding: 4, borderRadius: 6, border: `1px solid ${AX.border}`, background: AX.card, cursor: tlLocked || idx === 0 ? "not-allowed" : "pointer" }}
                      aria-label="Sposta su"
                    >
                      <HiChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={tlLocked || idx >= (timelinePlan.entries || []).length - 1}
                      onClick={() => moveTimelineEntry(idx, 1)}
                      style={{ padding: 4, borderRadius: 6, border: `1px solid ${AX.border}`, background: AX.card, cursor: tlLocked || idx >= (timelinePlan.entries || []).length - 1 ? "not-allowed" : "pointer" }}
                      aria-label="Sposta giù"
                    >
                      <HiChevronDown size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {(timelinePlan.entries || []).length === 0 && (
            <div style={{ fontSize: 12, color: AX.muted, marginTop: 10 }}>Nessuna voce: usa «Rigenera ordine suggerito» per popolare scene e clip approvati.</div>
          )}
        </div>
            )}
          </div>
          <div style={p4.footer}>
            <button
              type="button"
              disabled={!approvedScenesForClips.length || pipelineLocked}
              onClick={() => {
                const s = approvedScenesForClips[0];
                if (s?.id) addSceneVideoClip(s.id);
              }}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: `1px solid ${AX.electric}`,
                background: AX.surface,
                color: AX.electric,
                fontWeight: 700,
                fontSize: 12,
                cursor: !approvedScenesForClips.length || pipelineLocked ? "not-allowed" : "pointer",
                opacity: !approvedScenesForClips.length || pipelineLocked ? 0.45 : 1,
              }}
              title={
                approvedScenesForClips[0]
                  ? `Aggiungi clip a «${approvedScenesForClips[0].title_it}» (prima scena approvata in elenco)`
                  : "Serve almeno una scena approvata"
              }
            >
              <HiPlus size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
              Aggiungi clip
            </button>
            <button
              type="button"
              disabled={!canOpenVideoProduction}
              title={canOpenVideoProduction ? "Apri la sezione video libera dopo approvazione character e scene." : "Serve master e scene approvati."}
              onClick={() => void handleGoToVideoProduction()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 10,
                border: "none",
                background: canOpenVideoProduction ? AX.gradPrimary : AX.border,
                color: "#fff",
                fontWeight: 700,
                fontSize: 12,
                cursor: canOpenVideoProduction ? "pointer" : "not-allowed",
                opacity: canOpenVideoProduction ? 1 : 0.55,
              }}
            >
              <HiVideoCamera size={15} style={{ flexShrink: 0 }} />
              Produzione video
            </button>
            <button
              type="button"
              disabled={!canStartFinalMontage}
              title={
                canStartFinalMontage
                  ? "Avvia struttura montaggio finale (timeline confermata)."
                  : "Completa clip e conferma la timeline narrativa."
              }
              onClick={() => void handleStartFinalMontage()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 10,
                border: canStartFinalMontage ? "1px solid rgba(123,77,255,0.5)" : `1px solid ${AX.border}`,
                background: canStartFinalMontage ? "linear-gradient(145deg, rgba(41,182,255,0.12), rgba(123,77,255,0.16))" : AX.surface,
                color: AX.text,
                fontWeight: 700,
                fontSize: 12,
                cursor: canStartFinalMontage ? "pointer" : "not-allowed",
                opacity: canStartFinalMontage ? 1 : 0.55,
              }}
            >
              <HiFilm size={15} style={{ flexShrink: 0, color: canStartFinalMontage ? AX.electric : AX.muted }} />
              Filmato finale
            </button>
            {scenografiaVideoPhase === "production" && (
              <button
                type="button"
                onClick={() => void handleMarkVideoCompleted()}
                disabled={sceneExecuteBlocked}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: `1px solid ${AX.border}`,
                  background: AX.surface,
                  color: AX.text2,
                  fontWeight: 600,
                  fontSize: 11,
                  cursor: sceneExecuteBlocked ? "not-allowed" : "pointer",
                }}
              >
                Video libero: completato
              </button>
            )}
            {finalMontagePhase === "assembly" && (
              <button
                type="button"
                onClick={() => void handleMarkFinalMontageDone()}
                disabled={sceneExecuteBlocked}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: `1px solid ${AX.electric}`,
                  background: AX.surface,
                  color: AX.electric,
                  fontWeight: 700,
                  fontSize: 11,
                  cursor: sceneExecuteBlocked ? "not-allowed" : "pointer",
                }}
              >
                Montaggio: completato
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Fase 5: auto-montaggio (struttura sequenza) ── */}
      {finalMontagePhase === "assembly" && (
        <div
          id="ax-scenografie-anchor-montage"
          style={{ marginBottom: 22, padding: 16, borderRadius: 14, background: "rgba(123,77,255,0.08)", border: `1px solid rgba(123,77,255,0.35)` }}
        >
          <div style={{ fontSize: 10, fontWeight: 800, color: AX.violet, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Fase 5 · Montaggio finale</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: AX.text, margin: "0 0 8px" }}>Montaggio reale (MVP)</h3>
          {workspaceMontageContext && workspaceMontageContext.chaptersCount > 1 ? (
            <div
              style={{
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(251,191,36,0.08)",
                border: "1px solid rgba(251,191,36,0.35)",
                fontSize: 12,
                color: AX.text2,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: AX.text }}>Progetto con più capitoli</strong>
              {workspaceMontageContext.filmDeliveryLabel ? (
                <span style={{ color: AX.muted }}>
                  {" "}
                  · Consegna complessiva:{" "}
                  {FILM_DELIVERY_LABEL_IT[workspaceMontageContext.filmDeliveryLabel] ||
                    workspaceMontageContext.filmDeliveryLabel}
                </span>
              ) : null}
              <div style={{ marginTop: 6 }}>
                {workspaceMontageContext.thisIsPlayableSource
                  ? "Questo capitolo contiene il file che AXSTUDIO usa in Home per la riproduzione."
                  : workspaceMontageContext.playableSourceChapterId
                    ? "Il file usato in Home è salvato su un altro capitolo: apri la scheda progetto e seleziona il capitolo giusto se devi verificare il MP4."
                    : "Chiudi il montaggio capitolo per capitolo; la Home sintetizza il miglior file disponibile."}
                {workspaceMontageContext.thisIsRecoveryTarget ? " Qui ti indichiamo come punto di ripartenza per sistemare errori o stati incoerenti." : ""}
              </div>
              {workspaceMontageContext.hint ? (
                <div style={{ marginTop: 6, fontSize: 11, color: AX.muted }}>{workspaceMontageContext.hint}</div>
              ) : null}
            </div>
          ) : null}
          <div
            style={{
              marginBottom: 12,
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(74,222,128,0.08)",
              border: `1px solid rgba(74,222,128,0.35)`,
              fontSize: 13,
              color: AX.text,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 800, color: AX.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>
              Film finale · sintesi
            </div>
            <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 16 }}>{chapterFilmSimple.primaryLine}</div>
            {chapterFilmSimple.detailLine ? (
              <div style={{ fontSize: 12, color: AX.text2, marginBottom: 8 }}>{chapterFilmSimple.detailLine}</div>
            ) : null}
            <div style={{ fontSize: 12, color: AX.text2 }}>
              <strong style={{ color: AX.electric }}>Prossimo passo:</strong>{" "}
              {chapterFilmSimple.nextStepLine || chapterFilmConfidence.nextStep}
            </div>
            {chapterFilmSimple.verificationLine ? (
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8, lineHeight: 1.45 }}>
                <strong style={{ color: AX.text2 }}>Verifica reale (consegna progetto):</strong> {chapterFilmSimple.verificationLine}
                {workspaceSummaryFilm?.filmOutputVerificationCheckedAt ? (
                  <span style={{ display: "block", fontSize: 11, color: AX.muted, marginTop: 4 }}>
                    Ultimo controllo:{" "}
                    {new Date(workspaceSummaryFilm.filmOutputVerificationCheckedAt).toLocaleString("it-IT")}
                    {workspaceSummaryFilm.filmOutputVerificationMethod
                      ? ` · ${workspaceSummaryFilm.filmOutputVerificationMethod}`
                      : ""}
                  </span>
                ) : null}
              </div>
            ) : null}
            {workspaceSummaryFilm?.completedFilmUrl ? (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => void handleVerifyWorkspaceFilmOutput()}
                  disabled={editorFilmVerifyBusy}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 10,
                    border: "none",
                    background: editorFilmVerifyBusy ? AX.border : AX.gradPrimary,
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: editorFilmVerifyBusy ? "wait" : "pointer",
                  }}
                >
                  {editorFilmVerifyBusy ? "Verifica in corso…" : "Verifica file finale (consegna)"}
                </button>
                <span style={{ fontSize: 11, color: AX.muted, lineHeight: 1.4 }}>
                  Controllo leggero (HTTP o metadati video). Aggiorna lo stato senza rigenerare il montaggio.
                </span>
              </div>
            ) : null}
            <details style={{ marginTop: 10, fontSize: 11, color: AX.muted, lineHeight: 1.5 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700, color: AX.text2, userSelect: "none" }}>
                Dettaglio tecnico
              </summary>
              <div style={{ marginTop: 8 }}>{chapterFilmSimple.technicalHeadline}</div>
              <div style={{ marginTop: 4 }}>{chapterFilmConfidence.subline}</div>
            </details>
            <div style={{ marginTop: 10, fontSize: 11, color: AX.muted }}>
              Stato montaggio:{" "}
              <strong style={{ color: AX.text }}>
                {finalFilmMontage.status === "idle" && "Non avviato"}
                {finalFilmMontage.status === "compiling" && "Compilazione…"}
                {finalFilmMontage.status === "ready" && "Pronto per generare il file"}
                {finalFilmMontage.status === "rendering" && "Creazione file in corso…"}
                {finalFilmMontage.status === "complete" && "File generato"}
                {finalFilmMontage.status === "failed" && "Non riuscito"}
              </strong>
            </div>
          </div>
          <details
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(41,182,255,0.06)",
              border: `1px solid rgba(41,182,255,0.28)`,
              fontSize: 12,
              color: AX.text2,
              lineHeight: 1.55,
            }}
          >
            <summary style={{ cursor: "pointer", fontWeight: 800, color: AX.text, userSelect: "none" }}>
              Dettagli consegna (affidabilità file, timestamp, note tecniche)
            </summary>
            <div style={{ marginTop: 10 }}>
              <div>
                Affidabilità (metadati salvati):{" "}
                <span style={{ color: AX.electric }}>
                  {FILM_OUTPUT_TRUST_LABEL_IT[chapterMontageDelivery.outputTrust] || chapterMontageDelivery.outputTrust}
                </span>
                {chapterMontageDelivery.outputRecordedAt ? (
                  <span style={{ color: AX.muted }}>
                    {" "}
                    · ultimo successo noto: {chapterMontageDelivery.outputRecordedAt}
                  </span>
                ) : null}
              </div>
              {finalFilmMontage.lastMontageAttemptAt ? (
                <div style={{ marginTop: 4, fontSize: 11, color: AX.muted }}>
                  Ultimo tentativo montaggio: {finalFilmMontage.lastMontageAttemptAt}
                </div>
              ) : null}
              <div style={{ marginTop: 8, fontSize: 12, color: AX.text }}>{montageNextStepLine}</div>
              <p style={{ fontSize: 11, color: AX.muted, margin: "10px 0 0", lineHeight: 1.45 }}>
                Il link al file non viene verificato in rete da AXSTUDIO: se non si apre, rigenera il montaggio nello stesso progetto.
              </p>
            </div>
          </details>
          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: AX.text2, userSelect: "none" }}>
              Come funziona il montaggio (tecnico)
            </summary>
            <p style={{ fontSize: 12, color: AX.text2, lineHeight: 1.55, margin: "10px 0 0" }}>
              Piano esecutivo: durate risolte con fonte esplicita, trim dove il file MP4 è noto e più lungo del target, concat ffmpeg.wasm (copy poi re-encode se serve). Transizioni fade sono nel piano ma il render MVP usa solo taglio netto; mix musica/ambiente/SFX resta future-only.
            </p>
          </details>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: AX.text2 }}>
              Stato montaggio:{" "}
              <span style={{ color: AX.text }}>
                {finalFilmMontage.status === "idle" && "Non inizializzato"}
                {finalFilmMontage.status === "compiling" && "Compilazione…"}
                {finalFilmMontage.status === "ready" && "Pronto per il render"}
                {finalFilmMontage.status === "rendering" && "Rendering in corso…"}
                {finalFilmMontage.status === "complete" && "Completato"}
                {finalFilmMontage.status === "failed" && "Errore"}
              </span>
            </span>
            {finalFilmMontage.compiledMontagePlan?.totalDurationSecEstimate != null && (
              <span style={{ fontSize: 11, fontWeight: 700, color: AX.electric }}>
                Durata stimata sequenza: ~{finalFilmMontage.compiledMontagePlan.totalDurationSecEstimate}s
              </span>
            )}
            {finalFilmMontage.lastCompiledAt && (
              <span style={{ fontSize: 10, color: AX.muted }}>Piano: {finalFilmMontage.lastCompiledAt}</span>
            )}
            {finalFilmMontage.lastRenderCompletedAt && finalFilmMontage.status === "complete" && (
              <span style={{ fontSize: 10, color: AX.muted }}>Render: {finalFilmMontage.lastRenderCompletedAt}</span>
            )}
          </div>
          {(finalFilmMontage.montageExecutionPlan?.renderModePreference || finalFilmMontage.lastRenderSummary?.renderModeUsed) && (
            <div
              style={{
                marginBottom: 10,
                padding: "8px 10px",
                borderRadius: 10,
                background: "rgba(0,0,0,0.2)",
                border: `1px solid ${AX.border}`,
                fontSize: 11,
                color: AX.text2,
                lineHeight: 1.55,
              }}
            >
              <div>
                <span style={{ fontWeight: 800, color: AX.text }}>Modalità render</span>: preferenza{" "}
                <code style={{ fontSize: 10, color: AX.electric }}>
                  {finalFilmMontage.montageExecutionPlan?.renderModePreference || "—"}
                </code>
                {finalFilmMontage.lastRenderSummary?.renderModeUsed ? (
                  <>
                    {" "}
                    · effettiva (ultimo run):{" "}
                    <code style={{ fontSize: 10, color: AX.electric }}>{finalFilmMontage.lastRenderSummary.renderModeUsed}</code>
                    {finalFilmMontage.lastRenderSummary.concatHadToReencode ? (
                      <span style={{ color: AX.muted }}> (concat ha richiesto re-encode)</span>
                    ) : null}
                  </>
                ) : (
                  <span style={{ color: AX.muted }}> · esegui &quot;Genera filmato&quot; per la modalità effettiva.</span>
                )}
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: AX.muted }}>
                Nel file MP4 finale oggi: solo video (e audio già nel container di ogni clip). Stem separati e crossfade: vedi sotto.
              </div>
            </div>
          )}
          {finalFilmMontage.compiledMontagePlan?.transitionReport != null && (
            <p style={{ fontSize: 11, color: AX.text2, margin: "0 0 10px", lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>Transizioni</span>:{" "}
              {finalFilmMontage.compiledMontagePlan.transitionReport.crossfadePlannedCutOnlyCount || 0} giunzione/i fade
              pianificata/e ma rese come taglio netto;{" "}
              {finalFilmMontage.compiledMontagePlan.transitionReport.transitionsNotRenderedCount || 0} placeholder (titoli/credits)
              non nel render.
            </p>
          )}
          {finalFilmMontage.compiledMontagePlan?.audioPlanReference && (
            <p style={{ fontSize: 11, color: AX.text2, margin: "0 0 10px", lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>Audio / mix</span>: ogni segmento usa{" "}
              <code style={{ fontSize: 10 }}>clip.videoUrl</code> con traccia audio già incorporata dal mix clip (H7; cinematic
              include mux post-O3). Segmenti:{" "}
              {finalFilmMontage.compiledMontagePlan.audioPlanReference.voiceStem?.executableNow ? "ok" : "n/d"}. Piano
              design musica / ambiente / SFX (placeholder):{" "}
              {finalFilmMontage.compiledMontagePlan.audioPlanReference.musicBed?.plannedClipsCount ?? 0} ·{" "}
              {finalFilmMontage.compiledMontagePlan.audioPlanReference.ambientBed?.plannedClipsCount ?? 0} ·{" "}
              {finalFilmMontage.compiledMontagePlan.audioPlanReference.sfx?.plannedClipsCount ?? 0}. Stem renderizzati su
              clip: musica{" "}
              {finalFilmMontage.compiledMontagePlan.audioPlanReference.musicBed?.clipsWithRenderedStemCount ?? 0} · ambiente{" "}
              {finalFilmMontage.compiledMontagePlan.audioPlanReference.ambientBed?.clipsWithRenderedStemCount ?? 0} · SFX{" "}
              {finalFilmMontage.compiledMontagePlan.audioPlanReference.sfx?.clipsWithRenderedStemCount ?? 0}. Il concat non
              rimixa a livello film.
            </p>
          )}
          {finalFilmMontage.compiledMontagePlan?.audioMixIntentSummary?.summaryLine && (
            <p style={{ fontSize: 11, color: AX.text2, margin: "0 0 10px", lineHeight: 1.5 }}>
              Audio (intent): {finalFilmMontage.compiledMontagePlan.audioMixIntentSummary.summaryLine}
            </p>
          )}
          {(finalFilmMontage.compiledMontagePlan?.titleCardIntro || finalFilmMontage.compiledMontagePlan?.endCredits) && (
            <p style={{ fontSize: 11, color: AX.muted, margin: "0 0 10px" }}>
              Segnaposto: {finalFilmMontage.compiledMontagePlan.titleCardIntro ? "titolo intro" : ""}
              {finalFilmMontage.compiledMontagePlan.titleCardIntro && finalFilmMontage.compiledMontagePlan.endCredits ? " · " : ""}
              {finalFilmMontage.compiledMontagePlan.endCredits ? "credits fine" : ""} (non ancora nel file concatenato)
            </p>
          )}
          {(finalFilmMontage.lastError || finalFilmMontage.lastWorkflowFailure) && (
            <div
              style={{
                marginBottom: 12,
                padding: 10,
                borderRadius: 10,
                background: "rgba(255,79,163,0.12)",
                border: "1px solid rgba(255,79,163,0.35)",
                fontSize: 12,
                color: AX.text,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Montaggio · problema</div>
              <div style={{ lineHeight: 1.5 }}>
                {finalFilmMontage.lastWorkflowFailure?.errorMessageUser || finalFilmMontage.lastError}
              </div>
              {finalFilmMontage.lastWorkflowFailure?.isRecoverable !== false &&
              finalFilmMontage.lastWorkflowFailure?.suggestedAction ? (
                <div style={{ marginTop: 8, fontSize: 11, color: AX.muted }}>
                  Suggerimento:{" "}
                  <strong style={{ color: AX.text }}>
                    {SUGGESTED_ACTION_LABEL_IT[finalFilmMontage.lastWorkflowFailure.suggestedAction] ||
                      finalFilmMontage.lastWorkflowFailure.suggestedAction}
                  </strong>
                </div>
              ) : null}
              {finalFilmMontage.lastWorkflowFailure?.errorMessageTechnical ? (
                <details style={{ marginTop: 8, fontSize: 10, color: AX.muted }}>
                  <summary style={{ cursor: "pointer", userSelect: "none" }}>Dettaglio tecnico</summary>
                  <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontFamily: "monospace" }}>
                    {String(finalFilmMontage.lastWorkflowFailure.errorMessageTechnical)}
                  </pre>
                </details>
              ) : null}
            </div>
          )}
          {Array.isArray(finalFilmMontage.compiledMontagePlan?.executionWarnings) &&
            finalFilmMontage.compiledMontagePlan.executionWarnings.length > 0 && (
            <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 11, color: AX.muted, lineHeight: 1.55 }}>
              {finalFilmMontage.compiledMontagePlan.executionWarnings.slice(0, 12).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => void handleGenerateFinalFilm()}
              disabled={sceneExecuteBlocked || montageRenderBusy || !finalFilmMontage.compiledMontagePlan}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "none",
                background: montageRenderBusy || !finalFilmMontage.compiledMontagePlan ? AX.border : AX.gradPrimary,
                color: AX.text,
                fontWeight: 800,
                fontSize: 12,
                cursor: sceneExecuteBlocked || montageRenderBusy || !finalFilmMontage.compiledMontagePlan ? "not-allowed" : "pointer",
                opacity: sceneExecuteBlocked || montageRenderBusy || !finalFilmMontage.compiledMontagePlan ? 0.5 : 1,
              }}
            >
              {montageRenderBusy ? "Generazione in corso…" : "Genera filmato finale"}
            </button>
            <button
              type="button"
              onClick={() => void handleRefreshMontagePlan()}
              disabled={sceneExecuteBlocked || montageRenderBusy}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: `1px solid ${AX.border}`,
                background: AX.surface,
                color: AX.text2,
                fontWeight: 700,
                fontSize: 11,
                cursor: sceneExecuteBlocked || montageRenderBusy ? "not-allowed" : "pointer",
              }}
            >
              Aggiorna piano montaggio
            </button>
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: AX.text2, lineHeight: 1.7 }}>
            {Array.isArray(finalFilmMontage.compiledMontagePlan?.segmentDetails) && finalFilmMontage.compiledMontagePlan.segmentDetails.length > 0
              ? finalFilmMontage.compiledMontagePlan.segmentDetails.map((seg, i) => {
                  const sc = plan?.scenes?.find((s) => s.id === seg.sceneId);
                  const eff = seg.resolvedDurationSec != null || seg.effectiveDurationSec != null
                    ? `${seg.resolvedDurationSec ?? seg.effectiveDurationSec}s`
                    : "durata n/d";
                  const src = seg.durationSource ? ` · fonte ${seg.durationSource}` : "";
                  const hint = seg.timelineDurationHintSec != null ? ` · timeline ${seg.timelineDurationHintSec}s` : "";
                  const trim =
                    seg.canTrimExactly && seg.trimDurationSecForRender != null
                      ? ` · trim render ~${seg.trimDurationSecForRender}s`
                      : seg.needsFullClipFallback
                        ? " · file intero (trim non garantito)"
                        : "";
                  return (
                    <li key={seg.clipId || seg.timelineEntryId}>
                      {i + 1}. {sc?.title_it || seg.sceneId} — {eff}
                      {src}
                      {hint}
                      {trim} · {SCENE_VIDEO_CLIP_STATUS_LABEL[seg.clipStatus] || seg.clipStatus}
                    </li>
                  );
                })
              : (finalMontagePlan.orderedTimelineEntryIds && finalMontagePlan.orderedTimelineEntryIds.length > 0
                  ? finalMontagePlan.orderedTimelineEntryIds
                  : finalMontagePlan.orderedClipIds || []
                ).map((rowId, i) => {
                  if (finalMontagePlan.orderedTimelineEntryIds && finalMontagePlan.orderedTimelineEntryIds.length > 0) {
                    const entry = timelinePlan.entries.find((x) => x.id === rowId);
                    if (!entry) {
                      return (
                        <li key={rowId}>
                          {i + 1}. (voce timeline mancante) {rowId}
                        </li>
                      );
                    }
                    const sc = plan?.scenes?.find((s) => s.id === entry.sceneId);
                    const clip = entry.kind === "clip" && entry.clipId ? sceneVideoClips.find((c) => c.id === entry.clipId) : null;
                    const label =
                      entry.kind === "scene" ? `Scena — ${sc?.title_it || entry.sceneId}` : `Clip — ${sc?.title_it || entry.sceneId}`;
                    const eff = clip ? resolveEffectiveClipDurationSeconds(clip) : null;
                    return (
                      <li key={rowId}>
                        {i + 1}. {label}
                        {eff != null ? ` · ~${eff}s eff.` : entry.durationSec != null ? ` · ${entry.durationSec}s` : ""}
                        {clip ? ` — ${SCENE_VIDEO_CLIP_STATUS_LABEL[clip.status] || clip.status}` : ""}
                      </li>
                    );
                  }
                  const cid = rowId;
                  const c = sceneVideoClips.find((x) => x.id === cid);
                  const sc = plan?.scenes?.find((s) => s.id === c?.sceneId);
                  const eff = c ? resolveEffectiveClipDurationSeconds(c) : null;
                  return (
                    <li key={cid}>
                      {i + 1}. {sc?.title_it || c?.sceneId || cid}
                      {eff != null ? ` · ~${eff}s eff.` : ""}
                      {c ? ` — ${SCENE_VIDEO_CLIP_STATUS_LABEL[c.status] || c.status}` : ""}
                    </li>
                  );
                })}
          </ol>
          {editorFilmPlaybackEntries.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              {(() => {
                const entries = editorFilmPlaybackEntries;
                const ix = Math.min(Math.max(0, editorFilmPlaybackIndex), entries.length - 1);
                const cur = entries[ix];
                const activeUrl = cur?.url || "";
                const hasAlt = ix < entries.length - 1;
                const errHint =
                  editorFilmPlaybackError && typeof editorFilmPlaybackError === "object"
                    ? editorFilmPlaybackError.browserHint
                    : null;
                const errAt =
                  editorFilmPlaybackError && typeof editorFilmPlaybackError === "object" && editorFilmPlaybackError.atIso
                    ? new Date(editorFilmPlaybackError.atIso).toLocaleString("it-IT")
                    : null;
                return (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: AX.text2, marginBottom: 6 }}>
                      Output finale · anteprima (stessa logica della Home)
                    </div>
                    <div
                      style={{
                        marginBottom: 10,
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "rgba(41,182,255,0.08)",
                        border: "1px solid rgba(41,182,255,0.28)",
                        fontSize: 12,
                        color: AX.text2,
                        lineHeight: 1.5,
                      }}
                    >
                      <strong style={{ color: "#7dd3fc" }}>{editorPlaybackMoment.headline}</strong>
                      <div style={{ marginTop: 4 }}>{editorPlaybackMoment.subline}</div>
                      <div style={{ marginTop: 8, fontSize: 11, color: AX.muted }}>
                        <strong style={{ color: AX.text2 }}>Sorgente in uso:</strong> {cur?.sourceLabel}
                        {entries.length > 1 ? (
                          <span>
                            {" "}
                            · ancora {entries.length - 1 - ix} sorgente/i diversa/e nel progetto
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {editorFilmPlaybackError ? (
                      <div
                        style={{
                          marginBottom: 10,
                          padding: 12,
                          borderRadius: 10,
                          background: "rgba(127,29,29,0.25)",
                          border: "1px solid rgba(248,113,113,0.4)",
                          fontSize: 12,
                          color: "#fecaca",
                          lineHeight: 1.5,
                        }}
                      >
                        <strong>Anteprima: il lettore incorporato non ha caricato il file.</strong>
                        <div style={{ marginTop: 6 }}>
                          Prova la nuova scheda o un altro MP4 salvato; se il montaggio è vecchio o incoerente, rigenera con «Genera
                          filmato finale» qui sopra.
                        </div>
                        {errHint ? (
                          <div style={{ marginTop: 8 }}>
                            <strong>Indizio dal browser:</strong> {errHint}
                          </div>
                        ) : null}
                        {errAt ? <div style={{ marginTop: 6, fontSize: 11, opacity: 0.9 }}>Ultimo tentativo: {errAt}</div> : null}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditorFilmPlaybackError(null);
                              setEditorFilmPlaybackReloadKey((k) => k + 1);
                            }}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 8,
                              border: "none",
                              background: AX.gradPrimary,
                              color: "#fff",
                              fontWeight: 800,
                              fontSize: 11,
                              cursor: "pointer",
                            }}
                          >
                            Riprova qui
                          </button>
                          {hasAlt ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEditorFilmPlaybackIndex(ix + 1);
                                setEditorFilmPlaybackError(null);
                                setEditorFilmPlaybackReloadKey((k) => k + 1);
                              }}
                              style={{
                                padding: "6px 12px",
                                borderRadius: 8,
                                border: "1px solid rgba(74,222,128,0.45)",
                                background: "rgba(74,222,128,0.1)",
                                color: "#bbf7d0",
                                fontWeight: 700,
                                fontSize: 11,
                                cursor: "pointer",
                              }}
                            >
                              Prova altra sorgente
                            </button>
                          ) : null}
                          {activeUrl ? (
                            <button
                              type="button"
                              onClick={() => {
                                try {
                                  window.open(activeUrl, "_blank", "noopener,noreferrer");
                                } catch {
                                  /* ignore */
                                }
                              }}
                              style={{
                                padding: "6px 12px",
                                borderRadius: 8,
                                border: `1px solid ${AX.border}`,
                                background: AX.surface,
                                color: AX.electric,
                                fontWeight: 700,
                                fontSize: 11,
                                cursor: "pointer",
                              }}
                            >
                              Apri in nuova scheda
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => applyRecoveryDeepLink({ focus: "montage" })}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 8,
                              border: "1px solid rgba(196,181,253,0.45)",
                              background: "rgba(123,77,255,0.12)",
                              color: "#e9d5ff",
                              fontWeight: 700,
                              fontSize: 11,
                              cursor: "pointer",
                            }}
                          >
                            Vai al blocco montaggio
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <video
                      key={`${projectId}-${chapterId}-${editorFilmPlaybackReloadKey}-${ix}`}
                      src={activeUrl || undefined}
                      controls
                      playsInline
                      onLoadedData={() => setEditorFilmPlaybackError(null)}
                      onError={(e) => {
                        const v = e?.target;
                        setEditorFilmPlaybackError({
                          browserHint: humanizeHtml5VideoElementError(v),
                          atIso: new Date().toISOString(),
                        });
                      }}
                      style={{ width: "100%", maxWidth: 520, borderRadius: 10, background: "#000" }}
                    />
                    {!editorFilmPlaybackError && activeUrl ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          onClick={() => {
                            try {
                              window.open(activeUrl, "_blank", "noopener,noreferrer");
                            } catch {
                              /* ignore */
                            }
                          }}
                          style={{
                            padding: "6px 12px",
                            borderRadius: 8,
                            border: `1px solid ${AX.border}`,
                            background: AX.surface,
                            color: AX.electric,
                            fontWeight: 600,
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          Apri in nuova scheda (stessa sorgente)
                        </button>
                        {hasAlt ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditorFilmPlaybackIndex(ix + 1);
                              setEditorFilmPlaybackError(null);
                              setEditorFilmPlaybackReloadKey((k) => k + 1);
                            }}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 8,
                              border: "1px solid rgba(74,222,128,0.35)",
                              background: "rgba(74,222,128,0.06)",
                              color: "#86efac",
                              fontWeight: 600,
                              fontSize: 11,
                              cursor: "pointer",
                            }}
                          >
                            Passa a sorgente alternativa
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </div>
          ) : null}
        </div>
      )}

      {/* ── Empty state ── */}
      {!plan && !planning && sceneResults.length === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: 0.5 }}>
          <HiFilm size={48} style={{ color: AX.muted, marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: AX.text2, textAlign: "center", maxWidth: 380 }}>
            {Object.keys(masterImages).length > 0 || Object.keys(masterByCharName).length > 0 ? (
              <>
                Master ancora salvati in memoria. Modifica il prompt e usa <strong style={{ color: AX.text }}>Rigenera piano</strong> in FASE 1 (con master già presenti) per un nuovo piano senza perdere i volti.
              </>
            ) : (
              <>
                Scrivi una descrizione e clicca &quot;Analizza Prompt&quot; per iniziare.
                <br />
                <span style={{ fontSize: 12, color: AX.muted }}>
                  L&apos;AI creerà personaggi coerenti e scene con identità visiva consistente.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {sceneImageLightbox && (
        <div
          role="presentation"
          className="ax-modal-touch-lock"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            background: "rgba(6,6,12,0.88)",
            backdropFilter: "blur(10px)",
          }}
          onClick={() => setSceneImageLightbox(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={sceneImageLightbox.title}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "min(96vw, 1600px)",
              maxHeight: "92vh",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
            }}
          >
            <button
              type="button"
              onClick={() => setSceneImageLightbox(null)}
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                zIndex: 2,
                padding: "8px 14px",
                borderRadius: 10,
                border: `1px solid ${AX.border}`,
                background: AX.card,
                color: AX.text,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
              }}
            >
              Chiudi
            </button>
            {sceneImageLightbox.kind === "video" ? (
              <video
                src={sceneImageLightbox.url}
                controls
                playsInline
                style={{ maxWidth: "100%", maxHeight: "86vh", borderRadius: 12, background: "#000" }}
              />
            ) : (
              <img
                src={sceneImageLightbox.url}
                alt={sceneImageLightbox.title}
                style={{
                  maxWidth: "100%",
                  maxHeight: "86vh",
                  width: "auto",
                  height: "auto",
                  objectFit: "contain",
                  borderRadius: 12,
                  display: "block",
                  boxShadow: "0 12px 48px rgba(0,0,0,0.55)",
                }}
              />
            )}
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f0f2f8", textAlign: "center", lineHeight: 1.35 }}>
              {sceneImageLightbox.title}
            </div>
          </div>
        </div>
      )}

      {masterPromptModalCharId && plan?.characters?.length ? (() => {
        const pmChar = plan.characters.find((c) => c.id === masterPromptModalCharId);
        if (!pmChar) return null;
        const pmPreview = getDisplayMasterUrl(pmChar, projectCharacterMasters);
        return (
          <div
            role="presentation"
            className="ax-modal-touch-lock"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 100005,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              background: "rgba(6,6,12,0.92)",
              backdropFilter: "blur(12px)",
            }}
            onClick={() => !masterPromptModalBusy && setMasterPromptModalCharId(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="master-prompt-modal-title"
              onClick={(e) => e.stopPropagation()}
              className="ax-modal-scroll-y"
              style={{
                width: "100%",
                maxWidth: 560,
                maxHeight: "92vh",
                overflow: "auto",
                borderRadius: 16,
                border: `1px solid ${AX.border}`,
                background: AX.card,
                padding: "22px 22px 20px",
                boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
              }}
            >
              <h2
                id="master-prompt-modal-title"
                style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 900, color: AX.text, lineHeight: 1.25 }}
              >
                {pmChar.name}
              </h2>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: AX.text2, lineHeight: 1.55 }}>
                Scrivi come immagini questo personaggio (età, volto, capelli, barba o no, espressione, ruolo, abiti,
                atmosfera). Con «Avvia» la finestra si chiude e parte subito una nuova generazione con questo testo.
              </p>
              <div
                style={{
                  borderRadius: 12,
                  background: AX.bg,
                  minHeight: 200,
                  maxHeight: 320,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 14,
                  border: `1px solid ${AX.border}`,
                  overflow: "hidden",
                }}
              >
                {pmPreview ? (
                  <img
                    src={pmPreview}
                    alt={pmChar.name}
                    style={{
                      maxWidth: "100%",
                      maxHeight: 300,
                      width: "auto",
                      height: "auto",
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                ) : (
                  <span style={{ color: AX.muted, padding: 20, fontSize: 13, textAlign: "center" }}>
                    Nessuna anteprima ancora: dopo Avvia il nuovo volto comparirà sulla card.
                  </span>
                )}
              </div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 800, color: AX.muted, marginBottom: 8 }}>
                Come deve apparire
              </label>
              <textarea
                value={masterPromptDraft}
                onChange={(e) => setMasterPromptDraft(e.target.value)}
                disabled={masterPromptModalBusy}
                placeholder={
                  "Esempio: uomo adulto, barba curata, occhi gentili, volto chiaramente maschile, tunica sobria…"
                }
                style={{
                  width: "100%",
                  minHeight: 140,
                  maxHeight: 220,
                  resize: "vertical",
                  boxSizing: "border-box",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${AX.border}`,
                  background: AX.bg,
                  color: AX.text,
                  fontSize: 13,
                  lineHeight: 1.45,
                  fontFamily: "inherit",
                  marginBottom: 4,
                }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginTop: 16,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={() => !masterPromptModalBusy && setMasterPromptModalCharId(null)}
                  disabled={masterPromptModalBusy}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: `1px solid ${AX.border}`,
                    background: AX.surface,
                    color: AX.text2,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: masterPromptModalBusy ? "not-allowed" : "pointer",
                  }}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!masterPromptModalCharId || !plan?.characters?.length) return;
                    const ch = plan.characters.find((c) => c.id === masterPromptModalCharId);
                    if (!ch) return;
                    const pcmKeyModal = stableCharacterKey(ch);
                    const row = pcmRowForCharacter(projectCharacterMasters, ch) || {};
                    const draft = masterPromptDraft.trim();
                    setMasterPromptModalBusy(true);
                    try {
                      const pcmNext = {
                        ...projectCharacterMasters,
                        [pcmKeyModal]: {
                          ...row,
                          characterId: ch.id,
                          characterName: ch.name,
                          characterMasterPrompt: draft,
                          updatedAt: new Date().toISOString(),
                        },
                      };
                      commitProjectCharacterMastersSync(pcmNext);
                      setMasterPromptModalCharId(null);
                      await generateOrRegenerateCharacterMaster(masterPromptModalCharId, {
                        explicitMasterPrompt: draft,
                      });
                    } finally {
                      setMasterPromptModalBusy(false);
                    }
                  }}
                  disabled={masterPromptModalBusy || pipelineLocked}
                  style={{
                    padding: "10px 22px",
                    borderRadius: 10,
                    border: "none",
                    background: masterPromptModalBusy || pipelineLocked ? AX.border : AX.gradPrimary,
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: masterPromptModalBusy || pipelineLocked ? "not-allowed" : "pointer",
                    opacity: masterPromptModalBusy || pipelineLocked ? 0.55 : 1,
                    boxShadow:
                      masterPromptModalBusy || pipelineLocked ? "none" : "0 4px 18px rgba(41,182,255,0.25)",
                  }}
                >
                  Avvia
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}

      {executionLogModalOpen && (
        <div
          role="presentation"
          className="ax-modal-touch-lock"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100002,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            background: "rgba(6,6,12,0.88)",
            backdropFilter: "blur(10px)",
          }}
          onClick={() => setExecutionLogModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="scenografie-exec-log-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 680,
              maxHeight: "min(85vh, 720px)",
              display: "flex",
              flexDirection: "column",
              borderRadius: 14,
              background: AX.card,
              border: `1px solid ${AX.border}`,
              boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "14px 16px",
                borderBottom: `1px solid ${AX.border}`,
                flexShrink: 0,
              }}
            >
              <h2 id="scenografie-exec-log-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: AX.text }}>
                Registro attività
              </h2>
              <button
                type="button"
                onClick={() => setExecutionLogModalOpen(false)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: `1px solid ${AX.border}`,
                  background: AX.surface,
                  color: AX.text,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Chiudi
              </button>
            </div>
            <div
              className="ax-modal-scroll-y"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                padding: "12px 16px 18px",
                fontSize: 11,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                lineHeight: 1.7,
                color: AX.text2,
              }}
            >
              {executionLog.length === 0 ? (
                <div style={{ color: AX.muted, fontSize: 12, padding: "8px 0" }}>Nessun evento registrato ancora.</div>
              ) : (
                executionLog.map((entry, i) => (
                  <div key={i} style={{ color: entry.msg.startsWith("ERRORE") ? "#ef4444" : AX.text2 }}>
                    <span style={{ color: AX.muted }}>{entry.time}</span> {entry.msg}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {newProjectConfirmOpen && (
        <div
          role="presentation"
          className="ax-modal-touch-lock"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "rgba(6,6,12,0.78)",
            backdropFilter: "blur(8px)",
          }}
          onClick={cancelNewProjectConfirm}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="scenografie-new-project-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 440,
              borderRadius: 16,
              background: AX.card,
              border: `1px solid ${AX.border}`,
              boxShadow: "0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(123,77,255,0.12)",
              overflow: "hidden",
            }}
          >
            <div style={{ height: 3, background: AX.gradLogo, width: "100%" }} />
            <div style={{ padding: "22px 24px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: AX.surface,
                    border: `1px solid ${AX.border}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <HiFilm size={22} style={{ color: AX.violet }} />
                </div>
                <h2 id="scenografie-new-project-title" style={{ margin: 0, fontSize: 18, fontWeight: 800, color: AX.text, letterSpacing: "-0.02em" }}>
                  Elimina progetto scenografico
                </h2>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: AX.text2 }}>
                Questo progetto verrà rimosso dalla griglia Scenografie e cancellato dallo spazio dedicato (file o localStorage). L&apos;azione non è annullabile.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end", marginTop: 24 }}>
                <button
                  type="button"
                  onClick={cancelNewProjectConfirm}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: `1px solid ${AX.border}`,
                    background: AX.surface,
                    color: AX.text2,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={confirmNewProjectReset}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 10,
                    border: "none",
                    background: AX.gradPrimary,
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 4px 20px rgba(41,182,255,0.25)",
                  }}
                >
                  Sì, elimina progetto
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
