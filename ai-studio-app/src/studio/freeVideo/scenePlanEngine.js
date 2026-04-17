/**
 * Video libero — scene plan LLM (Kling / frame coherence).
 * Extracted from App.js.
 */

import { LLM_MODELS, OPENROUTER_API_URL, OPENROUTER_API_KEY } from "../../services/openRouterFreeStudio.js";

const SCENE_PLAN_SYSTEM_PROMPT =
  "You are an expert AI video scene planner for Kling 3.0 Pro (image-to-video). " +
  "The user describes a video scene. Your job is to decompose it into a structured plan. " +
  "\n\n=== SEMANTIC GUARDRAIL — ABSOLUTE RULE (HIGHEST PRIORITY) ===" +
  "\nYou MUST NOT invent, assume, or infer ANY of the following unless EXPLICITLY stated in the user's prompt or character metadata:" +
  "\n- Materials: metal, metallic, armor, chrome, glass, wood, stone, crystal, leather, fur, scales, etc." +
  "\n- Costume/body parts: wings, cape, sword, gun, helmet, shield, crown, horns, tail, claws, etc." +
  "\n- Object types: vehicle, car, chassis, bodywork, motorcycle, mech, robot, spaceship, etc." +
  "\n- Surface attributes: metallic reflections, armor plates, mechanical joints, robotic plating, glowing runes, etc." +
  "\n" +
  "\nFORBIDDEN PHRASES (never use unless the user explicitly mentions them):" +
  "\n'metallic armor', 'metal body', 'metallic reflections on armor', 'chrome surface', 'armored figure'," +
  "\n'mechanical suit', 'robotic plating', 'vehicle surface', 'bodywork reflections', 'metal chassis'," +
  "\n'armor plates', 'gleaming metal', 'steel body', 'iron plating'" +
  "\n" +
  "\nSAFE GENERIC WORDING (use these instead when describing light/appearance on a character):" +
  "\n'sunset light on the character', 'warm highlights on the outfit', 'golden-hour light on the figure'," +
  "\n'dramatic rim light on the silhouette', 'soft light on the costume', 'ambient glow on the character'," +
  "\n'light reflecting on the character's outfit', 'highlights across the figure'" +
  "\n" +
  "\nNAMED CHARACTERS: If the subject is a named character (e.g. 'Kiavik', 'Luna', etc.) and you have NO metadata " +
  "describing their specific materials or costume details, you MUST refer to them ONLY as 'the character', " +
  "'the figure', 'the character's outfit/costume/silhouette'. Let the reference image define appearance. " +
  "Do NOT guess what they wear, what they are made of, or what they carry." +
  "\n" +
  "\nWRONG: 'golden sunset light reflecting off metallic armor' (invented armor)" +
  "\nWRONG: 'metallic reflections on the character's body' (invented material)" +
  "\nWRONG: 'wind catching the character's cape' (invented cape)" +
  "\nRIGHT: 'golden sunset light on the character' (safe, generic)" +
  "\nRIGHT: 'warm highlights on the outfit' (safe, generic)" +
  "\nRIGHT: 'wind in the character's hair' (only if hair is mentioned or visible in reference)" +
  "\n=== END SEMANTIC GUARDRAIL ===" +
  "\n\nYou MUST identify: " +
  "1) The PRIMARY ACTION — the single most important movement/event that must dominate the video. " +
  "2) The START STATE — what the opening frame should look like (where the subject is, what pose, what framing). " +
  "3) The END STATE — where the scene should conclude. " +
  "4) The CAMERA PLAN — how the camera moves during the scene. " +
  "5) SECONDARY ELEMENTS — ambient details, environment, lighting, weather. ONLY elements from the user's prompt or generic atmosphere (sky, clouds, sunlight, wind, ground). " +
  "6) DURATION STRATEGY — how to fit the action into the given duration. " +
  "7) AVOID ACTIONS — things the video must NOT do (anti-misinterpretation hints). " +
  "8) OPENING FRAME PROMPT — a standalone image prompt describing ONLY the first frame of the video. " +
  "   This must show the START STATE, not a generic standing pose. " +
  "   If the action is a descent, the opening frame must show the subject IN THE AIR. " +
  "   If the action is running, the opening frame must show the subject MID-STRIDE. " +
  "   The opening frame must NEVER be a static neutral pose unless that IS the start state. " +
  "   Do NOT add materials, costume details, or attributes the user didn't mention. " +
  "   Use ONLY safe generic wording for character appearance." +
  "\n\nCRITICAL RULES: " +
  "- The primary_action must be the FOCUS of the video's limited duration. " +
  "- For 5s: only ONE action. Do not attempt sequences. " +
  "- For 10s: at most 2-3 connected movements. " +
  "- The opening_frame_prompt must be a valid, self-contained image generation prompt (40-80 words, English). " +
  "- The opening_frame_prompt must describe the START STATE, not the reference photo's pose. " +
  "- Include character appearance hints from the reference context if provided, but do NOT invent new appearance attributes. " +
  "- When uncertain about a character's look, use 'the character', 'the figure', 'the outfit' — NEVER specific invented materials." +
  "\n\nReturn ONLY valid JSON (no markdown, no backticks): " +
  '{"primary_action":"short English description of main action",' +
  '"start_state":"what the opening frame shows",' +
  '"end_state":"where the scene concludes",' +
  '"camera_plan":"camera movement description",' +
  '"secondary_elements":["element1","element2"],' +
  '"duration_strategy":"how to fit into Xs",' +
  '"avoid_actions":["do not X","do not Y"],' +
  '"opening_frame_prompt":"detailed English image prompt for the opening frame",' +
  '"action_emphasis_prompt":"1-2 sentence English addition to enforce the dominant action in the video prompt"}';

export async function buildScenePlan(promptIT, promptEN, duration, referenceContext = "", visualStyle = "", directionStyle = "") {
  const context = [
    `Scene (IT): ${promptIT}`,
    promptEN ? `Scene (EN): ${promptEN}` : "",
    `Duration: ${duration}s`,
    referenceContext ? `Reference image context: ${referenceContext}` : "",
    visualStyle ? `Visual style: ${visualStyle}` : "",
    directionStyle ? `Direction style: ${directionStyle}` : "",
  ].filter(Boolean).join("\n");

  for (const model of LLM_MODELS) {
    try {
      const res = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://axstudio.app",
          "X-Title": "AXSTUDIO",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SCENE_PLAN_SYSTEM_PROMPT },
            { role: "user", content: context },
          ],
          temperature: 0.5,
          max_tokens: 600,
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) continue;
      const clean = text.replace(/```json|```/g, "").trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.primary_action && parsed.opening_frame_prompt) {
        const rawPlan = {
          primary_action: parsed.primary_action,
          start_state: parsed.start_state || "",
          end_state: parsed.end_state || "",
          camera_plan: parsed.camera_plan || "",
          secondary_elements: Array.isArray(parsed.secondary_elements) ? parsed.secondary_elements : [],
          duration_strategy: parsed.duration_strategy || "",
          avoid_actions: Array.isArray(parsed.avoid_actions) ? parsed.avoid_actions : [],
          opening_frame_prompt: parsed.opening_frame_prompt,
          action_emphasis_prompt: parsed.action_emphasis_prompt || "",
        };
        const { plan: sanitizedPlan, guardrailApplied, replacements } = sanitizeScenePlan(rawPlan, promptIT, promptEN);
        if (process.env.NODE_ENV === "development") {
          console.log("[SCENE PLAN SEMANTIC GUARDRAIL]", {
            scenePlanBeforeSanitization: rawPlan,
            scenePlanAfterSanitization: sanitizedPlan,
            semanticGuardrailApplied: guardrailApplied,
            replacements,
          });
        }
        return sanitizedPlan;
      }
    } catch (e) {
      console.warn("[SCENE PLAN] Model failed:", e.message);
    }
  }
  return null;
}

export function buildOpeningFramePrompt(scenePlan, referenceContext, visualStylePrompt, identityClause, characterSignatureClause, characterVisualSignatureClause) {
  if (!scenePlan?.opening_frame_prompt) return null;
  const parts = [
    scenePlan.opening_frame_prompt,
    characterSignatureClause,
    characterVisualSignatureClause,
    identityClause,
    visualStylePrompt,
    "masterpiece, best quality, highly detailed, 8K",
  ].filter(Boolean);
  return parts.join(", ");
}

export function buildAvoidActionsNegative(scenePlan) {
  if (!scenePlan?.avoid_actions?.length) return "";
  return scenePlan.avoid_actions.join(", ");
}

// ── Semantic Sanitizer for Scene Plan (post-LLM guardrail) ──────────────────
const INVENTED_MATERIAL_PATTERNS = [
  /\bmetall?ic\s+(armor|body|bodywork|plating|surface|chassis|reflections?\s+on\s+armor|suit)\b/gi,
  /\b(armor\s+plates?|armou?red\s+figure|armou?red\s+body|armou?red\s+suit)\b/gi,
  /\b(metal\s+body|metal\s+chassis|metal\s+plating|steel\s+body|iron\s+plating)\b/gi,
  /\b(chrome\s+surface|chrome\s+body|chrome\s+plating)\b/gi,
  /\b(robotic\s+plating|robotic\s+suit|robotic\s+body|mechanical\s+suit|mechanical\s+joints?)\b/gi,
  /\b(vehicle\s+surface|vehicle.like\s+body|bodywork\s+reflections?)\b/gi,
  /\b(glowing\s+runes?|energy\s+shield|force\s+field)\b/gi,
  /\breflect(?:ing|ions?)\s+(?:off|on)\s+(?:metallic|metal|chrome|steel|iron)\s+\w*/gi,
  /\b(?:gleaming|shining|glinting)\s+(?:metal|armor|steel|chrome|iron)\b/gi,
];

const SAFE_REPLACEMENTS = {
  "metallic reflections on armor": "warm light on the character",
  "metallic armor": "the character's outfit",
  "metal body": "the character's figure",
  "metallic body": "the character's figure",
  "metal chassis": "the character's silhouette",
  "chrome surface": "the character's outfit",
  "armored figure": "the character",
  "armored body": "the character's figure",
  "mechanical suit": "the character's costume",
  "mechanical joints": "the character's pose",
  "robotic plating": "the character's outfit",
  "armor plates": "the character's costume",
  "steel body": "the character's figure",
  "iron plating": "the character's outfit",
  "vehicle surface": "the character's silhouette",
  "bodywork reflections": "highlights on the character",
  "glowing runes": "ambient glow",
  "gleaming metal": "soft highlights on the outfit",
  "gleaming armor": "soft highlights on the outfit",
  "shining metal": "warm highlights on the character",
  "shining armor": "warm highlights on the outfit",
};

export function sanitizeScenePlanText(text, userPromptLC) {
  if (!text || typeof text !== "string") return { text, changed: false, replaced: [] };
  let result = text;
  const replaced = [];

  for (const [bad, good] of Object.entries(SAFE_REPLACEMENTS)) {
    const re = new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    if (re.test(result)) {
      if (!userPromptLC.includes(bad.toLowerCase())) {
        replaced.push({ from: bad, to: good });
        result = result.replace(re, good);
      }
    }
  }

  for (const pattern of INVENTED_MATERIAL_PATTERNS) {
    const rx = new RegExp(pattern.source, pattern.flags);
    const matches = result.match(rx);
    if (matches) {
      for (const m of matches) {
        if (!userPromptLC.includes(m.toLowerCase())) {
          replaced.push({ from: m, to: "the character" });
          result = result.replace(m, "the character");
        }
      }
    }
  }

  return { text: result, changed: replaced.length > 0, replaced };
}

export function sanitizeScenePlan(scenePlan, sourcePromptIT = "", sourcePromptEN = "") {
  if (!scenePlan) return { plan: null, guardrailApplied: false, replacements: [] };

  const userPromptLC = `${sourcePromptIT} ${sourcePromptEN}`.toLowerCase();
  const allReplacements = [];
  const sanitized = { ...scenePlan };

  const textFields = [
    "primary_action", "start_state", "end_state", "camera_plan",
    "duration_strategy", "opening_frame_prompt", "action_emphasis_prompt",
  ];

  for (const field of textFields) {
    if (sanitized[field]) {
      const { text, replaced } = sanitizeScenePlanText(sanitized[field], userPromptLC);
      if (replaced.length > 0) {
        sanitized[field] = text;
        allReplacements.push(...replaced.map(r => ({ field, ...r })));
      }
    }
  }

  if (Array.isArray(sanitized.secondary_elements)) {
    sanitized.secondary_elements = sanitized.secondary_elements.map((el, i) => {
      const { text, replaced } = sanitizeScenePlanText(el, userPromptLC);
      if (replaced.length > 0) {
        allReplacements.push(...replaced.map(r => ({ field: `secondary_elements[${i}]`, ...r })));
      }
      return text;
    });
  }

  if (Array.isArray(sanitized.avoid_actions)) {
    sanitized.avoid_actions = sanitized.avoid_actions.map((el, i) => {
      const { text, replaced } = sanitizeScenePlanText(el, userPromptLC);
      if (replaced.length > 0) {
        allReplacements.push(...replaced.map(r => ({ field: `avoid_actions[${i}]`, ...r })));
      }
      return text;
    });
  }

  return {
    plan: sanitized,
    guardrailApplied: allReplacements.length > 0,
    replacements: allReplacements,
  };
}
