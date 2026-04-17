/**
 * Copilota AXSTUDIO — modello guida strutturato (euristico).
 * Ogni `action` è un payload serializzabile gestito da `handleAxstudioGuideAction` nel parent.
 */

import { AXSTUDIO_RENDER_INTENT_PROFILES } from "../config/axstudioRenderIntentProfiles.js";

/**
 * @typedef {'info'|'success'|'warning'|'danger'} AxstudioStatusTone
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   description: string,
 *   kind: 'preset'|'selection'|'quality'|'mode'|'structure',
 *   disabled?: boolean,
 *   action: Record<string, unknown>,
 * }} AxstudioSuggestedChoice
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   variant?: 'primary'|'secondary'|'ghost'|'danger',
 *   disabled?: boolean,
 *   action: Record<string, unknown>,
 * }} AxstudioQuickAction
 *
 * @typedef {{
 *   stepId: string,
 *   title: string,
 *   statusTone: AxstudioStatusTone,
 *   primaryMessage: string,
 *   whyItMatters: string,
 *   suggestedChoices: AxstudioSuggestedChoice[],
 *   quickActions: AxstudioQuickAction[],
 *   warnings: string[],
 *   advancedDetails: Record<string, unknown>,
 * }} AxstudioCopilotGuideModel
 */

/**
 * Snapshot esteso (parent arricchisce `axWizardSnapshot`).
 * @typedef {import('../guided/axstudioWizardModel.js').AxstudioWizardSnapshot & {
 *   copilotStylePick?: Record<string, string|null|undefined>,
 *   firstApprovedSceneId?: string|null,
 *   firstClipIdForApprovedScene?: string|null,
 *   activeRenderIntentId?: string|null,
 *   guidedSubmode?: string,
 *   audioMode?: string,
 * }} AxstudioCopilotSnapshot
 */

/**
 * Compat: stesso nome export; ora restituisce `AxstudioCopilotGuideModel`.
 * @param {string} stepId
 * @param {Record<string, unknown>} s
 * @returns {AxstudioCopilotGuideModel}
 */
export function buildAxstudioGuideContent(stepId, s) {
  return buildAxstudioCopilotGuideModel(stepId, /** @type {AxstudioCopilotSnapshot} */ (s));
}

/**
 * Segnale UI «attention» per launcher copilota (icona animata).
 * @param {AxstudioCopilotGuideModel} guideModel
 * @param {{ blocked?: boolean, blockedReason?: string|null, prereqWarning?: string|null, recommendedNext?: boolean }|null|undefined} stepRow
 */
export function axstudioCopilotWantsAttention(guideModel, stepRow) {
  const m = guideModel;
  const actionable =
    (m.suggestedChoices || []).some((c) => !c.disabled) || (m.quickActions || []).some((a) => !a.disabled);
  const warnings = (m.warnings || []).length > 0;
  const row = stepRow;
  const blockedHint = row?.blocked === true && !!(row.blockedReason || row.prereqWarning);
  const recommended = row?.recommendedNext === true;
  return actionable || warnings || blockedHint || recommended;
}

/**
 * Digest stabile per ack quando l’utente apre la modale (nuovo contenuto ⇒ nuovo digest).
 * @param {string} stepId
 * @param {AxstudioCopilotGuideModel} guideModel
 * @param {{ blocked?: boolean, recommendedNext?: boolean }|null|undefined} stepRow
 */
export function axstudioCopilotAttentionDigest(stepId, guideModel, stepRow) {
  const m = guideModel;
  const row = stepRow;
  return JSON.stringify({
    stepId,
    c: (m.suggestedChoices || []).map((x) => `${x.id}:${x.disabled ? 1 : 0}`),
    a: (m.quickActions || []).map((x) => `${x.id}:${x.disabled ? 1 : 0}`),
    w: m.warnings || [],
    blk: row?.blocked === true ? 1 : 0,
    rec: row?.recommendedNext === true ? 1 : 0,
  });
}

/**
 * @param {AxstudioCopilotSnapshot} snap
 */
function baseWarnings(snap) {
  const w = [];
  if (snap.clipBuilderOpen) {
    w.push("Clip Builder aperto: chiudi per lavorare sulla lista clip.");
  }
  return w;
}

/**
 * @param {AxstudioCopilotSnapshot} snap
 * @returns {AxstudioStatusTone}
 */
function toneForStep(stepId, snap) {
  if (snap.pipelineLocked) return "warning";
  switch (stepId) {
    case "final_render":
      return String(snap.finalMontagePhase) === "done" ? "success" : "info";
    case "preview_production":
      return snap.timelineApproved ? "success" : "warning";
    default:
      return "info";
  }
}

/**
 * @param {string} stepId
 * @param {AxstudioCopilotSnapshot} snap
 * @returns {AxstudioCopilotGuideModel}
 */
export function buildAxstudioCopilotGuideModel(stepId, snap) {
  const pick = snap.copilotStylePick || {};
  const style = (key) => pick[key] || null;
  const warnings = baseWarnings(snap);
  const locked = snap.pipelineLocked === true;
  const canStyle =
    !locked && !snap.projectStyleLocked && String(snap.scenografiaPhase || "") === "plan";

  const advancedDetails = {
    stepId,
    renderIntent: snap.activeRenderIntentId || null,
    guidedSubmode: snap.guidedSubmode || null,
    audioMode: snap.audioMode || null,
  };

  /** @type {(a: Record<string, unknown>) => boolean} */
  const dis = (extra) => locked || !!extra;

  switch (stepId) {
    case "concept": {
      const pri = style("cinematic_realistic");
      return {
        stepId,
        title: "Concept",
        statusTone: toneForStep(stepId, snap),
        primaryMessage:
          (snap.promptLength || 0) < 24
            ? "Titolo + poche righe sull’idea: poi «Analizza prompt»."
            : "Hai testo sufficiente: lancia l’analisi o affina con un preset sotto.",
        whyItMatters: "Il concept alimenta piano, cast e stile senza farti scrivere pagine.",
        suggestedChoices: [
          {
            id: "cinematic_realistic",
            label: "Cinematico realistico",
            description: "Look da film, fotorealistico.",
            kind: "preset",
            disabled: dis(!canStyle || !pri),
            action: { type: "apply_project_style", presetId: pri },
          },
          {
            id: "spot_premium",
            label: "Spot premium",
            description: "Commerciale luxury, ritmo visivo.",
            kind: "preset",
            disabled: dis(!canStyle || !style("spot_premium")),
            action: { type: "apply_project_style", presetId: style("spot_premium") },
          },
          {
            id: "doc_emotional",
            label: "Documentario emozionale",
            description: "Intimo, autentico, luce naturale.",
            kind: "preset",
            disabled: dis(!canStyle || !style("doc_emotional")),
            action: { type: "apply_project_style", presetId: style("doc_emotional") },
          },
          {
            id: "fantasy_stylized",
            label: "Fantasy stylized",
            description: "Illustrato morbido, mondo coerente.",
            kind: "preset",
            disabled: dis(!canStyle || !style("fantasy_stylized")),
            action: { type: "apply_project_style", presetId: style("fantasy_stylized") },
          },
          {
            id: "horror_atmos",
            label: "Horror atmosferico",
            description: "Ombre, tensione implicita.",
            kind: "preset",
            disabled: dis(!canStyle || !style("horror_atmos")),
            action: { type: "apply_project_style", presetId: style("horror_atmos") },
          },
        ],
        quickActions: [
          {
            id: "focus_concept",
            label: "Focus concept",
            variant: "primary",
            disabled: locked,
            action: { type: "focus_field", field: "concept_prompt" },
          },
          {
            id: "tpl_cinematic_open",
            label: "Testo base cinematico",
            variant: "secondary",
            disabled: locked,
            action: { type: "insert_template", templateId: "concept_cinematic_open", mergeMode: "append" },
          },
          {
            id: "next_narrative",
            label: "Passo successivo",
            variant: "ghost",
            disabled: locked,
            action: { type: "go_to_next_recommended_step" },
          },
        ],
        warnings,
        advancedDetails,
      };
    }

    case "narrative_plan": {
      return {
        stepId,
        title: "Piano narrativo",
        statusTone: toneForStep(stepId, snap),
        primaryMessage: snap.planning
          ? "Analisi in corso…"
          : snap.hasPlan
            ? "Conferma struttura e scene; usa i ritmi sotto come append sicuro al prompt."
            : "Genera il piano da «Analizza prompt».",
        whyItMatters: "Il piano fissa quante scene e che arco narrativo produrre.",
        suggestedChoices: [
          {
            id: "narr_1",
            label: "1 scena forte",
            description: "Un solo momento ad alto impatto.",
            kind: "structure",
            disabled: locked,
            action: { type: "insert_template", templateId: "narrative_one_strong_scene", mergeMode: "append" },
          },
          {
            id: "narr_3",
            label: "3 scene compatte",
            description: "Inizio / svolta / chiusura.",
            kind: "structure",
            disabled: locked,
            action: { type: "insert_template", templateId: "narrative_three_compact", mergeMode: "append" },
          },
          {
            id: "narr_5",
            label: "5 scene progressive",
            description: "Progressione chiara.",
            kind: "structure",
            disabled: locked,
            action: { type: "insert_template", templateId: "narrative_five_progression", mergeMode: "append" },
          },
          {
            id: "narr_slow",
            label: "Ritmo lento",
            description: "Contemplativo, respiro lungo.",
            kind: "mode",
            disabled: locked,
            action: { type: "insert_template", templateId: "narrative_pace_slow", mergeMode: "append" },
          },
          {
            id: "narr_trailer",
            label: "Ritmo trailer",
            description: "Hook e micro-beat ravvicinati.",
            kind: "mode",
            disabled: locked,
            action: { type: "insert_template", templateId: "narrative_pace_trailer", mergeMode: "append" },
          },
        ],
        quickActions: [
          {
            id: "scroll_plan",
            label: "Vedi piano",
            variant: "primary",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-wizard-narrative" },
          },
          {
            id: "sub_simple",
            label: "Sottotipo: narrazione lineare",
            variant: "ghost",
            disabled: locked,
            action: { type: "set_guided_submode", value: "simple_narration" },
          },
        ],
        warnings,
        advancedDetails,
      };
    }

    case "characters": {
      return {
        stepId,
        title: "Personaggi",
        statusTone: toneForStep(stepId, snap),
        primaryMessage:
          (snap.mastersTotalNeeded || 0) === 0
            ? "Nessun master obbligatorio: avanza alle scene."
            : "Genera e approva ogni master prima delle scene.",
        whyItMatters: "Il volto canonico evita drift tra le scene.",
        suggestedChoices: [
          {
            id: "ch_mature",
            label: "Protagonista maturo realistico",
            description: "Volto naturale adulto.",
            kind: "preset",
            disabled: locked || !snap.hasPlan,
            action: { type: "insert_template", templateId: "character_protagonist_mature_realistic", target: "character_master" },
          },
          {
            id: "ch_beauty",
            label: "Cinematic beauty",
            description: "Ritratto da film mainstream.",
            kind: "preset",
            disabled: locked || !snap.hasPlan,
            action: { type: "insert_template", templateId: "character_cinematic_beauty", target: "character_master" },
          },
          {
            id: "ch_fashion",
            label: "Fashion / editorial",
            description: "Look da servizio luxury.",
            kind: "preset",
            disabled: locked || !snap.hasPlan,
            action: { type: "insert_template", templateId: "character_fashion_editorial", target: "character_master" },
          },
          {
            id: "ch_elder",
            label: "Anziano realistico",
            description: "Età avanzata credibile.",
            kind: "preset",
            disabled: locked || !snap.hasPlan,
            action: { type: "insert_template", templateId: "character_elder_wise", target: "character_master" },
          },
          {
            id: "ch_duo",
            label: "Duo protagonista + comprimario",
            description: "Due figure contrastate, stesso mondo.",
            kind: "structure",
            disabled: locked || !snap.hasPlan,
            action: { type: "insert_template", templateId: "character_duo_leads", target: "character_master" },
          },
        ],
        quickActions: [
          {
            id: "focus_masters",
            label: "Vai ai master",
            variant: "primary",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-wizard-characters" },
          },
          {
            id: "to_audio",
            label: "Voci",
            variant: "ghost",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-narrators" },
          },
        ],
        warnings,
        advancedDetails,
      };
    }

    case "audio": {
      return {
        stepId,
        title: "Voci / audio",
        statusTone: toneForStep(stepId, snap),
        primaryMessage: "Imposta narratore e (in Clip Builder) dialogo vs narrato.",
        whyItMatters: "Voce coerente = meno riscritture tra le clip.",
        suggestedChoices: [
          {
            id: "au_narr",
            label: "Solo narratore",
            description: "Voice-over continuo.",
            kind: "mode",
            disabled: locked,
            action: { type: "set_audio_mode", value: "narrator_only" },
          },
          {
            id: "au_dlg2",
            label: "Dialogo 2 personaggi",
            description: "Clip dialogate (due voci).",
            kind: "mode",
            disabled: locked,
            action: { type: "set_audio_mode", value: "dialogue_two" },
          },
          {
            id: "au_narr_atmo",
            label: "Narratore + atmosfera",
            description: "Priorità voce + letto sonoro in clip.",
            kind: "mode",
            disabled: locked,
            action: { type: "set_audio_mode", value: "narrator_atmosphere" },
          },
          {
            id: "au_trailer",
            label: "Voce trailer",
            description: "Enfasi e ritmo da promo.",
            kind: "mode",
            disabled: locked,
            action: { type: "set_audio_mode", value: "cinematic_trailer_voice" },
          },
          {
            id: "au_intimate",
            label: "Storytelling intimo",
            description: "Whisper / vicinanza al microfono.",
            kind: "mode",
            disabled: locked,
            action: { type: "set_audio_mode", value: "intimate_story" },
          },
        ],
        quickActions: [
          {
            id: "focus_narrators",
            label: "Apri narratori",
            variant: "primary",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-narrators" },
          },
        ],
        warnings,
        advancedDetails,
      };
    }

    case "scenes": {
      return {
        stepId,
        title: "Scene",
        statusTone: toneForStep(stepId, snap),
        primaryMessage:
          (snap.scenesMissingCount || 0) > 0
            ? "Completa le immagini mancanti e approva."
            : "Approva le scene pronte per il video.",
        whyItMatters: "Solo scene approvate entrano nel flusso clip.",
        suggestedChoices: [
          {
            id: "sc_wide",
            label: "Wide cinematografiche",
            description: "Grandangolo e ambiente.",
            kind: "preset",
            disabled: locked,
            action: { type: "insert_template", templateId: "scene_cam_wide_cinematic", mergeMode: "append" },
          },
          {
            id: "sc_alt",
            label: "Wide + medio",
            description: "Alternanza leggibile.",
            kind: "structure",
            disabled: locked,
            action: { type: "insert_template", templateId: "scene_alt_wide_medium", mergeMode: "append" },
          },
          {
            id: "sc_close",
            label: "Close-up emotivi",
            description: "Volto e micro-espressioni.",
            kind: "preset",
            disabled: locked,
            action: { type: "insert_template", templateId: "scene_close_emotion", mergeMode: "append" },
          },
          {
            id: "sc_slow",
            label: "Camera lenta",
            description: "Movimento contenuto.",
            kind: "mode",
            disabled: locked,
            action: { type: "insert_template", templateId: "scene_cam_slow_move", mergeMode: "append" },
          },
          {
            id: "sc_real",
            label: "Realismo visivo",
            description: "Luce e materiali credibili.",
            kind: "quality",
            disabled: locked,
            action: { type: "insert_template", templateId: "scene_visual_realistic", mergeMode: "append" },
          },
        ],
        quickActions: [
          {
            id: "go_scenes",
            label: "Area scene",
            variant: "primary",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-scenes" },
          },
        ],
        warnings,
        advancedDetails,
      };
    }

    case "clip_builder": {
      const sceneId = snap.firstApprovedSceneId || null;
      const canOpen = !locked && sceneId && snap.hasPlan;
      return {
        stepId,
        title: "Clip Builder",
        statusTone: (snap.approvedScenesCount || 0) === 0 ? "warning" : toneForStep(stepId, snap),
        primaryMessage:
          (snap.approvedScenesCount || 0) === 0
            ? "Approva almeno una scena per sbloccare le clip."
            : "Apri il builder: preview per iterare, final solo dopo validazione.",
        whyItMatters: "La preview è leggera; il final è consegna montaggio (non confondere).",
        suggestedChoices: [
          {
            id: "pv_fast",
            label: AXSTUDIO_RENDER_INTENT_PROFILES.preview_fast.label,
            description: AXSTUDIO_RENDER_INTENT_PROFILES.preview_fast.intendedUse,
            kind: "quality",
            disabled: locked,
            action: { type: "set_render_profile", profile: "preview_fast" },
          },
          {
            id: "pv_bal",
            label: AXSTUDIO_RENDER_INTENT_PROFILES.preview_balanced.label,
            description: AXSTUDIO_RENDER_INTENT_PROFILES.preview_balanced.intendedUse,
            kind: "quality",
            disabled: locked,
            action: { type: "set_render_profile", profile: "preview_balanced" },
          },
          {
            id: "clip_dlg",
            label: "Dialogo realistico",
            description: "Intent: clip dialogata (scegli tipo nel builder).",
            kind: "mode",
            disabled: locked,
            action: { type: "set_audio_mode", value: "dialogue_two" },
          },
          {
            id: "clip_narr_cin",
            label: "Narrato cinematografico",
            description: "Intent: narrato + regia testuale.",
            kind: "mode",
            disabled: locked,
            action: { type: "set_audio_mode", value: "narrator_only" },
          },
          {
            id: "open_builder",
            label: "Apri Clip Builder",
            description: sceneId ? `Scena: ${sceneId}` : "Serve una scena approvata.",
            kind: "selection",
            disabled: !canOpen,
            action: { type: "open_clip_builder_for_scene", sceneId },
          },
        ],
        quickActions: [
          {
            id: "clips_area",
            label: "Lista clip",
            variant: "primary",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-clips" },
          },
          {
            id: "timeline_next",
            label: "Timeline",
            variant: "ghost",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-timeline" },
          },
        ],
        warnings,
        advancedDetails: {
          ...advancedDetails,
          previewHint: AXSTUDIO_RENDER_INTENT_PROFILES.preview_fast.outputHint,
          finalHint: "Export HQ = montaggio finale (sezione Render), non la preview clip.",
        },
      };
    }

    case "preview_production": {
      return {
        stepId,
        title: "Preview / produzione",
        statusTone: toneForStep(stepId, snap),
        primaryMessage: snap.timelineApproved
          ? "Timeline ok: passa al montaggio finale."
          : "Conferma ordine scene/clip nella timeline.",
        whyItMatters: "L’ordine narrativo è vincolante per il film finito.",
        suggestedChoices: [
          {
            id: "pv_smoke",
            label: "Smoke test rapido",
            description: "Intent preview veloce.",
            kind: "quality",
            disabled: locked,
            action: { type: "set_render_profile", profile: "preview_fast" },
          },
          {
            id: "pv_val",
            label: "Validazione immagine+audio",
            description: "Intent preview bilanciata.",
            kind: "quality",
            disabled: locked,
            action: { type: "set_render_profile", profile: "preview_balanced" },
          },
          {
            id: "pv_timing",
            label: "Controllo timing",
            description: "Ripeti playback timeline.",
            kind: "mode",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-timeline" },
          },
          {
            id: "pv_motion",
            label: "Preview movimento",
            description: "Verifica clip in sequenza.",
            kind: "mode",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-clips" },
          },
          {
            id: "pv_dialogue",
            label: "Preview dialogo",
            description: "Controlla clip dialogate nel builder.",
            kind: "mode",
            disabled: locked || !(snap.firstApprovedSceneId && snap.hasPlan),
            action: {
              type: "open_clip_builder_for_scene",
              sceneId: snap.firstApprovedSceneId,
            },
          },
        ],
        quickActions: [
          {
            id: "tl",
            label: "Timeline",
            variant: "primary",
            disabled: locked || !snap.clipsReadyForMontage,
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-timeline" },
          },
          {
            id: "final_cta",
            label: "Render finale",
            variant: "secondary",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-final-actions" },
          },
        ],
        warnings,
        advancedDetails,
      };
    }

    case "final_render": {
      return {
        stepId,
        title: "Render finale",
        statusTone: String(snap.finalMontagePhase) === "done" ? "success" : toneForStep(stepId, snap),
        primaryMessage:
          String(snap.finalMontagePhase) === "done"
            ? "Montaggio completato."
            : "Scegli risoluzione target montaggio (intento consegna).",
        whyItMatters: "Il montaggio ricodifica verso HD/2K/4K; clip cloud restano ciò che sono.",
        suggestedChoices: [
          {
            id: "f1080",
            label: AXSTUDIO_RENDER_INTENT_PROFILES.final_1080p.label,
            description: AXSTUDIO_RENDER_INTENT_PROFILES.final_1080p.intendedUse,
            kind: "quality",
            disabled: locked,
            action: { type: "set_render_profile", profile: "final_1080p" },
          },
          {
            id: "f2k",
            label: AXSTUDIO_RENDER_INTENT_PROFILES.final_2k.label,
            description: AXSTUDIO_RENDER_INTENT_PROFILES.final_2k.intendedUse,
            kind: "quality",
            disabled: locked,
            action: { type: "set_render_profile", profile: "final_2k" },
          },
          {
            id: "f4k",
            label: AXSTUDIO_RENDER_INTENT_PROFILES.final_4k.label,
            description: AXSTUDIO_RENDER_INTENT_PROFILES.final_4k.intendedUse,
            kind: "quality",
            disabled: locked,
            action: { type: "set_render_profile", profile: "final_4k" },
          },
          {
            id: "prio_qual",
            label: "Priorità qualità",
            description: "4K o 2K se il hardware regge.",
            kind: "quality",
            disabled: locked,
            action: { type: "set_render_profile", profile: "final_4k" },
          },
          {
            id: "prio_stable",
            label: "Priorità stabilità",
            description: "1080p: meno carico, più prevedibile.",
            kind: "quality",
            disabled: locked,
            action: { type: "set_render_profile", profile: "final_1080p" },
          },
        ],
        quickActions: [
          {
            id: "final_actions",
            label: "Azioni montaggio",
            variant: "primary",
            disabled: locked,
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-final-actions" },
          },
          {
            id: "montage_panel",
            label: "Pannello montaggio",
            variant: "ghost",
            disabled: locked || String(snap.finalMontagePhase) !== "assembly",
            action: { type: "scroll_to_anchor", anchorId: "ax-scenografie-anchor-montage" },
          },
        ],
        warnings,
        advancedDetails: {
          ...advancedDetails,
          honestNote:
            "Risoluzione clip da provider non controllata da questo repo; final_* = target export ffmpeg montaggio.",
        },
      };
    }

    default:
      return {
        stepId,
        title: "AXSTUDIO",
        statusTone: "info",
        primaryMessage: "Seleziona uno step nella barra.",
        whyItMatters: "",
        suggestedChoices: [],
        quickActions: [],
        warnings,
        advancedDetails,
      };
  }
}
