/**
 * Montaggio finale Scenografie — piano esecutivo (H3), trim, preflight CORS, ffmpeg.wasm.
 */

import {
  normalizeTimelinePlan,
  normalizeSceneVideoClip,
  SCENE_VIDEO_CLIP_STATUS,
  estimateClipDurationAuto,
} from "./scenografieVideoWorkflow.js";
import { preflightMontageClipUrls, renderMontageWithFfmpegWasm } from "./montageFfmpegWasm.js";
import { uploadBlobToFalStorage } from "./imagePipeline.js";
import { sanitizeStructuredWorkflowFailure } from "./scenografieConsumerReliability.js";
import {
  getVideoRenderProfile,
  normalizeFinalRenderSettings,
  resolveMontageDeliveryDimensions,
} from "./videoRenderProfiles.js";

const MONTAGE_PLAN_VERSION = 2;
const TRIM_EPS_SEC = 0.12;

export function emptyFinalFilmMontage() {
  return {
    status: "idle",
    lastCompiledAt: null,
    lastRenderStartedAt: null,
    lastRenderCompletedAt: null,
    /** Allineato all’ultimo render completato con URL (Fase 3 · affidabilità consegna). */
    outputUrlSetAt: null,
    outputUrl: null,
    lastError: null,
    lastWorkflowFailure: null,
    lastMontageAttemptAt: null,
    compiledMontagePlan: null,
    montageExecutionPlan: null,
    finalFilmBuildPlan: null,
    lastRenderSummary: null,
  };
}

/**
 * @param {unknown} raw
 */
export function normalizeFinalFilmMontage(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const st = String(d.status || "idle").trim();
  const status = ["idle", "compiling", "ready", "rendering", "complete", "failed"].includes(st) ? st : "idle";
  return {
    status,
    lastCompiledAt: d.lastCompiledAt ?? null,
    lastRenderStartedAt: d.lastRenderStartedAt ?? null,
    lastRenderCompletedAt: d.lastRenderCompletedAt ?? null,
    outputUrlSetAt:
      d.outputUrlSetAt != null && String(d.outputUrlSetAt).trim() ? String(d.outputUrlSetAt).trim() : null,
    outputUrl: d.outputUrl != null && String(d.outputUrl).trim() ? String(d.outputUrl).trim() : null,
    lastError: d.lastError != null && String(d.lastError).trim() ? String(d.lastError).trim() : null,
    lastWorkflowFailure: sanitizeStructuredWorkflowFailure(d.lastWorkflowFailure),
    lastMontageAttemptAt:
      d.lastMontageAttemptAt != null && String(d.lastMontageAttemptAt).trim()
        ? String(d.lastMontageAttemptAt).trim()
        : null,
    compiledMontagePlan: d.compiledMontagePlan && typeof d.compiledMontagePlan === "object" ? d.compiledMontagePlan : null,
    montageExecutionPlan: d.montageExecutionPlan && typeof d.montageExecutionPlan === "object" ? d.montageExecutionPlan : null,
    finalFilmBuildPlan: d.finalFilmBuildPlan && typeof d.finalFilmBuildPlan === "object" ? d.finalFilmBuildPlan : null,
    lastRenderSummary: d.lastRenderSummary && typeof d.lastRenderSummary === "object" ? d.lastRenderSummary : null,
  };
}

/**
 * Risolve durata logica montaggio + fonte + idoneità trim rispetto a videoDurationSeconds (proxy lunghezza file).
 * @param {object} clip
 * @param {number|null|undefined} timelineHintSec
 */
export function resolveClipMontageTiming(clip, timelineHintSec) {
  const c = clip && typeof clip === "object" ? clip : {};
  const videoReal =
    typeof c.videoDurationSeconds === "number" && Number.isFinite(c.videoDurationSeconds) && c.videoDurationSeconds > 0
      ? Math.round(c.videoDurationSeconds * 10) / 10
      : null;
  const audio =
    typeof c.audioDurationSeconds === "number" && Number.isFinite(c.audioDurationSeconds) && c.audioDurationSeconds > 0
      ? Math.round(c.audioDurationSeconds * 10) / 10
      : null;
  const manual =
    typeof c.durationSeconds === "number" && Number.isFinite(c.durationSeconds) && c.durationSeconds > 0
      ? Math.round(c.durationSeconds * 10) / 10
      : null;
  const est = estimateClipDurationAuto(c);
  const estimateRounded = est > 0 ? Math.round(est * 10) / 10 : null;

  let baseSec = null;
  let baseSource = null;
  if (videoReal) {
    baseSec = videoReal;
    baseSource = "video_real";
  } else if (audio) {
    baseSec = audio;
    baseSource = "audio_duration";
  } else if (manual) {
    baseSec = manual;
    baseSource = "duration_manual";
  } else if (estimateRounded) {
    baseSec = estimateRounded;
    baseSource = "estimate_text";
  }

  let resolvedDurationSec = baseSec;
  let durationSource = baseSource || "unknown";
  const timelineHint =
    typeof timelineHintSec === "number" && Number.isFinite(timelineHintSec) && timelineHintSec > 0
      ? Math.round(timelineHintSec * 10) / 10
      : null;

  let timelineTrimNote = null;
  if (timelineHint != null) {
    if (resolvedDurationSec == null) {
      resolvedDurationSec = timelineHint;
      durationSource = "timeline_entry_only";
    } else if (timelineHint + TRIM_EPS_SEC < resolvedDurationSec) {
      resolvedDurationSec = timelineHint;
      durationSource = `${baseSource}_trimmed_by_timeline`;
      timelineTrimNote = `Timeline ${timelineHint}s accorcia rispetto a ${baseSource} (${baseSec}s).`;
    } else if (timelineHint > resolvedDurationSec + TRIM_EPS_SEC) {
      timelineTrimNote = `Timeline ${timelineHint}s richiede più del materiale risolto (${resolvedDurationSec}s) — uso lunghezza materiale.`;
      durationSource = `${baseSource}_timeline_longer_ignored`;
    }
  }

  const fileDurationSec = videoReal;
  const canTrimExactly =
    fileDurationSec != null &&
    resolvedDurationSec != null &&
    resolvedDurationSec + TRIM_EPS_SEC < fileDurationSec;
  const needsFullClipFallback = !canTrimExactly;

  const trimDurationSecForRender = canTrimExactly ? resolvedDurationSec : null;

  return {
    resolvedDurationSec,
    durationSource,
    chosenDurationSource: durationSource,
    baseDurationSec: baseSec,
    baseDurationSource: baseSource,
    fileDurationSec,
    canTrimExactly,
    needsFullClipFallback,
    trimDurationSecForRender,
    timelineTrimNote,
  };
}

/**
 * @param {object} clip
 * @returns {number|null}
 */
export function resolveEffectiveClipDurationSeconds(clip) {
  return resolveClipMontageTiming(clip, null).resolvedDurationSec ?? null;
}

function stemRenderedCount(clips, stemKey) {
  return (clips || []).filter((c) => {
    const s = c?.[stemKey];
    return s && typeof s === "object" && String(s.status || "").toLowerCase() === "ok" && String(s.url || "").trim();
  }).length;
}

function buildAudioPlanReference(clips) {
  const list = Array.isArray(clips) ? clips : [];
  const voiceExecutable = list.length > 0;
  let musicPlanned = 0;
  let ambientPlanned = 0;
  let sfxPlanned = 0;
  for (const c of list) {
    const b = c?.compiledAudioDesignBundle;
    if (b?.placeholderMixLayout?.tracks) {
      for (const t of b.placeholderMixLayout.tracks) {
        if (t.role === "music_bed" && t.pipelineStatus === "planned") musicPlanned += 1;
        if (t.role === "ambient_bed" && t.pipelineStatus === "planned") ambientPlanned += 1;
        if (t.role === "sfx_spot" && t.pipelineStatus === "planned") sfxPlanned += 1;
      }
    }
  }
  const musicRendered = stemRenderedCount(list, "musicStem");
  const ambientRendered = stemRenderedCount(list, "ambientStem");
  const sfxRendered = stemRenderedCount(list, "sfxStem");
  return {
    voiceStem: {
      executableNow: voiceExecutable,
      note: "Audio del segmento = traccia incorporata nel MP4 di ogni clip (mix H7: voce + bed se generati in pipeline). Cinematic: mux post-O3 con la stessa traccia.",
      sourceField: "clip.videoUrl (container)",
    },
    musicBed: {
      executableNow: false,
      futureOnly: false,
      plannedClipsCount: musicPlanned,
      clipsWithRenderedStemCount: musicRendered,
      reference: "compiledAudioDesignBundle.compiledMusicPlan · clip.musicStem",
      note: "Il concat non carica stem musica separati: se H6/H7 ha prodotto il bed, è già nel container clip.",
    },
    ambientBed: {
      executableNow: false,
      futureOnly: false,
      plannedClipsCount: ambientPlanned,
      clipsWithRenderedStemCount: ambientRendered,
      reference: "compiledAudioDesignBundle.compiledAmbientPlan · clip.ambientStem",
      note: "Come sopra: bed ambientale MVP, se renderizzato, è nel mix clip incorporato nel video.",
    },
    sfx: {
      executableNow: false,
      futureOnly: false,
      plannedClipsCount: sfxPlanned,
      clipsWithRenderedStemCount: sfxRendered,
      reference: "compiledAudioDesignBundle.compiledSfxPlan · clip.sfxStem",
      note: "SFX MVP procedurali, se presenti, sono nel mix clip — non rieseguiti nel passo film.",
    },
    finalMix: {
      executableNow: false,
      futureOnly: true,
      note: "Nessun secondo mix/mastering globale sul film concatenato nel MVP (solo concat dei file clip).",
    },
  };
}

function summarizeAudioMixFromClips(clips) {
  const lines = [];
  const slots = {
    voiceStems: [],
    musicBedPlanned: 0,
    ambientBedPlanned: 0,
    sfxPlanned: 0,
  };
  for (const c of clips) {
    const b = c?.compiledAudioDesignBundle;
    const mix = b?.compiledAudioMixIntent;
    const ex = b?.executionSurface;
    if (mix?.soundEnergy) lines.push(`${c.id?.slice(0, 8)}…: energia ${mix.soundEnergy}`);
    if (b?.placeholderMixLayout?.tracks) {
      for (const t of b.placeholderMixLayout.tracks) {
        if (t.role === "music_bed" && t.pipelineStatus === "planned") slots.musicBedPlanned += 1;
        if (t.role === "ambient_bed" && t.pipelineStatus === "planned") slots.ambientBedPlanned += 1;
        if (t.role === "sfx_spot" && t.pipelineStatus === "planned") slots.sfxPlanned += 1;
      }
    }
    if (ex?.voiceStemFromElevenLabs) slots.voiceStems.push(c.id);
  }
  const stemHint = [];
  if (slots.musicBedPlanned) stemHint.push(`${slots.musicBedPlanned} musica (design)`);
  if (slots.ambientBedPlanned) stemHint.push(`${slots.ambientBedPlanned} ambiente (design)`);
  if (slots.sfxPlanned) stemHint.push(`${slots.sfxPlanned} SFX (design)`);
  const defaultLine =
    stemHint.length > 0
      ? `Piano audio nei clip: ${stemHint.join(", ")} — nel file finale ogni segmento usa l’audio già missato in clip (se generato), non un remix film.`
      : "Montaggio: concat di clip.videoUrl ciascuno con audio incorporato dal passo clip (non remix inter-film in MVP).";
  return {
    summaryLine: lines.length ? lines.join(" · ") : defaultLine,
    futureStemSlots: slots,
  };
}

function buildTransitionPlan(segmentsLen, titleCardIntro, endCredits, fadeHintSec) {
  const hint = typeof fadeHintSec === "number" && fadeHintSec > 0 ? fadeHintSec : 0.35;
  const plan = [];
  if (segmentsLen > 0) {
    plan.push({
      position: "before_first",
      index: 0,
      type: titleCardIntro ? "title_card_placeholder" : "cut",
      fadeDurationSec: 0,
      mvpImplemented: !titleCardIntro,
      futureNote: titleCardIntro ? "Titolo intro non generato nel concat MVP." : null,
    });
  }
  for (let i = 1; i < segmentsLen; i++) {
    const type = hint < 0.22 ? "cut" : hint < 0.55 ? "fade_short" : "fade_medium";
    plan.push({
      position: "between",
      afterSegmentIndex: i - 1,
      beforeSegmentIndex: i,
      type,
      fadeDurationSecSuggested: hint,
      mvpImplemented: true,
      mvpBehavior: "cut_hard",
      futureNote: type === "cut" ? null : `Fade ${type} pianificato — non ancora nel render wasm.`,
    });
  }
  if (segmentsLen > 0) {
    plan.push({
      position: "after_last",
      index: segmentsLen - 1,
      type: endCredits ? "credits_placeholder" : "cut",
      mvpImplemented: !endCredits,
      futureNote: endCredits ? "Credits non generati nel concat MVP." : null,
    });
  }
  return plan;
}

/**
 * @param {object} ctx
 * @param {object} ctx.timelinePlan
 * @param {object} [ctx.finalMontagePlan]
 * @param {object[]} ctx.sceneVideoClips
 */
export function compileMontagePlans(ctx) {
  const { timelinePlan, finalMontagePlan = {}, sceneVideoClips = [] } = ctx || {};
  const tp = normalizeTimelinePlan(timelinePlan);
  const clips = (sceneVideoClips || []).map((c) => normalizeSceneVideoClip(c)).filter(Boolean);
  const byId = Object.fromEntries(clips.map((c) => [c.id, c]));

  const titleCardIntro = finalMontagePlan?.titleCardIntro === true;
  const endCredits = finalMontagePlan?.endCredits === true;
  const fadeHintSec = typeof finalMontagePlan?.transitionFadeHintSec === "number" ? finalMontagePlan.transitionFadeHintSec : 0.35;

  const warnings = [];
  const renderableClipSegments = [];

  for (const e of tp.entries || []) {
    if (e.kind !== "clip" || !e.clipId) continue;
    const c = byId[e.clipId];
    if (!c) {
      warnings.push(`Clip ${e.clipId} non trovata (timeline voce ${e.id}).`);
      continue;
    }
    if (c.status === SCENE_VIDEO_CLIP_STATUS.DELETED) {
      warnings.push(`Clip ${c.id} eliminata — omessa.`);
      continue;
    }
    if (c.status !== SCENE_VIDEO_CLIP_STATUS.APPROVED && c.status !== SCENE_VIDEO_CLIP_STATUS.FINAL) {
      warnings.push(`Clip ${c.id} non approvata/finale — omessa.`);
      continue;
    }
    /** Montaggio: usa sempre clip.videoUrl — per cinematic deve essere il MP4 muxato post-O3 (pipeline Scenografie), non l'URL grezzo provider. */
    const url = String(c.videoUrl || "").trim();
    if (!url) {
      warnings.push(`Clip ${c.id} senza videoUrl — omessa dal montaggio.`);
      continue;
    }
    const timelineHint = typeof e.durationSec === "number" && e.durationSec > 0 ? e.durationSec : null;
    const timing = resolveClipMontageTiming(c, timelineHint);
    if (timing.timelineTrimNote) warnings.push(`${c.id}: ${timing.timelineTrimNote}`);
    if (timing.needsFullClipFallback && timing.resolvedDurationSec != null && timing.fileDurationSec == null) {
      warnings.push(
        `${c.id}: nessun videoDurationSeconds — montaggio usa file intero; durata logica (${timing.resolvedDurationSec}s) è solo stima.`,
      );
    }

    const trimStrategy = timing.canTrimExactly ? "time_limit" : "full_file";

    renderableClipSegments.push({
      timelineEntryId: e.id,
      clipId: c.id,
      sceneId: c.sceneId,
      videoUrl: url,
      clipStatus: c.status,
      resolvedDurationSec: timing.resolvedDurationSec,
      effectiveDurationSec: timing.resolvedDurationSec,
      durationSource: timing.durationSource,
      chosenDurationSource: timing.chosenDurationSource,
      baseDurationSec: timing.baseDurationSec,
      baseDurationSource: timing.baseDurationSource,
      timelineDurationHintSec: timelineHint,
      fileDurationSec: timing.fileDurationSec,
      canTrimExactly: timing.canTrimExactly,
      needsFullClipFallback: timing.needsFullClipFallback,
      trimDurationSecForRender: timing.trimDurationSecForRender,
      trimStrategy,
    });
  }

  const orderedClipIds = renderableClipSegments.map((s) => s.clipId);
  const orderedClipUrls = renderableClipSegments.map((s) => s.videoUrl);
  const effectiveDurationsSec = renderableClipSegments.map((s) => s.resolvedDurationSec);
  const totalDurationSecEstimate = effectiveDurationsSec.reduce((a, x) => a + (typeof x === "number" ? x : 0), 0);

  const transitionPlan = buildTransitionPlan(renderableClipSegments.length, titleCardIntro, endCredits, fadeHintSec);
  const transitionsNotRendered = transitionPlan.filter((t) => t.mvpImplemented === false);
  const crossfadePlannedButCutOnly = transitionPlan.filter(
    (t) => t.position === "between" && t.type !== "cut" && t.mvpImplemented === true,
  );

  const clipsForMix = renderableClipSegments.map((s) => byId[s.clipId]).filter(Boolean);
  const audioMixIntentSummary = summarizeAudioMixFromClips(clipsForMix);
  const audioPlanReference = buildAudioPlanReference(clipsForMix);

  const executionWarnings = [...warnings];
  if (transitionsNotRendered.length) {
    executionWarnings.push(
      ...transitionsNotRendered.map((t) => `Transizione non inclusa nel render MVP: ${t.type} (${t.position}).`),
    );
  }
  if (crossfadePlannedButCutOnly.length) {
    executionWarnings.push(
      `${crossfadePlannedButCutOnly.length} giunzione/i pianificata/e come fade ma il render usa solo taglio netto (vedi transitionPlan[].mvpBehavior).`,
    );
  }

  const wasmSegments = renderableClipSegments.map((s, idx) => ({
    index: idx,
    videoUrl: s.videoUrl,
    trimDurationSec: s.trimDurationSecForRender,
    fileDurationSec: s.fileDurationSec,
  }));

  const compiledMontagePlan = {
    engineVersion: MONTAGE_PLAN_VERSION,
    compiledAt: new Date().toISOString(),
    timelineApproved: tp.approved === true,
    orderedClipIds,
    orderedClipUrls,
    effectiveDurationsSec,
    chosenDurationSource: renderableClipSegments.map((s) => s.chosenDurationSource),
    totalDurationSecEstimate: Math.round(totalDurationSecEstimate * 10) / 10,
    renderableClipSegments,
    transitionPlan,
    transitionHintsLegacy: transitionPlan,
    audioPlanReference,
    audioMixIntentSummary,
    titleCardIntro,
    endCredits,
    warnings,
    executionWarnings,
    segmentDetails: renderableClipSegments,
    wasmSegments,
    transitionReport: {
      transitionsNotRenderedCount: transitionsNotRendered.length,
      crossfadePlannedCutOnlyCount: crossfadePlannedButCutOnly.length,
    },
    trimPolicy: {
      epsilonSec: TRIM_EPS_SEC,
      note: "Trim eseguito solo se videoDurationSeconds è noto e la durata risolta è più corta del file.",
    },
    whatRunsInMvp: {
      video: "concat_mp4_browser_ffmpeg_wasm",
      trim: "per_segment_t_copy_then_reencode_on_fail",
      transitions: "hard_cut_only",
      audioPerClip: "incorporato_in_ogni_clip_videoUrl (mix pipeline clip; cinematic = mux post-O3)",
      filmLevelAudioRemix: "non_eseguito",
    },
    whatIsFutureOnly: [
      "crossfade_transitions",
      "film_level_stereo_mastering_remix",
      "title_card_and_credits_generation",
    ],
  };

  const montageExecutionPlan = {
    engineVersion: MONTAGE_PLAN_VERSION,
    mode: "ffmpeg_wasm_montage",
    renderModePreference: "per_segment_trim_then_concat_copy_then_concat_reencode",
    renderModeResolved: null,
    orderedInputUrls: orderedClipUrls,
    wasmSegments,
    concatStrategy: "try_codec_copy_then_reencode_on_failure",
    outputContainer: "mp4",
    postProcess: {
      uploadTarget: "fal_storage",
    },
    corsPreflightRequired: true,
    futureAudioMix: {
      note:
        "Il film MVP non rimixa stem separati: musica/ambiente/SFX, se prodotti, sono già nel mix di ogni clip e quindi nella traccia audio del MP4 concatenato. Future: mastering globale / remix inter-clip.",
      stemSlots: audioMixIntentSummary.futureStemSlots,
    },
    audioPlanReference,
    transitionPlan,
    executionWarnings,
  };

  const finalFilmBuildPlan = {
    engineVersion: MONTAGE_PLAN_VERSION,
    orderedClipIds,
    orderedClipUrls,
    renderableClipSegments,
    effectiveDurationsSec,
    transitionPlan,
    audioPlanReference,
    audioMixIntentSummary,
    titleCardIntro,
    endCredits,
    executionWarnings,
    render: {
      executor: "browser_ffmpeg_wasm",
      requiresFalKey: true,
      memoryNote: "Caricamento N clip in memoria WASM; progetti molto lunghi possono pressare il browser.",
    },
  };

  return { compiledMontagePlan, montageExecutionPlan, finalFilmBuildPlan };
}

/**
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function validateMontageRenderable(compiledMontagePlan) {
  const reasons = [];
  const p = compiledMontagePlan && typeof compiledMontagePlan === "object" ? compiledMontagePlan : null;
  if (!p) {
    reasons.push("Piano montaggio non compilato.");
    return { ok: false, reasons };
  }
  const urls = Array.isArray(p.orderedClipUrls) ? p.orderedClipUrls : [];
  if (!urls.length) reasons.push("Nessun clip con video nella timeline approvata.");
  if (!String(process.env.REACT_APP_FAL_API_KEY || "").trim()) reasons.push("REACT_APP_FAL_API_KEY richiesta per upload filmato finale.");
  return { ok: reasons.length === 0, reasons };
}

/**
 * @param {object} compiledMontagePlan
 * @param {{
 *   fileNamePrefix?: string,
 *   onProgress?: (s: string) => void,
 *   finalRenderSettings?: { resolution?: string, fps?: number },
 * }} [opts]
 */
export async function runFinalMontageRender(compiledMontagePlan, opts = {}) {
  const { fileNamePrefix = "axstudio_final_film", onProgress } = opts;
  const fr = normalizeFinalRenderSettings(opts.finalRenderSettings || null);
  const dims = resolveMontageDeliveryDimensions(fr.resolution);
  let deliveryProfile = getVideoRenderProfile({
    mode: "final",
    finalResolutionKey: dims.effectiveResolution,
    finalFps: fr.fps,
  });
  /** @type {object} */
  let deliveryMeta = {
    requestedResolution: dims.requestedResolution,
    effectiveResolution: dims.effectiveResolution,
    fallbackReason: dims.fallbackReason,
    exportPurpose: "delivery",
    isFinal: true,
  };
  const p = compiledMontagePlan && typeof compiledMontagePlan === "object" ? compiledMontagePlan : {};
  const urls = Array.isArray(p.orderedClipUrls) ? p.orderedClipUrls : [];
  if (!urls.length) throw new Error("Piano montaggio senza URL video.");

  onProgress?.("Preflight CORS / fetch clip…");
  const preflight = await preflightMontageClipUrls(urls);
  if (typeof console !== "undefined" && console.info) {
    console.info("[AXSTUDIO · montage · segment decision]", {
      segments: (p.renderableClipSegments || []).map((s) => ({
        clipId: s.clipId,
        resolvedDurationSec: s.resolvedDurationSec,
        durationSource: s.durationSource,
        canTrimExactly: s.canTrimExactly,
        needsFullClipFallback: s.needsFullClipFallback,
        trimDurationSecForRender: s.trimDurationSecForRender,
      })),
      preflight: preflight.results?.map((r) => ({ ok: r.fetchable, url: String(r.url).slice(0, 72), error: r.error })),
    });
  }
  if (!preflight.allFetchable) {
    const block = preflight.results?.find((x) => !x.fetchable);
    throw new Error(
      `Montaggio: clip non scaricabile dal browser (CORS o rete). URL: ${preflight.blockingUrl || block?.url || "?"}. Dettaglio: ${block?.error || "fetch_failed"}`,
    );
  }

  const wasmSegments =
    Array.isArray(p.wasmSegments) && p.wasmSegments.length === urls.length
      ? p.wasmSegments
      : (p.renderableClipSegments || []).map((s, idx) => ({
          index: idx,
          videoUrl: s.videoUrl,
          trimDurationSec: s.trimDurationSecForRender,
          fileDurationSec: s.fileDurationSec,
        }));

  onProgress?.("Avvio render ffmpeg.wasm…");
  let blob;
  let renderModeUsed;
  let segmentResults;
  let concatHadToReencode;
  let deliveryEncode;
  let deliveryMetaOut;
  try {
    ({
      blob,
      renderModeUsed,
      segmentResults,
      concatHadToReencode,
      deliveryEncode,
      deliveryMeta: deliveryMetaOut,
    } = await renderMontageWithFfmpegWasm(
      { segments: wasmSegments, deliveryProfile, deliveryMeta },
      onProgress,
    ));
  } catch (firstErr) {
    const canFallback =
      fr.resolution !== "1080p" &&
      dims.effectiveResolution !== "1080p" &&
      deliveryProfile.finalResolutionKey !== "1080p";
    if (!canFallback) throw firstErr;
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[AXSTUDIO · montage · delivery encode fallback → 1080p]", {
        requested: fr.resolution,
        error: firstErr?.message || String(firstErr),
      });
    }
    deliveryProfile = getVideoRenderProfile({ mode: "final", finalResolutionKey: "1080p", finalFps: fr.fps });
    deliveryMeta = {
      requestedResolution: fr.resolution,
      effectiveResolution: "1080p",
      fallbackReason: "delivery_encode_failed",
      fallbackFromError: firstErr?.message || String(firstErr),
      exportPurpose: "delivery",
      isFinal: true,
    };
    onProgress?.("Riprovo montaggio in Full HD (fallback)…");
    ({
      blob,
      renderModeUsed,
      segmentResults,
      concatHadToReencode,
      deliveryEncode,
      deliveryMeta: deliveryMetaOut,
    } = await renderMontageWithFfmpegWasm(
      { segments: wasmSegments, deliveryProfile, deliveryMeta },
      onProgress,
    ));
  }

  if (typeof console !== "undefined" && console.info) {
    console.info("[AXSTUDIO · montage · render mode]", {
      renderModeUsed,
      concatHadToReencode,
      deliveryEncode,
      deliveryMeta: deliveryMetaOut,
      segmentResults,
    });
  }

  const name = `${fileNamePrefix}_${Date.now()}.mp4`;
  onProgress?.("Upload filmato su fal…");
  const outputUrl = await uploadBlobToFalStorage(blob, name, "video/mp4");

  if (typeof console !== "undefined" && console.info) {
    console.info("[AXSTUDIO · montage · output]", { outputUrl, blobSizeBytes: blob.size, renderModeUsed });
  }

  return {
    outputUrl,
    blobSizeBytes: blob.size,
    renderSummary: {
      at: new Date().toISOString(),
      preflight,
      renderModeUsed,
      segmentResults,
      concatHadToReencode,
      wasmSegmentsSnapshot: wasmSegments,
      deliveryEncode: deliveryEncode ?? false,
      deliveryMeta: deliveryMetaOut || deliveryMeta,
      finalRenderSettingsApplied: fr,
    },
  };
}
