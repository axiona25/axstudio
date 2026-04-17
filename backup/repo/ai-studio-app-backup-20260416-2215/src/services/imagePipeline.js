/**
 * Image Pipeline Service
 *
 * Modular pipeline for AI image generation with character identity consistency.
 *
 * Pipeline steps:
 *   A) createMasterCharacter  — generate the initial master character with FLUX 2 Pro
 *   B) generateSceneBase      — generate a new scene (different pose/environment, same art direction)
 *   C) lockCharacterIdentity  — transfer facial identity from master to scene via Nano Banana Pro Edit
 *   D) repairCharacterScene   — optional refinement pass for lighting/skin integration
 *
 * All fal.ai calls go through falRequest / falQueueRequest.
 * No local models, no GPU — cloud API only.
 */

import {
  buildMasterCharacterPrompt,
  buildScenePrompt,
  buildIdentityLockPrompt,
  buildRepairPrompt,
  buildScenografiaSceneEditPrompt,
} from "./imagePrompts.js";

// ── fal.ai config ──
const FAL_API_KEY = process.env.REACT_APP_FAL_API_KEY || "";
const FAL_BASE_URL = "https://fal.run";
const FAL_QUEUE_URL = "https://queue.fal.run";

// ── Models ──
export const MODELS = {
  FLUX_2_PRO: "fal-ai/flux-2-pro",
  NANO_BANANA_EDIT: "fal-ai/nano-banana-pro/edit",
};

// ── Job types ──
export const JOB_TYPES = {
  MASTER_CHARACTER: "master_character",
  SCENE_BASE: "scene_base",
  IDENTITY_LOCK: "identity_lock",
  REPAIR_PASS: "repair_pass",
  SCENOGRAFIA_SCENE_EDIT: "scenografia_scene_edit",
};

// ── Low-level fal.ai transport ──

export async function falRequest(endpoint, payload) {
  const start = Date.now();
  const res = await fetch(`${FAL_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${FAL_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error("[FAL]", res.status, errBody);
    throw new Error(errBody);
  }
  const data = await res.json();
  data._latencyMs = Date.now() - start;
  return data;
}

export async function falQueueRequest(endpoint, payload, onProgress) {
  const start = Date.now();
  const submitRes = await fetch(`${FAL_QUEUE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${FAL_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => ({ detail: submitRes.statusText }));
    throw new Error(err.detail || `fal.ai queue submit error ${submitRes.status}`);
  }
  const submitData = await submitRes.json();
  const requestId = submitData.request_id;
  if (!requestId) throw new Error("fal.ai: no request_id received");

  const statusUrl =
    submitData.status_url ||
    `${FAL_QUEUE_URL}/${endpoint}/requests/${requestId}/status`;
  const responseUrl =
    submitData.response_url ||
    `${FAL_QUEUE_URL}/${endpoint}/requests/${requestId}`;

  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(`${statusUrl}?logs=1`, {
      method: "GET",
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });
    const statusData = await statusRes.json();
    if (onProgress) onProgress(statusData.status);
    if (statusData.status === "COMPLETED") {
      const finalResponseUrl = statusData.response_url || responseUrl;
      const resultRes = await fetch(finalResponseUrl, {
        headers: { Authorization: `Key ${FAL_API_KEY}` },
      });
      const data = await resultRes.json();
      data._latencyMs = Date.now() - start;
      return data;
    }
    if (statusData.status === "FAILED") {
      throw new Error(
        `fal.ai job failed: ${JSON.stringify(statusData.error || statusData)}`
      );
    }
  }
}

// ── Image upload to fal storage ──

export async function uploadToFalStorage(base64DataUrl) {
  const res = await fetch(base64DataUrl);
  const blob = await res.blob();

  const initRes = await fetch(
    "https://rest.alpha.fal.ai/storage/upload/initiate",
    {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_name: "image.png",
        content_type: blob.type || "image/png",
      }),
    }
  );

  if (!initRes.ok) {
    const formData = new FormData();
    formData.append("file", blob, "image.png");
    const fallbackRes = await fetch(
      "https://rest.alpha.fal.ai/storage/upload",
      {
        method: "POST",
        headers: { Authorization: `Key ${FAL_API_KEY}` },
        body: formData,
      }
    );
    if (!fallbackRes.ok)
      throw new Error(`fal.ai upload error ${fallbackRes.status}`);
    const fallbackData = await fallbackRes.json();
    return fallbackData.url || fallbackData.access_url;
  }

  const { upload_url, file_url } = await initRes.json();
  const uploadRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "image/png" },
    body: blob,
  });
  if (!uploadRes.ok)
    throw new Error(`fal.ai presigned upload error ${uploadRes.status}`);

  return file_url;
}

/**
 * Carica un blob (es. MP3 ElevenLabs) su fal storage e restituisce URL pubblico.
 */
export async function uploadBlobToFalStorage(blob, fileName = "audio.mp3", contentType = null) {
  const ct = contentType || blob.type || "application/octet-stream";

  const initRes = await fetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_name: fileName,
      content_type: ct,
    }),
  });

  if (!initRes.ok) {
    const formData = new FormData();
    formData.append("file", blob, fileName);
    const fallbackRes = await fetch("https://rest.alpha.fal.ai/storage/upload", {
      method: "POST",
      headers: { Authorization: `Key ${FAL_API_KEY}` },
      body: formData,
    });
    if (!fallbackRes.ok) throw new Error(`fal.ai upload error ${fallbackRes.status}`);
    const fallbackData = await fallbackRes.json();
    return fallbackData.url || fallbackData.access_url;
  }

  const { upload_url, file_url } = await initRes.json();
  const uploadRes = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": ct },
    body: blob,
  });
  if (!uploadRes.ok) throw new Error(`fal.ai presigned upload error ${uploadRes.status}`);

  return file_url;
}

export async function imageUrlToBase64(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Helper: extract image URL from fal response ──

function extractImageUrl(result) {
  return result?.images?.[0]?.url || result?.image?.url || null;
}

function extractSeed(result) {
  return result?.seed || result?.images?.[0]?.seed || null;
}

// ── Job result builder ──

function buildJobResult(type, { model, prompt, inputImages, outputImage, seed, latency, status, extra }) {
  return {
    provider: "fal.ai",
    model,
    prompt,
    inputImages: inputImages || [],
    outputImage,
    seed: seed || null,
    latency: latency || 0,
    status: status || "completed",
    type,
    createdAt: new Date().toISOString(),
    ...(extra || {}),
  };
}

// ═══════════════════════════════════════════════════════════
//  CASE A — Master Character Creation
// ═══════════════════════════════════════════════════════════

/**
 * Generate the initial master character image.
 *
 * @param {object} opts
 * @param {object} opts.appearance - Character appearance object (gender, age, body, hair, skin, etc.)
 * @param {string} [opts.outfit] - Outfit description
 * @param {string} [opts.visualStyle] - Visual/art style (e.g. "cinematic", "cartoon", "anime")
 * @param {string} [opts.extraPrompt] - Additional user prompt text
 * @param {string} [opts.aspectRatio] - "1:1", "16:9", "9:16" (default "9:16")
 * @param {function} [opts.onProgress] - Progress callback
 * @returns {Promise<object>} Job result
 */
export async function createMasterCharacter({
  appearance,
  outfit,
  visualStyle,
  extraPrompt,
  aspectRatio = "9:16",
  onProgress,
}) {
  const prompt = buildMasterCharacterPrompt({ appearance, outfit, visualStyle, extraPrompt });

  console.log("[PIPELINE] createMasterCharacter prompt:", prompt.slice(0, 200));
  if (onProgress) onProgress({ step: "generating", message: "Generazione master character…" });

  const result = await falRequest(MODELS.FLUX_2_PRO, {
    prompt,
    aspect_ratio: aspectRatio,
    num_images: 1,
    enable_safety_checker: false,
    safety_tolerance: "2",
  });

  const imageUrl = extractImageUrl(result);
  if (!imageUrl) throw new Error("FLUX 2 Pro: no image returned for master character");

  return buildJobResult(JOB_TYPES.MASTER_CHARACTER, {
    model: MODELS.FLUX_2_PRO,
    prompt,
    outputImage: imageUrl,
    seed: extractSeed(result),
    latency: result._latencyMs,
  });
}

// ═══════════════════════════════════════════════════════════
//  CASE B — Scene Base Generation
// ═══════════════════════════════════════════════════════════

/**
 * Generate a new scene with the same art direction but different pose/environment.
 *
 * @param {object} opts
 * @param {string} opts.sceneDescription - Scene description (EN)
 * @param {object} [opts.appearance] - Character appearance for physical description in prompt
 * @param {string} [opts.outfit] - Outfit for this scene
 * @param {string} [opts.environment] - Environment description
 * @param {string} [opts.lighting] - Lighting description
 * @param {string} [opts.palette] - Color palette
 * @param {string} [opts.visualStyle] - Art style matching master
 * @param {string[]} [opts.stylePrefixes] - Style preset prompt strings
 * @param {string} [opts.negativePrompt] - Negative prompt
 * @param {number} [opts.numSubjects] - Number of subjects (default 1)
 * @param {string} [opts.supportingCharacters] - Description of secondary characters
 * @param {string} [opts.aspectRatio] - "1:1", "16:9", "9:16" (default "16:9")
 * @param {function} [opts.onProgress]
 * @returns {Promise<object>} Job result
 */
export async function generateSceneBase({
  sceneDescription,
  appearance,
  outfit,
  environment,
  lighting,
  palette,
  visualStyle,
  stylePrefixes,
  negativePrompt,
  numSubjects = 1,
  supportingCharacters,
  aspectRatio = "16:9",
  onProgress,
}) {
  const prompt = buildScenePrompt({
    sceneDescription,
    appearance,
    outfit,
    environment,
    lighting,
    palette,
    visualStyle,
    stylePrefixes,
    numSubjects,
    supportingCharacters,
  });

  console.log("[PIPELINE] generateSceneBase prompt:", prompt.slice(0, 200));
  if (onProgress) onProgress({ step: "generating", message: "Generazione scena…" });

  const result = await falRequest(MODELS.FLUX_2_PRO, {
    prompt,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    aspect_ratio: aspectRatio,
    num_images: 1,
    enable_safety_checker: false,
    safety_tolerance: "2",
  });

  const imageUrl = extractImageUrl(result);
  if (!imageUrl) throw new Error("FLUX 2 Pro: no image returned for scene base");

  return buildJobResult(JOB_TYPES.SCENE_BASE, {
    model: MODELS.FLUX_2_PRO,
    prompt,
    outputImage: imageUrl,
    seed: extractSeed(result),
    latency: result._latencyMs,
  });
}

// ═══════════════════════════════════════════════════════════
//  CASE C — Identity Lock (Consistency Pass)
// ═══════════════════════════════════════════════════════════

/**
 * Transfer facial identity from master character onto a scene base image.
 *
 * CRITICAL: image_urls order — [0] scene base, [1] master character.
 *
 * @param {object} opts
 * @param {string} opts.sceneImageUrl - URL of the scene base image (image 1)
 * @param {string} opts.masterImageUrl - URL of the master character image (image 2)
 * @param {boolean} [opts.isAnimated] - If true, adds animated-style preservation clauses
 * @param {function} [opts.onProgress]
 * @returns {Promise<object>} Job result
 */
export async function lockCharacterIdentity({
  sceneImageUrl,
  masterImageUrl,
  isAnimated = false,
  globalVisualStyleNote = "",
  onProgress,
}) {
  const prompt = buildIdentityLockPrompt({ isAnimated, globalVisualStyleNote });

  console.log("[PIPELINE] lockCharacterIdentity — scene:", sceneImageUrl?.slice(0, 60), "master:", masterImageUrl?.slice(0, 60));
  if (onProgress) onProgress({ step: "identity_lock", message: "Identity lock…" });

  const result = await falRequest(MODELS.NANO_BANANA_EDIT, {
    image_urls: [sceneImageUrl, masterImageUrl],
    prompt,
    num_images: 1,
    enable_safety_checker: false,
    safety_tolerance: "2",
  });

  const imageUrl = extractImageUrl(result);
  if (!imageUrl) throw new Error("Nano Banana Pro Edit: no image returned for identity lock");

  return buildJobResult(JOB_TYPES.IDENTITY_LOCK, {
    model: MODELS.NANO_BANANA_EDIT,
    prompt,
    inputImages: [sceneImageUrl, masterImageUrl],
    outputImage: imageUrl,
    seed: extractSeed(result),
    latency: result._latencyMs,
  });
}

// ═══════════════════════════════════════════════════════════
//  CASE D — Repair Pass (Optional)
// ═══════════════════════════════════════════════════════════

/**
 * Refine an identity-locked image to fix lighting, skin tone, shadow mismatches.
 *
 * @param {object} opts
 * @param {string} opts.imageUrl - URL of the identity-locked image to repair
 * @param {boolean} [opts.isAnimated] - If true, uses animated-style refinement
 * @param {function} [opts.onProgress]
 * @returns {Promise<object>} Job result
 */
export async function repairCharacterScene({
  imageUrl,
  isAnimated = false,
  globalVisualStyleNote = "",
  onProgress,
}) {
  const prompt = buildRepairPrompt({ isAnimated, globalVisualStyleNote });

  console.log("[PIPELINE] repairCharacterScene — image:", imageUrl?.slice(0, 60));
  if (onProgress) onProgress({ step: "repair", message: "Repair pass…" });

  const result = await falRequest(MODELS.NANO_BANANA_EDIT, {
    image_urls: [imageUrl],
    prompt,
    num_images: 1,
    enable_safety_checker: false,
    safety_tolerance: "2",
  });

  const repairUrl = extractImageUrl(result);
  if (!repairUrl) {
    console.warn("[PIPELINE] Repair pass returned no image, using input");
    return buildJobResult(JOB_TYPES.REPAIR_PASS, {
      model: MODELS.NANO_BANANA_EDIT,
      prompt,
      inputImages: [imageUrl],
      outputImage: imageUrl,
      latency: result._latencyMs,
      status: "skipped",
    });
  }

  return buildJobResult(JOB_TYPES.REPAIR_PASS, {
    model: MODELS.NANO_BANANA_EDIT,
    prompt,
    inputImages: [imageUrl],
    outputImage: repairUrl,
    seed: extractSeed(result),
    latency: result._latencyMs,
  });
}

/**
 * Modifica mirata di una scena Scenografie (stesso frame, prompt integrativo).
 * Non rigenera master né cambia lo stile progetto: solo passaggio edit su immagine corrente.
 *
 * @param {object} opts
 * @param {string} opts.sceneImageUrl
 * @param {string} opts.integrativePrompt - Richiesta utente (anche IT)
 * @param {string} [opts.globalVisualStyleNote]
 * @param {boolean} [opts.isAnimated]
 * @param {function} [opts.onProgress]
 */
export async function editScenografiaSceneWithPrompt({
  sceneImageUrl,
  integrativePrompt,
  globalVisualStyleNote = "",
  isAnimated = false,
  onProgress,
}) {
  const prompt = buildScenografiaSceneEditPrompt({
    integrativePrompt,
    globalVisualStyleNote,
    isAnimated,
  });
  if (onProgress) onProgress({ step: "scene_edit", message: "Modifica scena…" });
  const result = await falRequest(MODELS.NANO_BANANA_EDIT, {
    image_urls: [sceneImageUrl],
    prompt,
    num_images: 1,
    enable_safety_checker: false,
    safety_tolerance: "2",
  });
  const out = extractImageUrl(result);
  if (!out) throw new Error("Modifica scena: nessuna immagine restituita");
  return buildJobResult(JOB_TYPES.SCENOGRAFIA_SCENE_EDIT, {
    model: MODELS.NANO_BANANA_EDIT,
    prompt,
    inputImages: [sceneImageUrl],
    outputImage: out,
    seed: extractSeed(result),
    latency: result._latencyMs,
  });
}

// ═══════════════════════════════════════════════════════════
//  Full Pipeline Orchestrator
// ═══════════════════════════════════════════════════════════

/**
 * Run the full image pipeline:
 *   1. createMasterCharacter (if no master provided)
 *   2. generateSceneBase
 *   3. lockCharacterIdentity
 *   4. repairCharacterScene (optional)
 *
 * @param {object} opts
 * @param {string} [opts.masterImageUrl] - Existing master character URL (skip step 1)
 * @param {object} opts.appearance - Character appearance
 * @param {string} [opts.outfit] - Outfit
 * @param {string} [opts.visualStyle] - Art style
 * @param {string} opts.sceneDescription - Scene prompt (EN)
 * @param {string} [opts.environment] - Environment
 * @param {string} [opts.lighting] - Lighting
 * @param {string} [opts.palette] - Color palette
 * @param {string[]} [opts.stylePrefixes] - Style prompts from presets
 * @param {string} [opts.negativePrompt] - Negative prompt
 * @param {number} [opts.numSubjects] - Number of subjects
 * @param {string} [opts.supportingCharacters] - Secondary characters
 * @param {string} [opts.aspectRatio] - Aspect ratio (default "16:9")
 * @param {boolean} [opts.isAnimated] - Animated style flag
 * @param {boolean} [opts.enableRepair] - Enable repair pass (default false)
 * @param {function} [opts.onProgress] - Progress callback ({ step, message, percent })
 * @returns {Promise<object>} Pipeline result with all job results
 */
export async function runImagePipeline({
  masterImageUrl,
  appearance,
  outfit,
  visualStyle,
  sceneDescription,
  environment,
  lighting,
  palette,
  stylePrefixes,
  negativePrompt,
  numSubjects = 1,
  supportingCharacters,
  aspectRatio = "16:9",
  isAnimated = false,
  enableRepair = false,
  onProgress,
}) {
  const pipelineResult = {
    steps: [],
    finalImageUrl: null,
    masterImageUrl: masterImageUrl || null,
    success: false,
    error: null,
  };

  try {
    // ── Step 1: Master Character (skip if provided) ──
    if (!masterImageUrl) {
      if (onProgress) onProgress({ step: "master", message: "Creazione master character…", percent: 5 });
      const masterJob = await createMasterCharacter({
        appearance,
        outfit,
        visualStyle,
        aspectRatio: "9:16",
        onProgress,
      });
      pipelineResult.steps.push(masterJob);
      pipelineResult.masterImageUrl = masterJob.outputImage;
      masterImageUrl = masterJob.outputImage;
    }

    // ── Step 2: Scene Base ──
    if (onProgress) onProgress({ step: "scene", message: "Generazione scena…", percent: 25 });
    const sceneJob = await generateSceneBase({
      sceneDescription,
      appearance,
      outfit,
      environment,
      lighting,
      palette,
      visualStyle,
      stylePrefixes,
      negativePrompt,
      numSubjects,
      supportingCharacters,
      aspectRatio,
      onProgress,
    });
    pipelineResult.steps.push(sceneJob);

    // ── Step 3: Identity Lock ──
    if (onProgress) onProgress({ step: "identity_lock", message: "Trasferimento identità…", percent: 55 });
    const lockJob = await lockCharacterIdentity({
      sceneImageUrl: sceneJob.outputImage,
      masterImageUrl,
      isAnimated,
      onProgress,
    });
    pipelineResult.steps.push(lockJob);

    let finalUrl = lockJob.outputImage;

    // ── Step 4: Repair Pass (optional) ──
    if (enableRepair) {
      if (onProgress) onProgress({ step: "repair", message: "Rifinitura…", percent: 80 });
      const repairJob = await repairCharacterScene({
        imageUrl: finalUrl,
        isAnimated,
        onProgress,
      });
      pipelineResult.steps.push(repairJob);
      finalUrl = repairJob.outputImage;
    }

    pipelineResult.finalImageUrl = finalUrl;
    pipelineResult.success = true;

    if (onProgress) onProgress({ step: "done", message: "Completato", percent: 100 });
  } catch (err) {
    console.error("[PIPELINE] Error:", err);
    pipelineResult.error = err.message || String(err);
    pipelineResult.success = false;
  }

  return pipelineResult;
}

/**
 * Quick pipeline for creating a scene with an existing master character.
 * Equivalent to steps 2 + 3 + optional 4.
 */
export async function createSceneWithCharacter({
  masterImageUrl,
  appearance,
  sceneDescription,
  outfit,
  environment,
  lighting,
  palette,
  visualStyle,
  stylePrefixes,
  negativePrompt,
  numSubjects = 1,
  supportingCharacters,
  aspectRatio = "16:9",
  isAnimated = false,
  enableRepair = false,
  onProgress,
}) {
  if (!masterImageUrl) throw new Error("masterImageUrl is required for createSceneWithCharacter");

  return runImagePipeline({
    masterImageUrl,
    appearance,
    sceneDescription,
    outfit,
    environment,
    lighting,
    palette,
    visualStyle,
    stylePrefixes,
    negativePrompt,
    numSubjects,
    supportingCharacters,
    aspectRatio,
    isAnimated,
    enableRepair,
    onProgress,
  });
}

