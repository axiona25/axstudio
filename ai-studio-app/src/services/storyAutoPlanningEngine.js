/**
 * AXSTUDIO — Story-driven preproduction: analisi, arricchimento piano Scenografie, checklist.
 * Si appoggia allo schema `plan` già prodotto da `planScenografia` / `planScenografiaContinue`.
 */

import { planScenografiaContinue } from "./scenografiePlanner.js";
import { isEnvironmentScene } from "./scenografiePlanner.js";

export const STORY_AUTO_PLAN_VERSION = 1;

/** Tipologie clip proposte (UI / pre-produzione; il runtime clip usa altri enum interni). */
export const STORY_CLIP_KIND = {
  NARRATED: "narrated",
  DIALOGUE: "dialogue",
  CONVERSATIONAL: "conversational",
  ENVIRONMENT: "environment",
  TRANSITION: "transition",
  REACTION: "reaction",
  ESTABLISHING: "establishing",
  MULTI_SUBJECT: "multi_subject",
};

const TASK_STATUS = {
  OPEN: "open",
  PROPOSED: "proposed",
  APPROVED: "approved",
  READY_FOR_PRODUCTION: "ready_for_production",
  DONE: "done",
};

/**
 * @param {{ title?: string, description?: string, storyPrompt?: string }} p
 * @returns {string}
 */
export function composePlannerPromptFromStory(p) {
  const t = String(p?.title || "").trim();
  const d = String(p?.description || "").trim();
  const s = String(p?.storyPrompt || "").trim();
  const parts = [];
  if (t) parts.push(`Titolo progetto: ${t}`);
  if (d) parts.push(`Nota / logline breve: ${d}`);
  parts.push("");
  parts.push("TRACCIA COMPLETA DEL FILM (usa tutto per personaggi, scene, clip e tono):");
  parts.push(s || "(testo assente — arricchisci con il titolo e la nota)");
  return parts.join("\n");
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * @param {object|null} plan
 * @param {{ storyPrompt?: string, targetFilmDurationSec?: number }} ctx
 */
export function buildStoryAnalysisFromPlan(plan, ctx = {}) {
  const target = clamp(Number(ctx.targetFilmDurationSec) || 300, 30, 3600);
  const wc = wordCount(ctx.storyPrompt);
  const scenes = Array.isArray(plan?.scenes) ? plan.scenes.length : 0;
  const chars = Array.isArray(plan?.characters) ? plan.characters.length : 0;
  const clips = Array.isArray(plan?.clips) ? plan.clips.length : 0;

  let clipDur = 0;
  for (const c of plan?.clips || []) {
    const d = Number(c?.duration_suggestion);
    if (Number.isFinite(d) && d > 0) clipDur += d;
  }
  const estimatedFilmDurationSec =
    clipDur > 0 ? Math.round(clipDur) : Math.round(scenes * (target / Math.max(scenes, 1)));

  let complexity = "media";
  if (clips >= 18 || chars >= 8 || wc > 900) complexity = "alta";
  else if (clips <= 6 && chars <= 3 && wc < 250) complexity = "bassa";

  const mood = String(plan?.scenes?.[0]?.mood || plan?.visual_style || "").trim() || "—";
  const genre = plan?.is_animated ? "Animazione / family-friendly (da piano)" : "Drammatico / live mood (da piano)";

  return {
    version: STORY_AUTO_PLAN_VERSION,
    toneLine: mood.slice(0, 160),
    genreMood: genre,
    estimatedFilmDurationSec,
    targetFilmDurationSec: target,
    proposedSceneCount: scenes,
    proposedCharacterCount: chars,
    proposedClipCount: clips,
    complexity,
    narrativeStructureSummary: String(plan?.summary_it || "").trim() || "—",
    storyWordCount: wc,
  };
}

function inferClipKindForBeat(plan, scene, clip) {
  if (isEnvironmentScene(scene)) return STORY_CLIP_KIND.ENVIRONMENT;
  const present = (scene?.characters_present || []).length;
  const action = `${clip?.action_it || ""} ${clip?.action_en || ""}`.toLowerCase();
  if (/dialogo|discutono|parlano|chiede|risponde|convers/.test(action)) return STORY_CLIP_KIND.DIALOGUE;
  if (present >= 3) return STORY_CLIP_KIND.MULTI_SUBJECT;
  if (/reagisce|sorpresa|sguardo/.test(action)) return STORY_CLIP_KIND.REACTION;
  if (/transiz|dissolvenza|passaggio/.test(action)) return STORY_CLIP_KIND.TRANSITION;
  if (/esterni|panoram|wide|establish/.test(action)) return STORY_CLIP_KIND.ESTABLISHING;
  if (present <= 1 && /voce|narratore|racconta/.test(action)) return STORY_CLIP_KIND.NARRATED;
  return present >= 2 ? STORY_CLIP_KIND.CONVERSATIONAL : STORY_CLIP_KIND.NARRATED;
}

function inferSceneMode(scene, clipKinds) {
  if (isEnvironmentScene(scene)) return "ambiente";
  if (clipKinds.every((k) => k === STORY_CLIP_KIND.DIALOGUE || k === STORY_CLIP_KIND.CONVERSATIONAL))
    return "dialogica";
  if (clipKinds.some((k) => k === STORY_CLIP_KIND.MULTI_SUBJECT)) return "multi_soggetto";
  if (clipKinds.some((k) => k === STORY_CLIP_KIND.NARRATED)) return "narrata";
  return "mista";
}

/**
 * Mutazione sicura su clone: aggiunge storyAutoPlan su scene, clipAutoPlan su clips, proposal su characters, checklist.
 * @param {object} plan — piano validato
 * @param {number} targetFilmDurationSec
 * @returns {object}
 */
export function enrichPlanWithAutoPreproduction(plan, targetFilmDurationSec) {
  const p = JSON.parse(JSON.stringify(plan));
  const target = clamp(Number(targetFilmDurationSec) || 300, 30, 3600);
  const sceneList = p.scenes || [];
  const nScenes = Math.max(sceneList.length, 1);
  const perSceneBudget = target / nScenes;

  const charById = new Map((p.characters || []).map((c) => [c.id, c]));
  const clipsByScene = new Map();
  for (const cl of p.clips || []) {
    const sid = cl.scene_id || cl.sceneId;
    if (!sid) continue;
    if (!clipsByScene.has(sid)) clipsByScene.set(sid, []);
    clipsByScene.get(sid).push(cl);
  }

  for (const scene of sceneList) {
    const sid = scene.id;
    const scClips = clipsByScene.get(sid) || [];
    const kinds = scClips.map((c) => inferClipKindForBeat(p, scene, c));
    const mode = inferSceneMode(scene, kinds.length ? kinds : [STORY_CLIP_KIND.NARRATED]);
    let sceneSec = 0;
    for (const c of scClips) {
      const d = Number(c.duration_suggestion);
      sceneSec += Number.isFinite(d) && d > 0 ? d : perSceneBudget / Math.max(scClips.length, 1);
    }
    if (!sceneSec) sceneSec = perSceneBudget;

    const narrativeFn = isEnvironmentScene(scene)
      ? "Atmosfera / luogo"
      : mode === "dialogica"
        ? "Sviluppo relazionale / informazioni"
        : mode === "narrata"
          ? "Avanzamento narrativo guidato"
          : "Progressione storia";

    scene.storyAutoPlan = {
      sceneNarrativeFunction: narrativeFn,
      sceneEstimatedDurationSec: Math.round(sceneSec),
      sceneSuggestedClipCount: scClips.length,
      sceneSuggestedClipTypes: [...new Set(kinds)],
      sceneModeSuggested: mode,
      sceneProductionChecklist: [],
      musicSuggested: String(scene.mood || "").trim() || "Coerente con mood scena",
      ambientSoundSuggested: /esterno|forest|pioggia|notte|città/i.test(`${scene.environment} ${scene.description}`)
        ? "Ambiente esterno leggero"
        : "Room tone interno",
      sfxSuggested: "Da definire in mix",
      directingNote: [scene.camera, scene.lighting].filter(Boolean).join(" · ") || "—",
    };

    for (const cl of scClips) {
      const kind = inferClipKindForBeat(p, scene, cl);
      cl.clipAutoPlan = {
        clipSuggestedType: kind,
        clipSuggestedShotIntent: String(scene.camera || "").trim() || "inquadratura da piano",
        clipSuggestedSoundIntent: kind === STORY_CLIP_KIND.ENVIRONMENT ? "paesaggio sonoro" : "voce + ambiente",
        clipSuggestedDialogueMode:
          kind === STORY_CLIP_KIND.DIALOGUE || kind === STORY_CLIP_KIND.CONVERSATIONAL ? "multi_turn" : "narration_or_single",
        clipEstimatedDurationSec: Number(cl.duration_suggestion) > 0 ? Number(cl.duration_suggestion) : Math.round(sceneSec / Math.max(scClips.length, 1)),
      };
    }

    scene.storyAutoPlan.sceneProductionChecklist = buildSceneProductionChecklist(scene, scClips, charById);
  }

  for (const ch of p.characters || []) {
    const appearScenes = sceneList
      .filter((s) => !isEnvironmentScene(s) && (s.characters_present || []).includes(ch.id))
      .map((s) => s.title_it || s.id);
    ch.characterNarrativeProposal = {
      roleLabel: ch.character_role || (ch.is_protagonist ? "protagonist" : "support"),
      scenesAppearing: appearScenes,
      voiceSuggested: ch.is_protagonist ? "Voce neutra protagonista (ElevenLabs da assegnare)" : "Voce secondaria",
      presenceType:
        ch.character_role === "protagonist" || ch.is_protagonist
          ? "protagonista"
          : ch.character_role === "background"
            ? "contorno"
            : "secondario",
    };
    ch.characterGraphicApprovalStatus = ch.characterGraphicApprovalStatus || "narrative_pending";
  }

  p.storyPreproductionMeta = {
    version: STORY_AUTO_PLAN_VERSION,
    targetFilmDurationSec: target,
    generatedAt: new Date().toISOString(),
  };

  return p;
}

/**
 * @param {object} scene
 * @param {object[]} sceneClips
 * @param {Map<string, object>} charById
 */
export function buildSceneProductionChecklist(scene, sceneClips, charById) {
  const tasks = [];
  const add = (id, label, status = TASK_STATUS.PROPOSED) => {
    tasks.push({ id, label, status });
  };

  add(`cast_${scene.id}`, "Confermare cast scena", TASK_STATUS.PROPOSED);
  for (const cid of scene.characters_present || []) {
    const name = charById.get(cid)?.name || cid;
    add(`master_${scene.id}_${cid}`, `Master volto: ${name}`, TASK_STATUS.OPEN);
  }
  add(`scene_img_${scene.id}`, "Immagine scena base (FLUX)", TASK_STATUS.OPEN);
  add(`clips_${scene.id}`, `Produzione ${sceneClips.length || 1} clip video`, TASK_STATUS.PROPOSED);
  add(`voices_${scene.id}`, "Assegnazione voci ElevenLabs", TASK_STATUS.OPEN);
  add(`music_${scene.id}`, "Musica / bed (H6)", TASK_STATUS.PROPOSED);
  add(`amb_${scene.id}`, "Ambiente / SFX (H4)", TASK_STATUS.PROPOSED);

  return tasks;
}

/**
 * @param {object} plan
 * @param {number} targetFilmDurationSec
 * @returns {Promise<object|null>}
 */
export async function adaptPlanToTargetDuration(plan, targetFilmDurationSec) {
  const sec = clamp(Math.round(Number(targetFilmDurationSec) || 300), 30, 3600);
  const instruction = `OBIETTIVO DURATA: circa ${sec} secondi totali di film (~${(sec / 60).toFixed(1)} min).

Ricalibra il piano: numero di scene, durata suggerita delle clip (duration_suggestion), e sintesi delle scene, restando fedele alla storia già impostata nel piano. Non eliminare personaggi essenziali. Ogni clip deve avere action_it in italiano.

Restituisci SOLO JSON valido con lo stesso schema del piano.`;

  return planScenografiaContinue(plan, instruction);
}

export { TASK_STATUS as STORY_TASK_STATUS };
