/**
 * Scenografie Planner — LLM-driven scene analysis and planning.
 *
 * Takes a user prompt (Italian), sends it to the LLM (OpenRouter),
 * and returns a structured production plan:
 *   - characters to create (with appearance)
 *   - scenes to generate (with environment, lighting, etc.)
 *   - visual style
 *   - optional future clips
 *
 * The plan is presented for user approval before any API calls.
 */

const OPENROUTER_API_KEY = process.env.REACT_APP_OPENROUTER_API_KEY || "";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const PLANNER_MODELS = [
  "google/gemini-2.0-flash-001",
  "anthropic/claude-sonnet-4",
  "openai/gpt-4o-mini",
];

/** Ruolo narrativo per master identity-lock: solo protagonist e recurring ricevono master dedicato. */
export const CHARACTER_ROLE = {
  PROTAGONIST: "protagonist",
  RECURRING: "recurring",
  BACKGROUND: "background",
};

const VALID_CHARACTER_ROLES = new Set(Object.values(CHARACTER_ROLE));

/** Frasi meta-produzione da non usare nella riga narrativa UI. */
const META_IT_RE =
  /(creazione di|sequenza narrativa|progetto\s+scenografic|progetto\s+animato|basat[oa]\s+su|per\s+bambini\s*\(|animata\s+per\s+bambini|visual\s+studio|ai\s+studio)/i;

/** Parole tipiche narrativa inglese (euristica UI). */
const EN_UI_NARRATIVE_RE =
  /\b(the|and|or|his|her|their|she|he|they|was|were|sits|sitting|looks|looking|worried|sighs|sighed|hands?|head\s+in|rests?|table)\b/gi;

const IT_HINT_RE =
  /\b(il|la|lo|gli|le|un|una|uno|con|per|che|non|dalla|delle|degli|nello|questo|quella|così|come|anche|più|molto|tutto|tutta|suo|sua|sono|è\b|ha\b|hanno|si\b|nel\b|nella|sugli|una\s+scena|nella\s+scena)\b/gi;

/**
 * Euristica: testo che sembra narrativa inglese (non adatto alla UI italiana).
 * @param {string} s
 * @returns {boolean}
 */
export function looksLikeEnglishNarrative(s) {
  if (s == null || typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 10) return false;
  const enHits = (t.match(EN_UI_NARRATIVE_RE) || []).length;
  const itHits = (t.match(IT_HINT_RE) || []).length;
  if (itHits >= 2) return false;
  return enHits >= 2;
}

/**
 * Logline / sintesi progetto solo in italiano (per UI e indice).
 * @param {object|null} plan
 * @returns {string}
 */
export function resolveItalianPlanLogline(plan) {
  if (!plan) return "";
  const top = String(plan.summary_it || "").trim();
  if (top && !META_IT_RE.test(top) && !looksLikeEnglishNarrative(top)) return top.replace(/\s+/g, " ");
  for (const sc of plan.scenes || []) {
    const si = String(sc?.summary_it || "").trim();
    if (si && !META_IT_RE.test(si) && !looksLikeEnglishNarrative(si)) return si.replace(/\s+/g, " ");
  }
  const titles = (plan.scenes || [])
    .map((sc, idx) => String(sc?.title_it || "").trim() || `Scena ${idx + 1}`)
    .filter(Boolean)
    .slice(0, 2);
  if (titles.length) return titles.join(" · ");
  return "";
}

/**
 * Sintesi scena per UI (italiano; mai descrizione FLUX in inglese).
 * @param {object} scene
 * @param {object|null} plan
 * @param {{ maxLen?: number }} [opts]
 * @returns {string}
 */
export function resolveItalianSceneSummaryForDisplay(scene, plan, opts = {}) {
  const maxLen = opts.maxLen ?? 220;
  if (!scene) return "";
  const charById = new Map((plan?.characters || []).map((c) => [c.id, c]));
  const names = (scene.characters_present || []).map((id) => charById.get(id)?.name).filter(Boolean);
  const tit = String(scene.title_it || "").trim() || "Scena";
  let s = String(scene.summary_it || "").trim().replace(/\s+/g, " ");
  if (s && !META_IT_RE.test(s) && !looksLikeEnglishNarrative(s)) {
    return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
  }
  const fallback = names.length ? `${names.join(" e ")} in «${tit}».` : `Eventi in «${tit}».`;
  return fallback.length > maxLen ? `${fallback.slice(0, maxLen - 1)}…` : fallback;
}

const PLANNER_SYSTEM_PROMPT = `You are a production planner for an AI visual studio.
The user describes a scene, story or visual idea in Italian.

Your job is to analyze the prompt and extract a structured production plan in JSON.

RULES:
1. Identify ALL distinct characters (main + supporting). For each, describe appearance in English.
2. Identify ALL scenes (at least 1). For each, describe environment, lighting, mood, camera.
3. Identify the overall visual style (e.g. cinematic, cartoon, anime, photorealistic).
4. If the prompt implies a sequence/story, suggest clip breakdowns for future video.
5. Keep appearance descriptions concrete and physical (gender, age, build, hair, skin, outfit).
6. Each character MUST have a unique name/role.
7. The main protagonist should be listed first.
8. For each scene, specify which characters appear (characters_present must list every character visible in that shot).
9. For each character set "character_role": "protagonist" for the main lead(s), "recurring" for named characters who appear in multiple scenes or are story-important and need a consistent face, "background" for extras/crowd with no dedicated master.
10. All scene/character FLUX fields in English EXCEPT: top-level "summary_it", each scene's "summary_it", and each clip's "action_it" MUST be in Italian (user-facing copy).
11. Top-level "summary_it": one short Italian logline of the whole story (concrete; NO meta phrases like "creazione di", "sequenza narrativa", "progetto scenografico", "basata su", "per bambini", "animata per").
12. EVERY scene MUST include "summary_it": exactly ONE Italian sentence stating WHO does WHAT in THAT shot (pure story). Same forbidden meta phrases as above. Never describe the production process.
13. EVERY clip MUST include "action_it": one short Italian sentence (who does what in that beat). Include "action_en": concise English for video/model prompts only (never shown as primary UI text).

Return ONLY valid JSON (no markdown, no backticks):
{
  "summary_it": "Italian logline: concrete story, no production meta",
  "visual_style": "overall art style description",
  "is_animated": false,
  "characters": [
    {
      "id": "char_1",
      "name": "Character name/role",
      "is_protagonist": true,
      "character_role": "protagonist",
      "appearance": {
        "gender": "male|female",
        "age": "approximate age or range",
        "body_type": "build description",
        "hair": "hair description",
        "skin": "skin description",
        "face": "facial features",
        "outfit": "clothing/outfit description"
      },
      "appearance_prompt": "Full English physical description for FLUX"
    }
  ],
  "scenes": [
    {
      "id": "scene_1",
      "title_it": "Scene title in Italian",
      "summary_it": "Una sola frase in italiano: cosa succede in questa scena, con nomi propri se noti (no meta-produzione).",
      "description": "Full English scene description for FLUX",
      "environment": "environment details",
      "lighting": "lighting description",
      "mood": "mood/atmosphere",
      "camera": "camera angle/framing",
      "characters_present": ["char_1"],
      "outfit_override": null
    }
  ],
  "clips": [
    {
      "id": "clip_1",
      "scene_id": "scene_1",
      "action_it": "Una frase in italiano: cosa succede in questo clip (chi fa cosa).",
      "action_en": "Concise English beat for video/technical prompts only",
      "duration_suggestion": 5
    }
  ]
}`;

/**
 * Personaggi per cui generare e approvare un master (protagonisti + ricorrenti).
 * Compatibile con piani legacy senza character_role: usa is_protagonist e presenza in scene.
 * @param {object|null} plan
 * @returns {object[]}
 */
export function getCharactersNeedingMaster(plan) {
  if (!plan?.characters?.length) return [];
  const presentIds = new Set();
  for (const s of plan.scenes || []) {
    for (const id of s.characters_present || []) {
      if (id) presentIds.add(id);
    }
  }
  const picked = plan.characters.filter((c) => {
    if (VALID_CHARACTER_ROLES.has(c.character_role)) {
      return c.character_role === CHARACTER_ROLE.PROTAGONIST || c.character_role === CHARACTER_ROLE.RECURRING;
    }
    return c.is_protagonist === true || presentIds.has(c.id);
  });
  return picked.length > 0 ? picked : [plan.characters[0]];
}

/**
 * Etichetta UI breve per character_role (italiano).
 * @param {object} char
 */
export function characterRoleLabelIt(char) {
  const r = char?.character_role;
  if (r === CHARACTER_ROLE.PROTAGONIST) return "Protagonista";
  if (r === CHARACTER_ROLE.RECURRING) return "Ricorrente";
  if (r === CHARACTER_ROLE.BACKGROUND) return "Contorno";
  if (char?.is_protagonist) return "Protagonista";
  return "";
}

function assignCharacterRoles(plan) {
  const presentIds = new Set();
  for (const scene of plan.scenes || []) {
    for (const id of scene.characters_present || []) {
      if (id) presentIds.add(id);
    }
  }
  for (const char of plan.characters) {
    if (VALID_CHARACTER_ROLES.has(char.character_role)) continue;
    if (typeof char.character_role === "string") {
      const low = char.character_role.toLowerCase().trim();
      if (low === "co-protagonist" || low === "supporting" || low === "secondary") {
        char.character_role = CHARACTER_ROLE.RECURRING;
        continue;
      }
    }
    if (char.is_protagonist === true) {
      char.character_role = CHARACTER_ROLE.PROTAGONIST;
    } else if (presentIds.has(char.id)) {
      char.character_role = CHARACTER_ROLE.RECURRING;
    } else {
      char.character_role = CHARACTER_ROLE.BACKGROUND;
    }
  }
  for (const char of plan.characters) {
    if (char.character_role === CHARACTER_ROLE.BACKGROUND && presentIds.has(char.id)) {
      char.character_role = CHARACTER_ROLE.RECURRING;
    }
  }
}

/**
 * Riduce il piano serializzato per non superare limiti del modello nel merge.
 * @param {object} plan
 */
export function trimPlanForContinueContext(plan) {
  const p = JSON.parse(JSON.stringify(plan));
  if (Array.isArray(p.clips) && p.clips.length > 24) p.clips = p.clips.slice(0, 24);
  for (const s of p.scenes || []) {
    if (typeof s.description === "string" && s.description.length > 2000) {
      s.description = `${s.description.slice(0, 2000)}…`;
    }
  }
  let str = JSON.stringify(p);
  if (str.length > 48000) {
    p.clips = [];
    str = JSON.stringify(p);
  }
  return p;
}

/**
 * @param {{ role: string, content: string }[]} messages
 * @param {number} [maxTokens]
 * @returns {Promise<object|null>}
 */
async function runPlannerMessages(messages, maxTokens = 4000) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("REACT_APP_OPENROUTER_API_KEY not configured");
  }

  for (const model of PLANNER_MODELS) {
    try {
      console.log("[PLANNER] Trying model:", model);
      const res = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://axstudio.app",
          "X-Title": "AXSTUDIO Scenografie Planner",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens,
        }),
      });

      if (!res.ok) {
        console.warn("[PLANNER]", model, "HTTP", res.status);
        continue;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.warn("[PLANNER]", model, "empty response");
        continue;
      }

      const cleaned = content
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      const plan = JSON.parse(cleaned);

      if (!plan.characters || !plan.scenes) {
        console.warn("[PLANNER]", model, "invalid plan structure");
        continue;
      }

      console.log("[PLANNER] Success with", model, "—", plan.characters.length, "characters,", plan.scenes.length, "scenes");
      return plan;
    } catch (err) {
      console.warn("[PLANNER]", model, "failed:", err.message);
      continue;
    }
  }

  return null;
}

/**
 * Call the LLM planner with fallback model chain.
 *
 * @param {string} userPromptIT - User prompt in Italian
 * @returns {Promise<object|null>} Parsed production plan or null
 */
export async function planScenografia(userPromptIT) {
  return runPlannerMessages(
    [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: userPromptIT },
    ],
    4000
  );
}

/**
 * Mini-header narrativo (2 righe) dalla prima scena attiva del piano.
 * @param {object|null} plan
 * @param {string[]|undefined} deletedSceneIds
 * @returns {string}
 */
export function buildNarrativeHeaderDescription(plan, deletedSceneIds) {
  const del = new Set(deletedSceneIds || []);
  if (!plan?.scenes?.length) return "";
  const first = plan.scenes.find((s) => s && !del.has(s.id));
  if (!first) return "";
  const sceneNum = plan.scenes.indexOf(first) + 1;
  const byId = new Map((plan.characters || []).map((c) => [c.id, c.name]));
  const names = (first.characters_present || []).map((id) => byId.get(id)).filter(Boolean);
  const titleIt = String(first.title_it || "").trim() || `Scena ${sceneNum}`;
  const line1 = names.length ? `Scena ${sceneNum} — ${names.slice(0, 5).join(" e ")}` : `Scena ${sceneNum} — ${titleIt}`;

  let line2 = String(first.summary_it || "").trim().replace(/\s+/g, " ");
  if (!line2 || META_IT_RE.test(line2) || looksLikeEnglishNarrative(line2)) {
    const clips = Array.isArray(plan.clips) ? plan.clips : [];
    const c0 = clips.find((c) => c && (c.scene_id === first.id || c.sceneId === first.id));
    const actIt =
      c0 && typeof c0.action_it === "string"
        ? String(c0.action_it).trim()
        : "";
    if (actIt && !META_IT_RE.test(actIt) && !looksLikeEnglishNarrative(actIt)) {
      line2 = actIt.replace(/\s+/g, " ");
      if (line2.length > 200) line2 = `${line2.slice(0, 197)}…`;
    } else {
      line2 = names.length ? `${titleIt}: ${names.join(" e ")}.` : `${titleIt}.`;
    }
  }
  if (META_IT_RE.test(line2) || looksLikeEnglishNarrative(line2)) {
    line2 = names.length ? `${titleIt}: ${names.join(" e ")}.` : `${titleIt}.`;
  }
  if (line2.length > 200) line2 = `${line2.slice(0, 197)}…`;
  return `${line1}\n${line2}`.trim();
}

/**
 * Estende il piano esistente (nuove scene / sviluppi) senza ricominciare da zero.
 *
 * @param {object} existingPlan - Piano già validato
 * @param {string} userPromptIT - Istruzioni in italiano (cosa aggiungere o cambiare)
 * @returns {Promise<object|null>}
 */
export async function planScenografiaContinue(existingPlan, userPromptIT) {
  const body = trimPlanForContinueContext(existingPlan);
  const userBlock = `You are extending an EXISTING production plan. The JSON is the current plan.

Rules:
- Return ONLY valid JSON (no markdown) with the SAME schema as a fresh plan.
- Preserve character "id" when it is the same person; use new ids only for genuinely new characters.
- Preserve existing scene "id" and fields when unchanged.
- Add NEW scenes with NEW unique ids for beats the user describes (do not reuse ids for different content).
- Update top-level summary_it in Italian (concrete logline, no production meta).
- Every new or touched scene MUST have summary_it (Italian, one narrative sentence as in the schema).
- Every clip MUST have action_it in Italian and action_en in English for model prompts.
- Keep one global visual_style aligned with the existing plan unless the user explicitly asks to change the look.

EXISTING_PLAN_JSON:
${JSON.stringify(body)}

USER_CONTINUATION_PROMPT_ITALIAN:
${userPromptIT}
`;

  return runPlannerMessages(
    [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: userBlock },
    ],
    8000
  );
}

/**
 * Validate and normalize a production plan.
 * Ensures all required fields exist, assigns defaults for missing optional fields,
 * and guarantees at least one protagonist is marked.
 */
export function validatePlan(plan) {
  if (!plan) return { valid: false, error: "Piano vuoto" };
  if (!Array.isArray(plan.characters) || plan.characters.length === 0) {
    return { valid: false, error: "Nessun personaggio trovato" };
  }
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    return { valid: false, error: "Nessuna scena trovata" };
  }

  // Normalize characters
  for (let i = 0; i < plan.characters.length; i++) {
    const char = plan.characters[i];
    if (!char.id) char.id = `char_${i + 1}`;
    if (!char.name) char.name = `Personaggio ${i + 1}`;
    if (typeof char.is_protagonist !== "boolean") {
      char.is_protagonist = i === 0;
    }
    if (!char.appearance_prompt && !char.appearance) {
      return { valid: false, error: `Personaggio "${char.name}" senza descrizione fisica` };
    }
    // Build appearance_prompt from appearance object if missing
    if (!char.appearance_prompt && char.appearance) {
      const a = char.appearance;
      char.appearance_prompt = [
        a.gender, a.age, a.body_type, a.hair, a.skin, a.face, a.outfit,
      ].filter(Boolean).join(", ");
    }
  }

  // Ensure at least one protagonist
  if (!plan.characters.some((c) => c.is_protagonist)) {
    plan.characters[0].is_protagonist = true;
  }

  const charById = new Map(plan.characters.map((c) => [c.id, c]));
  // Normalize scenes
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i];
    if (!scene.id) scene.id = `scene_${i + 1}`;
    if (!scene.title_it) scene.title_it = `Scena ${i + 1}`;
    if (!scene.description) {
      return { valid: false, error: `Scena "${scene.title_it}" senza descrizione` };
    }
    // Default characters_present to first protagonist
    if (!Array.isArray(scene.characters_present) || scene.characters_present.length === 0) {
      const protag = plan.characters.find((c) => c.is_protagonist) || plan.characters[0];
      scene.characters_present = [protag.id];
    }
    const names = (scene.characters_present || []).map((id) => charById.get(id)?.name).filter(Boolean);
    const tit = String(scene.title_it || "").trim() || `Scena ${i + 1}`;
    let sum = String(scene.summary_it || "").trim().replace(/\s+/g, " ");
    if (!sum || META_IT_RE.test(sum) || looksLikeEnglishNarrative(sum)) {
      scene.summary_it = names.length ? `${names.join(" e ")} in «${tit}».` : `Eventi in «${tit}».`;
    } else {
      scene.summary_it = sum;
    }
  }

  // Normalize top-level fields — stile globale unico (testo per UI / matching preset)
  if (typeof plan.is_animated !== "boolean") plan.is_animated = false;
  if (!String(plan.visual_style || "").trim()) {
    plan.visual_style = plan.is_animated
      ? "Stylized 3D family animation, appealing character design, soft global illumination, consistent art direction across the whole project"
      : "Cinematic photorealistic film still, natural skin texture, dramatic lighting, cohesive color grade for the entire project";
  }
  if (!Array.isArray(plan.clips)) plan.clips = [];

  // Logline progetto (sempre italiano in UI)
  {
    const planSum = String(plan.summary_it || "").trim().replace(/\s+/g, " ");
    if (!planSum || META_IT_RE.test(planSum) || looksLikeEnglishNarrative(planSum)) {
      const firstGood = plan.scenes.find((sc) => {
        const si = String(sc.summary_it || "").trim();
        return si && !META_IT_RE.test(si) && !looksLikeEnglishNarrative(si);
      });
      if (firstGood) {
        plan.summary_it = String(firstGood.summary_it).trim().replace(/\s+/g, " ");
      } else {
        plan.summary_it =
          plan.scenes
            .map((sc, idx) => String(sc.title_it || "").trim() || `Scena ${idx + 1}`)
            .filter(Boolean)
            .slice(0, 3)
            .join(" · ") || "Progetto scenografico";
      }
    } else {
      plan.summary_it = planSum;
    }
  }

  const sceneById = new Map(plan.scenes.map((s) => [s.id, s]));
  for (const clip of plan.clips) {
    if (!clip || typeof clip !== "object") continue;
    const sid = clip.scene_id || clip.sceneId;
    const scene = sid ? sceneById.get(sid) : null;
    const tit = String(scene?.title_it || "Scena").trim() || "Scena";
    const cnames = (scene?.characters_present || []).map((id) => charById.get(id)?.name).filter(Boolean);
    let sceneSummary = String(scene?.summary_it || "").trim();
    if (!sceneSummary || META_IT_RE.test(sceneSummary) || looksLikeEnglishNarrative(sceneSummary)) {
      sceneSummary = cnames.length ? `${cnames.join(" e ")} in «${tit}».` : `Eventi in «${tit}».`;
    }

    let actionIt = String(clip.action_it ?? "").trim();
    let actionEn = String(clip.action_en ?? "").trim();
    const legacyAction = String(clip.action ?? "").trim();

    if (!actionIt && legacyAction) {
      if (looksLikeEnglishNarrative(legacyAction)) {
        if (!actionEn) actionEn = legacyAction;
        actionIt = sceneSummary;
      } else {
        actionIt = legacyAction;
      }
    }
    if (!actionIt) actionIt = sceneSummary;

    clip.action_it = actionIt.replace(/\s+/g, " ");
    if (actionEn) clip.action_en = actionEn.replace(/\s+/g, " ");
    else if (legacyAction && looksLikeEnglishNarrative(legacyAction)) {
      clip.action_en = legacyAction.replace(/\s+/g, " ");
    }
    // Retrocompat: `action` solo se esiste testo tecnico inglese per i motori
    delete clip.action;
    if (clip.action_en) clip.action = clip.action_en;
  }

  // Nessuno stile per-scena: solo stile progetto (evita mix futuri dal planner)
  for (const scene of plan.scenes) {
    if (scene && scene.visual_style != null) delete scene.visual_style;
  }

  assignCharacterRoles(plan);

  return { valid: true, error: null };
}
