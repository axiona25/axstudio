/**
 * AXSTUDIO — modello wizard capitolo Scenografie (guided-first).
 * Stato derivato da snapshot plain object (nessun hook React qui).
 */

/** @typedef {'not_started'|'in_progress'|'complete'|'needs_review'} WizardStepStatus */

export const WIZARD_STEP_IDS = /** @type {const} */ ([
  "concept",
  "narrative_plan",
  "characters",
  "audio",
  "scenes",
  "clip_builder",
  "preview_production",
  "final_render",
]);

/**
 * Definizione statica step: ordine UX prodotto, ancore DOM nell’editor.
 */
export const WIZARD_STEP_DEFS = [
  { id: "concept", label: "Concept", anchor: "ax-wizard-concept" },
  { id: "narrative_plan", label: "Piano narrativo", anchor: "ax-wizard-narrative" },
  { id: "characters", label: "Personaggi", anchor: "ax-wizard-characters" },
  { id: "audio", label: "Voci / audio", anchor: "ax-scenografie-anchor-narrators" },
  { id: "scenes", label: "Scene", anchor: "ax-scenografie-anchor-scenes" },
  { id: "clip_builder", label: "Clip Builder", anchor: "ax-scenografie-anchor-clips" },
  { id: "preview_production", label: "Preview / produzione", anchor: "ax-scenografie-anchor-timeline" },
  { id: "final_render", label: "Render finale", anchor: "ax-scenografie-anchor-final-actions" },
];

/**
 * Snapshot minimo calcolato nel parent (ScenografieProjectEditor).
 * @typedef {{
 *   hasPlan: boolean,
 *   projectTitle: string,
 *   promptLength: number,
 *   sceneCount: number,
 *   scenesMissingCount: number,
 *   projectStyleChosen: boolean,
 *   projectStyleLocked: boolean,
 *   mastersTotalNeeded: number,
 *   mastersReadyCount: number,
 *   allCharacterMastersApproved: boolean,
 *   narratorsCount: number,
 *   narratorsWithVoiceCount: number,
 *   approvedScenesCount: number,
 *   clipsReadyForMontage: boolean,
 *   timelineApproved: boolean,
 *   finalMontagePhase: string,
 *   planning: boolean,
 *   clipBuilderOpen: boolean,
 *   projectUiStatus?: string,
 *   pipelineLocked?: boolean,
 *   scenografiaPhase?: string,
 *   copilotStylePick?: Record<string, string|null|undefined>,
 *   firstApprovedSceneId?: string|null,
 *   activeRenderIntentId?: string|null,
 *   guidedSubmode?: string,
 *   audioMode?: string,
 * }} AxstudioWizardSnapshot
 */

/**
 * @param {AxstudioWizardSnapshot} s
 * @returns {WizardStepStatus}
 */
function statusConcept(s) {
  if (s.hasPlan) return "complete";
  const titleOk = String(s.projectTitle || "").trim().length > 0;
  const promptOk = (s.promptLength || 0) >= 24;
  if (promptOk && titleOk) return "complete";
  if (promptOk || titleOk) return "in_progress";
  return "not_started";
}

/**
 * @param {AxstudioWizardSnapshot} s
 * @returns {WizardStepStatus}
 */
function statusNarrative(s) {
  if (!s.hasPlan) return "not_started";
  if (s.planning) return "in_progress";
  if (s.sceneCount > 0) return "complete";
  return "in_progress";
}

/**
 * @param {AxstudioWizardSnapshot} s
 * @returns {WizardStepStatus}
 */
function statusCharacters(s) {
  if (!s.hasPlan) return "not_started";
  if (s.mastersTotalNeeded === 0) return "complete";
  if (s.mastersReadyCount >= s.mastersTotalNeeded && s.allCharacterMastersApproved) return "complete";
  if (s.mastersReadyCount > 0) return "in_progress";
  return "in_progress";
}

/**
 * @param {AxstudioWizardSnapshot} s
 * @returns {WizardStepStatus}
 */
function statusAudio(s) {
  if (!s.hasPlan) return "not_started";
  if ((s.narratorsWithVoiceCount || 0) > 0) return "complete";
  if ((s.narratorsCount || 0) > 0) return "in_progress";
  return "in_progress";
}

/**
 * @param {AxstudioWizardSnapshot} s
 * @returns {WizardStepStatus}
 */
function statusScenes(s) {
  if (!s.hasPlan) return "not_started";
  if (s.sceneCount === 0) return "in_progress";
  if ((s.scenesMissingCount || 0) === 0) return "complete";
  return "in_progress";
}

/**
 * @param {AxstudioWizardSnapshot} s
 * @returns {WizardStepStatus}
 */
function statusClipBuilder(s) {
  if (!s.hasPlan || (s.approvedScenesCount || 0) === 0) return "not_started";
  if (s.clipsReadyForMontage) return "complete";
  if ((s.approvedScenesCount || 0) > 0) return "in_progress";
  return "not_started";
}

/**
 * @param {AxstudioWizardSnapshot} s
 * @returns {WizardStepStatus}
 */
function statusPreviewProduction(s) {
  if (!s.clipsReadyForMontage) return "not_started";
  if (s.timelineApproved) return "complete";
  return "needs_review";
}

/**
 * @param {AxstudioWizardSnapshot} s
 * @returns {WizardStepStatus}
 */
function statusFinalRender(s) {
  const phase = String(s.finalMontagePhase || "");
  if (phase === "done") return "complete";
  if (phase === "assembly") return "in_progress";
  if (s.timelineApproved && s.clipsReadyForMontage) return "in_progress";
  return "not_started";
}

/**
 * Soft-block: step operativamente vuoto; il click resta permesso.
 * @param {string} stepId
 * @param {AxstudioWizardSnapshot} s
 * @returns {{ blocked: boolean, blockedReason: string|null }}
 */
export function deriveStepBlocked(stepId, s) {
  const locked = s.pipelineLocked === true;
  if (locked) {
    return { blocked: true, blockedReason: "Capitolo in sola lettura (montaggio/completato)." };
  }
  switch (stepId) {
    case "scenes":
      if (s.hasPlan && (s.mastersTotalNeeded || 0) > 0 && !s.allCharacterMastersApproved) {
        return { blocked: true, blockedReason: "Completa e approva i master personaggio prima delle scene." };
      }
      return { blocked: false, blockedReason: null };
    case "clip_builder":
      if (s.hasPlan && (s.approvedScenesCount || 0) === 0) {
        return { blocked: true, blockedReason: "Serve almeno una scena approvata per creare clip." };
      }
      return { blocked: false, blockedReason: null };
    case "preview_production":
      if (!s.clipsReadyForMontage) {
        return { blocked: true, blockedReason: "Completa le clip approvate prima della timeline." };
      }
      return { blocked: false, blockedReason: null };
    case "final_render": {
      const phase = String(s.finalMontagePhase || "");
      if (phase === "done") return { blocked: false, blockedReason: null };
      if (!s.clipsReadyForMontage || !s.timelineApproved) {
        return {
          blocked: true,
          blockedReason: "Servono clip pronte e timeline confermata prima del render finale.",
        };
      }
      return { blocked: false, blockedReason: null };
    }
    default:
      return { blocked: false, blockedReason: null };
  }
}

const STATUS_COMPUTE = {
  concept: statusConcept,
  narrative_plan: statusNarrative,
  characters: statusCharacters,
  audio: statusAudio,
  scenes: statusScenes,
  clip_builder: statusClipBuilder,
  preview_production: statusPreviewProduction,
  final_render: statusFinalRender,
};

/**
 * Dipendenze “soft”: usate solo per badge warning nel navigator (non blocchiamo il click).
 * @param {string} stepId
 * @returns {string[]}
 */
export function softPrerequisites(stepId) {
  switch (stepId) {
    case "narrative_plan":
      return ["concept"];
    case "characters":
      return ["narrative_plan"];
    case "audio":
      return ["characters"];
    case "scenes":
      return ["audio"];
    case "clip_builder":
      return ["scenes"];
    case "preview_production":
      return ["clip_builder"];
    case "final_render":
      return ["preview_production"];
    default:
      return [];
  }
}

/**
 * @param {string} stepId
 * @param {WizardStepStatus} st
 */
function stepMeetsPrereq(stepId, st) {
  return st === "complete" || st === "in_progress" || st === "needs_review";
}

/**
 * @param {AxstudioWizardSnapshot} snapshot
 * @returns {Array<{
 *   id: string,
 *   label: string,
 *   anchor: string,
 *   status: WizardStepStatus,
 *   prereqWarning: string|null,
 *   blocked: boolean,
 *   blockedReason: string|null,
 *   recommendedNext: boolean,
 * }>}
 */
export function deriveWizardStepsWithStatus(snapshot) {
  const statusById = {};
  for (const def of WIZARD_STEP_DEFS) {
    const fn = STATUS_COMPUTE[def.id];
    statusById[def.id] = fn ? fn(snapshot) : "not_started";
  }

  /** Primo step non completato in ordine (prossimo consigliato). */
  let recommendedId = null;
  for (const def of WIZARD_STEP_DEFS) {
    const st = statusById[def.id];
    if (st !== "complete") {
      recommendedId = def.id;
      break;
    }
  }

  return WIZARD_STEP_DEFS.map((def) => {
    const prereqs = softPrerequisites(def.id);
    const missing = prereqs.filter((pid) => {
      const st = statusById[pid];
      return !stepMeetsPrereq(pid, st);
    });
    const prereqWarning =
      missing.length > 0
        ? `Passi precedenti ancora da completare: ${missing.map((m) => WIZARD_STEP_DEFS.find((d) => d.id === m)?.label || m).join(", ")}`
        : null;
    const { blocked, blockedReason } = deriveStepBlocked(def.id, snapshot);
    return {
      id: def.id,
      label: def.label,
      anchor: def.anchor,
      status: statusById[def.id],
      prereqWarning,
      blocked,
      blockedReason,
      recommendedNext: recommendedId === def.id,
    };
  });
}

/**
 * @param {string} anchorId
 * @param {{ behavior?: ScrollBehavior }} [opts]
 */
export function scrollToWizardAnchor(anchorId, opts) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(anchorId);
  if (!el) return;
  el.scrollIntoView({ behavior: opts?.behavior || "smooth", block: "start" });
}
