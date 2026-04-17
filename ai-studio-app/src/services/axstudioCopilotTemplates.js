/**
 * Template testuali copilota — insert non distruttivo (append con marker).
 */

const MARKER = "— AXSTUDIO · suggerimento (modifica o cancella):\n";

/**
 * @typedef {'concept_prompt'|'character_master_prompt'|'scene_direction'|'narrative_structure'} AxstudioTemplateTarget
 */

/** @type {Record<string, { target: AxstudioTemplateTarget, text: string }>} */
export const AXSTUDIO_COPILOT_TEMPLATES = {
  concept_cinematic_open: {
    target: "concept_prompt",
    text: `${MARKER}Progetto cinematografico realistico: luce naturale, regia sobria, tensione emotiva contenuta. Un protagonista umano in un luogo credibile; progressione visiva chiara verso una rivelazione minore.\n`,
  },
  concept_spot_premium: {
    target: "concept_prompt",
    text: `${MARKER}Spot premium: ritmo visivo rapido, messaggio centrale memorabile, look fashion/commerciale di alto livello, color grading curato, pochi elementi distraenti.\n`,
  },
  concept_doc_emotional: {
    target: "concept_prompt",
    text: `${MARKER}Documentario emozionale: tono intimo, osservazione vicina ai volti, silenzi significativi, luce disponibile, sensazione di autenticità.\n`,
  },
  concept_fantasy_soft: {
    target: "concept_prompt",
    text: `${MARKER}Fantasy stylized soft: mondo coerente, magia suggerita più che esplicita, palette armoniosa, personaggi umani riconoscibili.\n`,
  },
  concept_horror_atmos: {
    target: "concept_prompt",
    text: `${MARKER}Horror atmosferico: paura implicita, ombre e spazi negativi, suono e silenzio come risorse; evita gore esplicito nel testo.\n`,
  },
  narrative_one_strong_scene: {
    target: "narrative_structure",
    text: `${MARKER}Struttura: una sola scena narrativa forte (un arco minimo: contesto → tensione → svolta visiva).\n`,
  },
  narrative_three_compact: {
    target: "narrative_structure",
    text: `${MARKER}Struttura: 3 scene compatte (apertura / confronto o svolta / chiusura emotiva).\n`,
  },
  narrative_five_progression: {
    target: "narrative_structure",
    text: `${MARKER}Struttura: 5 scene con progressione chiara (ogni scena avanza stato d’animo o informazione).\n`,
  },
  narrative_pace_slow: {
    target: "narrative_structure",
    text: `${MARKER}Ritmo: lento e contemplativo; privilegia inquadrature lunghe e pause leggibili.\n`,
  },
  narrative_pace_trailer: {
    target: "narrative_structure",
    text: `${MARKER}Ritmo: trailer-like; micro-beat ravvicinati, hook iniziale forte, climax verso la fine.\n`,
  },
  character_protagonist_mature_realistic: {
    target: "character_master_prompt",
    text: `${MARKER}Adulto, aspetto realistico e maturo: lineamenti naturali, pelle con texture credibile, espressione controllata, guardo diretto o leggermente fuori campo; coerenza con drama contemporaneo.\n`,
  },
  character_cinematic_beauty: {
    target: "character_master_prompt",
    text: `${MARKER}Look cinematic beauty: luce morbida da ritratto, proporzioni naturali, makeup naturale, capelli curati ma credibili; estetica da film mainstream.\n`,
  },
  character_fashion_editorial: {
    target: "character_master_prompt",
    text: `${MARKER}Fashion/editorial: styling marcato ma pulito, postura sicura, attitudine da servizio fotografico luxury; volto leggibile e netto.\n`,
  },
  character_elder_wise: {
    target: "character_master_prompt",
    text: `${MARKER}Anziano realistico: rughe naturali, capelli grigi o radi, espressione calma e autorevole; niente caricatura.\n`,
  },
  character_duo_leads: {
    target: "character_master_prompt",
    text: `${MARKER}Duo protagonista + comprimario: contrasto leggibile (età, temperamento o ruolo) ma stesso mondo visivo; entrambi umani riconoscibili.\n`,
  },
  scene_cam_wide_cinematic: {
    target: "scene_direction",
    text: `${MARKER}Regia scene: privilegia wide e grandangolo controllato, profondità di campo cinematografica, soggetto in rapporto chiaro con l’ambiente.\n`,
  },
  scene_alt_wide_medium: {
    target: "scene_direction",
    text: `${MARKER}Regia scene: alterna wide di contesto e medi per leggere emozione e gesti.\n`,
  },
  scene_close_emotion: {
    target: "scene_direction",
    text: `${MARKER}Regia scene: close-up emotivi su occhi e micro-espressioni; sfondo leggermente sfocato.\n`,
  },
  scene_cam_slow_move: {
    target: "scene_direction",
    text: `${MARKER}Regia scene: movimento camera lento (pan / push-in leggero), senza tagli frenetici.\n`,
  },
  scene_visual_realistic: {
    target: "scene_direction",
    text: `${MARKER}Look: realismo fotografico, luce fisica credibile, materiali tangibili, coerenza con il master personaggio.\n`,
  },
};

/**
 * @param {string} templateId
 * @returns {{ target: AxstudioTemplateTarget, text: string } | null}
 */
export function getCopilotTemplate(templateId) {
  const t = AXSTUDIO_COPILOT_TEMPLATES[templateId];
  return t ? { target: t.target, text: t.text } : null;
}

/**
 * Append se il marker AXSTUDIO non è già presente (evita duplicati grossolani).
 * @param {string} current
 * @param {string} addition
 */
export function appendTemplateNonDestructive(current, addition) {
  const c = current != null ? String(current) : "";
  const a = addition != null ? String(addition) : "";
  if (!a.trim()) return c;
  if (c.includes("AXSTUDIO · suggerimento")) {
    const tail = c.trimEnd();
    return tail.endsWith(a.trim()) ? c : `${tail}\n\n${a}`;
  }
  return c.trim() ? `${c.trim()}\n\n${a}` : a;
}
