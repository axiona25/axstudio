/**
 * Report vincoli / onestà esecutiva per split avatar vs cinematic (Scenografie).
 * Strutturato per UI, snapshot e debug — non sostituisce i log operativi.
 */

/**
 * @param {object|null} strategy — computeVideoExecutionStrategy
 * @param {object|null} renderPlan — buildVideoRenderPlan + finalize*
 * @param {object|null} [dialogueDirectionPlan] — buildDialogueDirectionPlan (solo clip dialogici)
 */
export function buildVideoConstraintReport(strategy, renderPlan, dialogueDirectionPlan = null) {
  const s = strategy && typeof strategy === "object" ? strategy : {};
  const p = renderPlan && typeof renderPlan === "object" ? renderPlan : {};
  const dd =
    dialogueDirectionPlan && typeof dialogueDirectionPlan === "object"
      ? dialogueDirectionPlan
      : s.dialogueDirectionPlan && typeof s.dialogueDirectionPlan === "object"
        ? s.dialogueDirectionPlan
        : null;
  const isAvatar = s.videoExecutorType === "avatar_lipsync" || p.chosenExecutorType === "avatar_lipsync";

  const audioMuxed = p.audioMuxApplied === true;
  const muxPlanned = p.muxAudioIntoVideoAfterProvider === true;

  /** @type {string[]} */
  const limitations = Array.isArray(p.executorLimitations)
    ? [...p.executorLimitations]
    : Array.isArray(s.limitations)
      ? [...s.limitations]
      : [];

  if (!isAvatar) {
    limitations.push(
      "Sync A/V dopo mux: ffmpeg -shortest — allineamento non garantito al frame.",
      "Durata clip API O3 è bucketata (5–15s); può differire dal mix audio.",
    );
  }

  if (dd?.dialogueDirectionConstraintReport) {
    const hdr = dd.dialogueDirectionConstraintReport;
    limitations.push(
      `Regia dialogica multi-soggetto: piano ${hdr.dialogueSceneType || "—"} — shot/staging sono advisory; executor video non fa coverage multi-camera.`,
    );
    if (isAvatar && (dd.speakerCount ?? 0) > 1) {
      limitations.push(
        "Clip dialogico multi-speaker: H8 onora le voci; Kling Avatar applica lip-sync al volto dominante della scena statica, non per speaker separato.",
      );
    }
  }

  return {
    reportVersion: 1,
    builtAt: new Date().toISOString(),
    assemblyFailureStage: p.assemblyFailureStage ?? null,
    assemblyFailedAt: p.assemblyFailedAt ?? null,
    executorType: s.videoExecutorType ?? p.chosenExecutorType ?? null,
    provider: s.videoExecutorProvider ?? p.chosenProvider ?? "fal",
    model: s.videoExecutorModel ?? p.chosenModel ?? null,
    promptDrivenOnly: isAvatar ? false : true,
    audioSentToProvider: p.sendsAudioToProvider === true,
    audioMuxedAfterProvider: muxPlanned ? audioMuxed : false,
    cameraControlMode: isAvatar ? "none_native_api" : "prompt_text_only_no_camera_api",
    shotControlMode: isAvatar ? "none_native_api" : "prompt_text_only",
    motionControlMode: isAvatar ? "audio_driven_talking_avatar" : "reference_i2v_prompt_driven",
    limitations,
    failureSurface: isAvatar
      ? ["fal_queue_kling_avatar_v2_pro", "payload_image_url_audio_url", "lip_sync_quality_model_dependent"]
      : [
          "fal_queue_kling_o3_reference_to_video",
          "remote_fetch_video_bytes_cors",
          "ffmpeg_wasm_mux_shortest",
          "fal_upload_muxed_mp4",
        ],
    rationale: s.rationale ?? null,
    finalVideoAssemblyMode: p.finalVideoAssemblyMode ?? null,
    finalVideoReadyForMontage: p.finalVideoReadyForMontage === true,
    providerReturnedAudioInContainer: p.providerReturnedAudioInContainer === true,
    videoProviderOutputHasFinalMix: isAvatar ? true : false,
    honestyNotes: isAvatar
      ? [
          "Render nativo avatar: audio inviato al provider e incorporato nel container di output.",
          "Nessun parametro camera/shot nativo — solo frame + audio.",
          ...(dd?.dialogueDirectionConstraintReport
            ? [
                `dialogueDirection: audioMultiVoice=${dd.dialogueDirectionConstraintReport.audioMultiVoice || "—"}; multiSubjectPresence=${dd.dialogueDirectionConstraintReport.multiSubjectPresenceSupport || "—"}; regiaVideo=${dd.dialogueDirectionConstraintReport.dialogueRegiaVideoTier || "—"}.`,
              ]
            : []),
        ]
      : [
          "O3 genera video senza traccia audio finale del mix AXSTUDIO (generate_audio=false).",
          "Il file usato per montaggio è il MP4 muxato dopo il provider, non l’URL grezzo O3.",
          ...(dd?.dialogueDirectionConstraintReport
            ? [
                "Regia dialogica (se presente): intenti multi-soggetto solo nel prompt / advisory — nessuno shot editing nativo.",
              ]
            : []),
        ],
    dialogueDirectionConstraintReport: dd?.dialogueDirectionConstraintReport ?? null,
  };
}
