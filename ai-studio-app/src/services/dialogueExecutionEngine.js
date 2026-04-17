/**
 * AXSTUDIO H8 — Dialogo multi-voice reale: casting, piani, TTS ElevenLabs per battuta, concat con pause, stem unico.
 */

import {
  CLIP_TYPE,
  normalizeDialogLine,
  normalizeCharacterVoiceMaster,
  normalizeNarratorVoice,
} from "./scenografieVideoWorkflow.js";
import {
  planCharacterDisplayName,
  voiceMasterRawForRef,
  findPlanCharacterByPresentRef,
  stableCharacterKey,
  pcmRowForCharacter,
} from "./scenografiePcidLookup.js";
import { resolveElevenLabsVoiceId, elevenLabsTextToSpeechMp3, measureAudioBlobDurationSeconds } from "./elevenlabsService.js";

export const DIALOGUE_EXECUTION_ENGINE_VERSION = 1;

const DEFAULT_PAUSE_MS = 220;
const LANGUAGE_DEFAULT = "it";

function trim(v) {
  return v != null ? String(v).trim() : "";
}

/** @param {AudioBuffer} audioBuffer */
function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  const vol = 0.985;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let s = audioBuffer.getChannelData(ch)[i] * vol;
      s = Math.max(-1, Math.min(1, s));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function decodeBlobToAudioBuffer(blob) {
  const Ctx = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  if (!Ctx) throw new Error("AudioContext non disponibile.");
  const ctx = new Ctx();
  try {
    const ab = await blob.arrayBuffer();
    return await ctx.decodeAudioData(ab.slice(0));
  } finally {
    await ctx.close?.();
  }
}

function resampleToRate(buf, targetSr) {
  if (!buf || buf.sampleRate === targetSr) return buf;
  const ratio = buf.sampleRate / targetSr;
  const newLen = Math.max(1, Math.ceil(buf.length / ratio));
  const Ctx = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  const tmp = new Ctx({ sampleRate: targetSr });
  const out = tmp.createBuffer(2, newLen, targetSr);
  tmp.close?.();
  for (let ch = 0; ch < 2; ch++) {
    const srcCh = Math.min(ch, buf.numberOfChannels - 1);
    const src = buf.getChannelData(srcCh);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < newLen; i++) {
      const srcPos = i * ratio;
      const i0 = Math.floor(srcPos);
      const f = srcPos - i0;
      const s0 = src[Math.min(i0, src.length - 1)] || 0;
      const s1 = src[Math.min(i0 + 1, src.length - 1)] || 0;
      dst[i] = s0 * (1 - f) + s1 * f;
    }
  }
  return out;
}

function concatStereoWithPauses(chunks, sampleRate, pauseSamples) {
  if (!chunks.length) throw new Error("Nessun segmento audio da concatenare.");
  const total =
    chunks.reduce((a, b) => a + b.length, 0) + pauseSamples * Math.max(0, chunks.length - 1);
  const Ctx = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  const ctx = new Ctx({ sampleRate });
  const out = ctx.createBuffer(2, total, sampleRate);
  ctx.close?.();
  let offset = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    const buf = chunks[ci];
    for (let ch = 0; ch < 2; ch++) {
      const srcCh = Math.min(ch, buf.numberOfChannels - 1);
      const src = buf.getChannelData(srcCh);
      const dst = out.getChannelData(ch);
      for (let i = 0; i < buf.length; i++) dst[offset + i] = src[i];
    }
    offset += buf.length;
    if (ci < chunks.length - 1) {
      offset += pauseSamples;
    }
  }
  return out;
}

function isPredefinedPresetVoiceId(raw) {
  return /^eleven_/i.test(trim(raw));
}

function inferVoiceSourceType(rawConfigured, resolvedId, fallbackUsed) {
  if (fallbackUsed) return "narrator_or_default_fallback";
  const r = trim(rawConfigured);
  if (isPredefinedPresetVoiceId(r)) return "predefined_preset";
  if (r && r === resolvedId && !isPredefinedPresetVoiceId(r)) return "cloned_or_library_voice_id";
  return "character_master_resolved";
}

/**
 * Personaggi presenti in scena (riferimenti piano).
 */
export function scenePresentCharacterRefs(plan, sceneId) {
  const sid = trim(sceneId);
  const scenes = plan?.scenes;
  if (!Array.isArray(scenes) || !sid) return [];
  const sc = scenes.find((s) => String(s?.id || "") === sid);
  if (!sc || !Array.isArray(sc.characters_present)) return [];
  return [...new Set(sc.characters_present.map((x) => String(x || "").trim()).filter(Boolean))];
}

/**
 * @param {object} args
 */
export function buildSpeakerVoiceMap(args) {
  const clip = args?.clip && typeof args.clip === "object" ? args.clip : {};
  const plan = args?.plan && typeof args.plan === "object" ? args.plan : null;
  const lines = Array.isArray(args?.lines) ? args.lines : [];
  const characterVoiceMasters = args?.characterVoiceMasters && typeof args.characterVoiceMasters === "object" ? args.characterVoiceMasters : {};
  const pcmAll = args?.projectCharacterMasters && typeof args.projectCharacterMasters === "object" ? args.projectCharacterMasters : {};
  const narratorNv = normalizeNarratorVoice(clip.narratorVoice);
  let fallbackVoiceId = null;
  let fallbackRaw = "";
  if (narratorNv?.voiceId) {
    const r = resolveElevenLabsVoiceId(narratorNv.voiceId);
    if (r.voiceId) {
      fallbackVoiceId = r.voiceId;
      fallbackRaw = narratorNv.voiceId;
    }
  }

  const speakerIds = [...new Set(lines.map((l) => trim(l.characterId)).filter(Boolean))];
  const map = {};

  const resolveForCharacter = (characterIdRef, lineVoiceIdRaw) => {
    const char = plan ? findPlanCharacterByPresentRef(plan, characterIdRef) : null;
    const pcmRow = char && pcmAll ? pcmRowForCharacter(pcmAll, char) : null;
    const master = normalizeCharacterVoiceMaster(
      voiceMasterRawForRef(characterVoiceMasters, characterIdRef, plan),
      characterIdRef,
    );

    let chosenRaw = "";
    let sourceStep = "";
    if (trim(lineVoiceIdRaw)) {
      chosenRaw = trim(lineVoiceIdRaw);
      sourceStep = "explicit_line_voiceId";
    } else if (pcmRow && trim(pcmRow.elevenLabsVoiceId)) {
      chosenRaw = trim(pcmRow.elevenLabsVoiceId);
      sourceStep = "project_character_master_row";
    } else if (trim(master?.voiceId)) {
      chosenRaw = trim(master.voiceId);
      sourceStep = "character_voice_master";
    } else if (fallbackVoiceId) {
      chosenRaw = fallbackRaw || fallbackVoiceId;
      sourceStep = "narrator_default_fallback";
    } else if (speakerIds.length && master?.voiceId === "") {
      chosenRaw = "";
      sourceStep = "unresolved";
    }

    const resolved = chosenRaw ? resolveElevenLabsVoiceId(chosenRaw) : { voiceId: null, error: "Nessun voice id" };
    let finalId = resolved.voiceId;
    let fallbackUsed = false;
    if (!finalId && fallbackVoiceId) {
      finalId = fallbackVoiceId;
      fallbackUsed = true;
      sourceStep = `${sourceStep}_then_narrator_fallback`;
    }

    const speakerKey = char ? stableCharacterKey(char) : characterIdRef;
    const name = planCharacterDisplayName(plan, characterIdRef);

    return {
      speakerId: speakerKey || characterIdRef,
      characterId: characterIdRef,
      speakerName: name,
      chosenVoiceProvider: "elevenlabs",
      chosenVoiceId: finalId,
      voiceSourceType: inferVoiceSourceType(chosenRaw, finalId, fallbackUsed),
      language: LANGUAGE_DEFAULT,
      fallbackUsed,
      rationale: [
        sourceStep,
        resolved.error && chosenRaw ? `resolve: ${resolved.error}` : null,
        pcmRow ? "PCM row consultato per estensioni future (voiceId custom)." : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  };

  for (const cid of speakerIds) {
    const lineWithVoice = lines.find((l) => l.characterId === cid && trim(l.voiceId));
    const entry = resolveForCharacter(cid, lineWithVoice?.voiceId || "");
    map[cid] = entry;
  }

  return map;
}

/**
 * Classificazione clip dialogica.
 */
export function classifyDialogueMode(clip, lines) {
  const c = clip && typeof clip === "object" ? clip : {};
  if (c.clipType !== CLIP_TYPE.DIALOGUE) {
    return "narrator_only";
  }
  if (!lines.length) return "unresolved_speaker_dialogue";
  if (lines.some((l) => !trim(l.characterId))) return "unresolved_speaker_dialogue";
  const ids = [...new Set(lines.map((l) => trim(l.characterId)).filter(Boolean))];
  if (ids.length === 0) return "unresolved_speaker_dialogue";
  if (String(c.narratorText || "").trim() && lines.length) return "dialogue_with_narrator_bridge";
  if (ids.length === 1) return "single_speaker_dialogue";
  return "multi_speaker_dialogue";
}

export function buildDialogueExecutionStrategy(args) {
  const clip = args?.clip && typeof args.clip === "object" ? args.clip : {};
  const plan = args?.plan && typeof args.plan === "object" ? args.plan : null;
  const bundle = args?.compiledAudioDesignBundle && typeof args.compiledAudioDesignBundle === "object" ? args.compiledAudioDesignBundle : {};
  const lines = (Array.isArray(clip.dialogLines) ? clip.dialogLines : []).map(normalizeDialogLine).filter(Boolean);
  const mode = classifyDialogueMode(clip, lines);
  const present = scenePresentCharacterRefs(plan, clip.sceneId);
  const speakerIds = [...new Set(lines.map((l) => trim(l.characterId)).filter(Boolean))];
  const unknownInCast = speakerIds.filter((id) => present.length && !present.includes(id));

  return {
    version: DIALOGUE_EXECUTION_ENGINE_VERSION,
    dialogueMode: mode,
    speakerCount: speakerIds.length,
    speakerIdsOrdered: speakerIds,
    sceneCastRefs: present,
    overlapsAllowed: false,
    bridgeNarrator: false,
    targetClipDurationSec: typeof args?.clipDurationSec === "number" ? args.clipDurationSec : null,
    audioDesignNote: bundle.compiledAudioMixIntent?.voicePriority || null,
    warnings: [
      unknownInCast.length ? `Battute per personaggi non in characters_present: ${unknownInCast.join(", ")}` : null,
    ].filter(Boolean),
    future: ["overlap", "cross_talk", "semantic_timing", "spatial_dialogue_mix"],
  };
}

export function buildDialogueVoiceCastingPlan(strategy, args) {
  const map = buildSpeakerVoiceMap(args);
  return {
    version: DIALOGUE_EXECUTION_ENGINE_VERSION,
    builtAt: new Date().toISOString(),
    speakerVoiceMap: map,
    castingOrder: Object.keys(map),
  };
}

export function buildDialogueRenderPlan(strategy, lines, speakerVoiceMap, opts = {}) {
  const pauseMs = typeof opts.pauseMs === "number" ? opts.pauseMs : DEFAULT_PAUSE_MS;
  return {
    version: DIALOGUE_EXECUTION_ENGINE_VERSION,
    provider: "elevenlabs",
    model: "text_to_speech_mp3_per_line",
    lineCount: lines.length,
    orderedLineIds: lines.map((l) => l.id),
    pauseBetweenLinesMs: pauseMs,
    concatOutput: "stereo_wav_pcm",
    uploadToFal: true,
    notes: "Una chiamata TTS ElevenLabs per battuta; decode → resample → concat con silenzio.",
  };
}

export function buildDialogueTimingPlan(lines, pausesMs, estimatedDurations, actualDurations) {
  const speakerSequence = lines.map((l) => ({
    lineId: l.id,
    characterId: l.characterId,
  }));
  const est = estimatedDurations || lines.map(() => null);
  const act = actualDurations || lines.map(() => null);
  const pauseSec = (pausesMs / 1000) * Math.max(0, lines.length - 1);
  const totalEst = est.reduce((a, b) => (typeof b === "number" ? a + b : a), 0) + pauseSec;
  const totalAct = act.some((x) => x == null || !Number.isFinite(x))
    ? null
    : act.reduce((a, b) => a + b, 0) + pauseSec;
  return {
    version: DIALOGUE_EXECUTION_ENGINE_VERSION,
    orderedLines: lines.map((l) => ({ id: l.id, characterId: l.characterId, textLen: trim(l.text).length })),
    speakerSequence,
    pausesMs: lines.length > 1 ? Array(lines.length - 1).fill(pausesMs) : [],
    estimatedLineDurations: est,
    actualLineDurations: act,
    overlapsAllowed: false,
    finalDialogueDurationSecEstimated: Math.round(totalEst * 10) / 10,
    finalDialogueDurationSecActual: totalAct != null ? Math.round(totalAct * 10) / 10 : null,
  };
}

/**
 * Esegue TTS multi-turn reale e produce AudioBuffer stereo + blob WAV.
 */
export async function executeDialogueMultiVoiceRender(opts) {
  const { clip, lines, speakerVoiceMap, pauseMs = DEFAULT_PAUSE_MS, onLineProgress } = opts;

  const perLine = [];
  const decodedChunks = [];
  let sampleRate = 48000;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = trim(line.text);
    if (!text) {
      perLine.push({ lineIndex: i, lineId: line.id, characterId: line.characterId, ok: false, error: "empty_text", durationSec: null });
      continue;
    }
    const vm = speakerVoiceMap[line.characterId];
    const voiceId = vm?.chosenVoiceId;
    if (!voiceId) {
      perLine.push({
        lineIndex: i,
        lineId: line.id,
        characterId: line.characterId,
        ok: false,
        error: "no_voice_id",
        durationSec: null,
      });
      continue;
    }

    if (typeof console !== "undefined" && console.info) {
      console.info("[AXSTUDIO · dialogue provider dispatch]", {
        clipId: clip?.id,
        lineIndex: i,
        lineId: line.id,
        characterId: line.characterId,
        voiceId,
      });
    }

    try {
      const blob = await elevenLabsTextToSpeechMp3({ text, voiceId });
      const dur = await measureAudioBlobDurationSeconds(blob);
      const buf = await decodeBlobToAudioBuffer(blob);
      if (i === 0) sampleRate = buf.sampleRate;
      const bufStereo = resampleToRate(buf, sampleRate);
      decodedChunks.push(bufStereo);
      perLine.push({
        lineIndex: i,
        lineId: line.id,
        characterId: line.characterId,
        voiceId,
        ok: true,
        durationSec: dur,
        error: null,
      });
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · dialogue provider result]", {
          clipId: clip?.id,
          lineIndex: i,
          ok: true,
          durationSec: dur,
        });
      }
    } catch (e) {
      const msg = e?.message || String(e);
      perLine.push({
        lineIndex: i,
        lineId: line.id,
        characterId: line.characterId,
        voiceId,
        ok: false,
        durationSec: null,
        error: msg,
      });
      if (typeof console !== "undefined" && console.info) {
        console.info("[AXSTUDIO · dialogue provider result]", {
          clipId: clip?.id,
          lineIndex: i,
          ok: false,
          error: msg,
        });
      }
      throw new Error(`Dialogo multi-voice: TTS fallito alla battuta ${i + 1}: ${msg}`);
    }
    onLineProgress?.(i, lines.length, line);
  }

  const pauseSamples = Math.max(0, Math.floor((pauseMs / 1000) * sampleRate));
  if (!decodedChunks.length) {
    throw new Error("Dialogo multi-voice: nessun segmento audio dopo le battute.");
  }
  const merged = concatStereoWithPauses(decodedChunks, sampleRate, pauseSamples);
  const wavBlob = audioBufferToWavBlob(merged);
  const finalDur = Math.round(merged.length / sampleRate * 10) / 10;

  const multiVoiceRenderResult = {
    version: DIALOGUE_EXECUTION_ENGINE_VERSION,
    at: new Date().toISOString(),
    provider: "elevenlabs",
    lineRenderCount: perLine.filter((p) => p.ok).length,
    perLine,
    finalDurationSec: finalDur,
    sampleRate,
    pauseBetweenLinesMs: pauseMs,
  };

  const anyFallback = Object.values(speakerVoiceMap).some((v) => v.fallbackUsed);
  if (anyFallback && typeof console !== "undefined" && console.info) {
    console.info("[AXSTUDIO · dialogue fallback]", {
      clipId: clip?.id,
      note: "Almeno un parlante usa fallback narratore/default.",
      speakers: Object.entries(speakerVoiceMap)
        .filter(([, v]) => v.fallbackUsed)
        .map(([k]) => k),
    });
  }

  return { mergedBuffer: merged, wavBlob, multiVoiceRenderResult, finalDurationSec: finalDur };
}

export function buildDialogueConstraintReport(strategy, speakerVoiceMap, lines) {
  const unresolved = [];
  for (const line of lines) {
    const m = speakerVoiceMap[line.characterId];
    if (!m?.chosenVoiceId) unresolved.push(line.characterId);
  }
  const fallbackSpeakers = Object.entries(speakerVoiceMap)
    .filter(([, v]) => v.fallbackUsed)
    .map(([k, v]) => ({ characterId: k, name: v.speakerName }));

  return {
    version: DIALOGUE_EXECUTION_ENGINE_VERSION,
    unresolvedCharacterIds: [...new Set(unresolved)],
    fallbackSpeakers,
    limitations: [
      "Nessun overlap tra battute; ordine rigido.",
      "Nessun cross-talk o turn-taking semantico.",
      "Timing pause fisso tra battute (non prosodico conversazionale).",
    ],
    strategyMode: strategy?.dialogueMode,
  };
}
