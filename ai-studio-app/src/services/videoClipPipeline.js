/**
 * Pipeline reale Scenografie: ElevenLabs (TTS) → fal storage → Kling Avatar v2 Pro → aggiornamento clip.
 * V1 dialogato: un solo MP3 da testo concatenato; una sola voce ElevenLabs (voice master allineata per tutti i parlanti).
 */

import {
  CLIP_TYPE,
  normalizeDialogLine,
  normalizeCharacterVoiceMaster,
  normalizeNarratorVoice,
  SCENE_VIDEO_CLIP_STATUS,
} from "./scenografieVideoWorkflow.js";
import {
  resolveElevenLabsVoiceId,
  elevenLabsTextToSpeechMp3,
  measureAudioBlobDurationSeconds,
  getElevenLabsApiKey,
} from "./elevenlabsService.js";
import { generateKlingAvatarV2Pro, KLING_AVATAR_V2_PRO_ENDPOINT } from "./klingAvatarService.js";
import { imageUrlToBase64, uploadToFalStorage, uploadBlobToFalStorage } from "./imagePipeline.js";
import { sanitizeClipPipelineErrorForUser } from "./scenografieClipUserMessages.js";
import { planCharacterDisplayName, voiceMasterRawForRef } from "./scenografiePcidLookup.js";

function charName(plan, characterId) {
  return planCharacterDisplayName(plan, characterId);
}

/**
 * Testo unico per TTS dialogato V1: «Nome: battuta» per ogni riga.
 * Estensione futura: segmenti multi-voce per personaggio.
 */
export function buildDialogueTtsText(clip, plan) {
  const lines = (Array.isArray(clip.dialogLines) ? clip.dialogLines : []).map(normalizeDialogLine).filter(Boolean);
  return lines
    .map((line) => {
      const name = charName(plan, line.characterId);
      return `${name}: ${String(line.text || "").trim()}`;
    })
    .join("\n\n");
}

/**
 * Risolve voice ID ElevenLabs unico per tutte le battute (solo voice master personaggio).
 * @returns {{ voiceId: string|null, errors: string[] }}
 */
export function resolveDialogueSingleVoiceId(clip, characterVoiceMasters, plan) {
  const errors = [];
  const lines = (Array.isArray(clip.dialogLines) ? clip.dialogLines : []).map(normalizeDialogLine).filter(Boolean);
  const resolved = [];
  for (const line of lines) {
    const master = normalizeCharacterVoiceMaster(
      voiceMasterRawForRef(characterVoiceMasters, line.characterId, plan),
      line.characterId,
    );
    if (!String(master.voiceId || "").trim()) {
      errors.push(`Voice master mancante per «${charName(plan, line.characterId)}».`);
      continue;
    }
    const { voiceId, error } = resolveElevenLabsVoiceId(master.voiceId);
    if (!voiceId) errors.push(`«${charName(plan, line.characterId)}»: ${error || "Voce non valida."}`);
    else resolved.push(voiceId);
  }
  const uniq = [...new Set(resolved)];
  if (uniq.length > 1) {
    errors.push(
      "V1: tutti i parlanti devono avere la stessa voce ElevenLabs (stesso voice ID nelle voice master). Il multi-speaker reale sarà supportato in seguito."
    );
  }
  return { voiceId: uniq[0] || null, errors };
}

/**
 * @param {object} clip
 * @param {object[]} sceneResults
 * @returns {{ row: object }}
 */
export function assertSceneApprovedWithImage(clip, sceneResults) {
  const row = (sceneResults || []).find((r) => r.sceneId === clip.sceneId);
  if (!row?.imageUrl) throw new Error("Immagine scena non trovata per questo clip.");
  if (row.approved !== true) throw new Error("La scena sorgente deve essere approvata prima di generare il video.");
  return { row };
}

async function ensureImageUrlOnFal(imageUrl) {
  const u = String(imageUrl || "").trim();
  if (!u) throw new Error("URL immagine scena vuoto.");
  if (/fal\.media|fal\.cdn/i.test(u)) return u;
  const b64 = await imageUrlToBase64(u);
  return uploadToFalStorage(b64);
}

/**
 * @param {object} opts
 * @param {object} opts.clip
 * @param {object|null} opts.plan
 * @param {object[]} opts.sceneResults
 * @param {Record<string, object>} opts.characterVoiceMasters
 * @param {(partial: object) => void} opts.patchClip — merge sul clip (stato intermedio)
 * @param {(phase: string, detail?: string) => void} [opts.onProgress]
 */
export async function runScenografieClipVideoPipeline(opts) {
  const { clip, plan, sceneResults, characterVoiceMasters, patchClip, onProgress } = opts;
  if (!clip?.id) throw new Error("Clip non valido.");

  if (!String(process.env.REACT_APP_FAL_API_KEY || "").trim()) {
    throw new Error("REACT_APP_FAL_API_KEY non configurata nel .env");
  }
  if (!getElevenLabsApiKey()) {
    throw new Error("REACT_APP_ELEVENLABS_API_KEY non configurata nel .env");
  }

  const { row } = assertSceneApprovedWithImage(clip, sceneResults);
  const now = () => new Date().toISOString();

  let lastAudioFalUrl = clip.audioUrl || null;
  let lastAudioDuration = typeof clip.audioDurationSeconds === "number" ? clip.audioDurationSeconds : null;

  const fail = (errLike, extra = {}) => {
    const userMsg = sanitizeClipPipelineErrorForUser(errLike);
    patchClip({
      status: SCENE_VIDEO_CLIP_STATUS.FAILED,
      generationStatus: "failed",
      lastGenerationError: userMsg,
      updatedAt: now(),
      ...extra,
    });
  };

  try {
    onProgress?.("audio", "ElevenLabs · sintesi voce…");
    patchClip({
      status: SCENE_VIDEO_CLIP_STATUS.GENERATING_AUDIO,
      generationStatus: "audio",
      lastGenerationError: null,
      providerVoice: "elevenlabs",
      providerVideo: "fal.ai",
      generationModel: KLING_AVATAR_V2_PRO_ENDPOINT,
      updatedAt: now(),
    });

    let ttsText;
    let ttsVoiceId;

    const type = clip.clipType === CLIP_TYPE.DIALOGUE ? CLIP_TYPE.DIALOGUE : CLIP_TYPE.NARRATED;
    if (type === CLIP_TYPE.NARRATED) {
      ttsText = String(clip.narratorText || "").trim();
      const nv = normalizeNarratorVoice(clip.narratorVoice);
      const { voiceId, error } = resolveElevenLabsVoiceId(nv?.voiceId);
      if (!voiceId) throw new Error(error || "Voce narratore non valida.");
      ttsVoiceId = voiceId;
    } else {
      ttsText = buildDialogueTtsText(clip, plan);
      const { voiceId, errors } = resolveDialogueSingleVoiceId(clip, characterVoiceMasters || {}, plan);
      if (errors.length) throw new Error(errors.join(" "));
      if (!voiceId) throw new Error("Impossibile risolvere la voce ElevenLabs per il dialogo (voice master).");
      ttsVoiceId = voiceId;
    }

    const mp3Blob = await elevenLabsTextToSpeechMp3({ text: ttsText, voiceId: ttsVoiceId });
    const audioDur = await measureAudioBlobDurationSeconds(mp3Blob);
    const audioFalUrl = await uploadBlobToFalStorage(mp3Blob, `sceno_clip_${clip.id}.mp3`, "audio/mpeg");
    lastAudioFalUrl = audioFalUrl;
    lastAudioDuration = audioDur;

    patchClip({
      audioUrl: audioFalUrl,
      audioDurationSeconds: audioDur,
      providerVoice: "elevenlabs",
      updatedAt: now(),
    });

    onProgress?.("video", "fal.ai · Kling Avatar v2 Pro…");
    patchClip({
      status: SCENE_VIDEO_CLIP_STATUS.GENERATING_VIDEO,
      generationStatus: "video",
      updatedAt: now(),
    });

    const imageFalUrl = await ensureImageUrlOnFal(row.imageUrl);
    const { videoUrl } = await generateKlingAvatarV2Pro({
      imageUrl: imageFalUrl,
      audioUrl: audioFalUrl,
      onProgress: (s) => onProgress?.("video", s),
    });

    const finalDur =
      typeof audioDur === "number" && Number.isFinite(audioDur) && audioDur > 0
        ? Math.round(audioDur * 10) / 10
        : clip.durationSeconds;

    patchClip({
      videoUrl,
      audioUrl: audioFalUrl,
      audioDurationSeconds: audioDur,
      providerVideo: "fal.ai",
      providerVoice: "elevenlabs",
      generationModel: KLING_AVATAR_V2_PRO_ENDPOINT,
      generationStatus: "complete",
      status: SCENE_VIDEO_CLIP_STATUS.READY_FOR_REVIEW,
      lastGenerationError: null,
      durationSeconds: finalDur != null ? finalDur : clip.durationSeconds,
      durationMode: typeof audioDur === "number" && audioDur > 0 ? "auto" : clip.durationMode,
      updatedAt: now(),
    });

    onProgress?.("done", "Clip video pronto.");
  } catch (e) {
    const raw = e?.message || String(e);
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[Scenografie clip pipeline]", raw);
    }
    const hadAudio = !!lastAudioFalUrl;
    fail({ message: raw }, {
      audioUrl: hadAudio ? lastAudioFalUrl : clip.audioUrl,
      audioDurationSeconds: lastAudioDuration ?? clip.audioDurationSeconds,
      videoUrl: null,
      providerVoice: "elevenlabs",
      providerVideo: "fal.ai",
      generationModel: KLING_AVATAR_V2_PRO_ENDPOINT,
    });
    throw e;
  }
}
