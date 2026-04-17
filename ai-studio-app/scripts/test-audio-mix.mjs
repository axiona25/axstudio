/**
 * AXSTUDIO H9 — Mix professionale offline (stesso codice H7) dopo normalizzazione ffmpeg 48k.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  loadAxstudioEnv,
  ensureDirs,
  logAxstudio,
  writeJson,
  timestampSlug,
  installAudioContextShim,
  elevenLabsTtsToFile,
  resolvePresetVoiceId,
  ffprobeDurationSec,
  hasFfmpeg,
  ffmpegNormalizeTo48kStereoDuration,
  decodeAudioFileToF32Stereo,
  fillBufferFromInterleavedF32,
  makeShimAudioBuffer,
  audioBufferLikeToWavFile,
  baseReportFields,
  runFfmpeg,
  RENDERS_DIR,
  REPORTS_DIR,
} from "./axstudio-h9-lib.mjs";
import { CLIP_TYPE } from "../src/services/scenografieVideoWorkflow.js";
import {
  buildProfessionalMixStrategy,
  buildProfessionalMixRenderPlan,
  executeProfessionalMixOffline,
} from "../src/services/professionalAudioMixEngine.js";
import { buildMusicExecutionStrategy, buildMusicRenderPlan } from "../src/services/musicSourceEngine.js";
import { generateMusicWithFal } from "../src/services/musicProviderAdapters.js";
import { renderProceduralAmbientBuffer, renderProceduralSfxBuffer } from "../src/services/audioRenderEngine.js";

function interleavedToBuffer(interleaved, frames, sampleRate) {
  const buf = makeShimAudioBuffer(2, frames, sampleRate);
  fillBufferFromInterleavedF32(buf, interleaved);
  return buf;
}

function wavPathToBuffer(wavPath) {
  const dec = decodeAudioFileToF32Stereo(wavPath);
  if (dec.error) throw new Error(dec.error);
  return interleavedToBuffer(dec.interleaved, dec.frames, dec.sampleRate);
}

async function prepareStemWav(label, srcPath, dur, workDir) {
  const out = path.join(workDir, `norm_${label}.wav`);
  const r = ffmpegNormalizeTo48kStereoDuration(srcPath, out, dur);
  if (!r.ok) throw new Error(r.error || label);
  return out;
}

async function runOneMixScenario({
  name,
  clip,
  stemPresence,
  voiceMp3,
  musicWav,
  ambWav,
  sfxWav,
  workDir,
  bundle,
}) {
  const row = baseReportFields(`mix_${name}`);
  row.provider = "axstudio_professional_mix_engine_v1";
  row.payloadIntent = { clipType: clip.clipType, stemPresence };
  if (!hasFfmpeg()) {
    row.errors.push("ffmpeg richiesto per allineare stem e decodificare.");
    return row;
  }
  try {
    const dur = ffprobeDurationSec(voiceMp3);
    if (dur == null) throw new Error("ffprobe voce fallito");
    const voiceWav = path.join(workDir, `norm_voice_${name}.wav`);
    let r = ffmpegNormalizeTo48kStereoDuration(voiceMp3, voiceWav, dur);
    if (!r.ok) throw new Error(r.error || "voice norm");
    const voiceBuf = wavPathToBuffer(voiceWav);

    let musicBuf = null;
    if (stemPresence.music && musicWav && fs.existsSync(musicWav)) {
      const w = await prepareStemWav("music_" + name, musicWav, dur, workDir);
      musicBuf = wavPathToBuffer(w);
    }
    let ambBuf = null;
    if (stemPresence.ambient && ambWav && fs.existsSync(ambWav)) {
      const w = await prepareStemWav("amb_" + name, ambWav, dur, workDir);
      ambBuf = wavPathToBuffer(w);
    }
    let sfxBuf = null;
    if (stemPresence.sfx && sfxWav && fs.existsSync(sfxWav)) {
      const w = await prepareStemWav("sfx_" + name, sfxWav, dur, workDir);
      sfxBuf = wavPathToBuffer(w);
    }

    const strategy = buildProfessionalMixStrategy({
      clip,
      compiledAudioDesignBundle: bundle,
      clipDurationSec: dur,
      stemPresence,
    });
    const renderPlan = buildProfessionalMixRenderPlan(strategy, {
      sampleRate: voiceBuf.sampleRate,
      lengthSamples: voiceBuf.length,
      stemPresence,
    });

    const t0 = Date.now();
    const mixResult = executeProfessionalMixOffline({
      voiceBuffer: voiceBuf,
      musicBuffer: musicBuf,
      ambientBuffer: ambBuf,
      sfxBuffer: sfxBuf,
      renderPlan,
      strategy,
    });
    row.latencyMs = Date.now() - t0;
    row.success = !!mixResult?.ok;
    row.payloadActuallySent = {
      professionalMixVersion: strategy.version,
      metrics: mixResult.metrics,
      constraintReport: mixResult.constraintReport,
    };
    row.technicalNotes.push(
      "Metriche: peak/RMS interne al motore; nessun LUFS esterno. Tempo include solo processing offline.",
    );
    row.limitationsObserved.push(...(strategy.limitations || []));

    const outMix = path.join(workDir, `mix_out_${name}.wav`);
    audioBufferLikeToWavFile(outMix, mixResult.buffer);
    row.outputFiles = [outMix];
    row.outputDurationSec = ffprobeDurationSec(outMix);
    row.practicalRecommendation =
      "Verifica ascolto manuale; confrontare peakFinal e rmsFinal tra scenari nel JSON.";
  } catch (e) {
    row.errors.push(e?.message || String(e));
    logAxstudio("mix", `scenario ${name} fail`, row.errors[0]);
  }
  return row;
}

export async function runAxstudioTestAudioMix() {
  loadAxstudioEnv();
  installAudioContextShim();
  ensureDirs();
  const slug = timestampSlug();
  const workDir = path.join(RENDERS_DIR, `h9-mix-${slug}`);
  fs.mkdirSync(workDir, { recursive: true });

  const summary = {
    scenario: "H9-E professional mix",
    scenarios: [],
    limitationsHarness: [
      "Richiede ffmpeg+ffprobe per PCM e allineamento durata.",
      "Allineamento temporale = indice campione condiviso dopo normalizzazione SR/durata.",
    ],
  };

  const vPreset = resolvePresetVoiceId("neutral");
  if (!vPreset.voiceId) {
    logAxstudio("mix", "skip: manca REACT_APP_SCENO_EL_VOICE_NEUTRAL");
    writeJson(path.join(REPORTS_DIR, `h9-mix-summary-${slug}.json`), {
      ...summary,
      error: "Voice neutral non configurata",
    });
    return summary;
  }

  const narratorText =
    "Test mix AXSTUDIO: voce in primo piano, letti sotto controllo. Verifica intelligibilità rispetto a musica e rumori di fondo.";
  const voiceMp3 = path.join(workDir, "narrator_voice.mp3");
  logAxstudio("mix", "TTS voce…");
  await elevenLabsTtsToFile(vPreset.voiceId, narratorText, voiceMp3, {});

  let musicRawPath = null;
  const clipM = { clipMusicMood: "warm_family", musicProviderPreference: "fal" };
  const planM = { enabled: true, mood: "warm_family", intensityLevel: "medium" };
  const strat = buildMusicExecutionStrategy({
    clip: clipM,
    compiledMusicPlan: planM,
    clipDurationSec: Math.max(8, ffprobeDurationSec(voiceMp3) || 10),
    compiledAudioDesignBundle: {},
  });
  const falPlan = buildMusicRenderPlan(strat, { activeProvider: "fal", clipDurationSec: strat.targetDurationSec });
  logAxstudio("mix", "Musica FAL per mix…");
  const falRes = await generateMusicWithFal(falPlan, {});
  if (falRes.ok && falRes.audioUrl) {
    musicRawPath = path.join(workDir, "music_fal_raw.wav");
    const res = await fetch(falRes.audioUrl);
    fs.writeFileSync(musicRawPath, Buffer.from(await res.arrayBuffer()));
  } else {
    summary.limitationsHarness.push(`Musica FAL non disponibile: ${falRes.error || "fail"} — scenari con music stem saltati o parziali.`);
  }

  const amb = renderProceduralAmbientBuffer("indoor_home", 8, 48000);
  const sfx = renderProceduralSfxBuffer(2.5, 48000);
  const ambPath = path.join(workDir, "ambient_raw.wav");
  const sfxPath = path.join(workDir, "sfx_raw.wav");
  audioBufferLikeToWavFile(ambPath, amb);
  audioBufferLikeToWavFile(sfxPath, sfx);

  const bundleBase = {
    compiledMusicPlan: planM,
    compiledAmbientPlan: { backgroundPresence: "discreta" },
    compiledSfxPlan: { subtlety: "moderata" },
    compiledAudioMixIntent: { voicePriority: "primaria", musicUnderVoice: true },
  };

  const s1 = await runOneMixScenario({
    name: "voice_music",
    clip: { clipType: CLIP_TYPE.NARRATED },
    stemPresence: { music: !!musicRawPath, ambient: false, sfx: false },
    voiceMp3,
    musicWav: musicRawPath,
    ambWav: null,
    sfxWav: null,
    workDir,
    bundle: bundleBase,
  });
  summary.scenarios.push(s1);

  const s2 = await runOneMixScenario({
    name: "voice_music_amb_sfx",
    clip: { clipType: CLIP_TYPE.NARRATED },
    stemPresence: { music: !!musicRawPath, ambient: true, sfx: true },
    voiceMp3,
    musicWav: musicRawPath,
    ambWav: ambPath,
    sfxWav: sfxPath,
    workDir,
    bundle: bundleBase,
  });
  summary.scenarios.push(s2);

  const vA = resolvePresetVoiceId("female_young");
  const vB = resolvePresetVoiceId("male_mature");
  const d1 = path.join(workDir, "d_line1.mp3");
  const d2 = path.join(workDir, "d_line2.mp3");
  if (vA.voiceId && vB.voiceId && musicRawPath) {
    await elevenLabsTtsToFile(vA.voiceId, "Prima battuta del dialogo di test.", d1, {});
    await elevenLabsTtsToFile(vB.voiceId, "Seconda battuta, voce diversa.", d2, {});
    let dialogueMp3 = d1;
    if (hasFfmpeg()) {
      const list = path.join(workDir, "concat_d.txt");
      fs.writeFileSync(list, `file '${path.basename(d1)}'\nfile '${path.basename(d2)}'\n`, "utf8");
      dialogueMp3 = path.join(workDir, "dialogue_pair.mp3");
      const c = runFfmpeg(
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          list,
          "-c:a",
          "libmp3lame",
          "-q:a",
          "4",
          dialogueMp3,
        ],
        { cwd: workDir },
      );
      if (c.status !== 0) dialogueMp3 = d1;
    }
    const bundleDlg = {
      ...bundleBase,
      compiledAmbientPlan: { backgroundPresence: "molto_discreta" },
    };
    const s3 = await runOneMixScenario({
      name: "dialogue_voice_music",
      clip: { clipType: CLIP_TYPE.DIALOGUE },
      stemPresence: { music: true, ambient: false, sfx: false },
      voiceMp3: dialogueMp3,
      musicWav: musicRawPath,
      ambWav: null,
      sfxWav: null,
      workDir,
      bundle: bundleDlg,
    });
    summary.scenarios.push(s3);
  } else {
    summary.scenarios.push({
      scenario: "mix_dialogue_voice_music",
      success: false,
      errors: ["Voci dialogo o musica non disponibili per scenario ridotto."],
    });
  }

  const reportPath = path.join(REPORTS_DIR, `h9-mix-summary-${slug}.json`);
  writeJson(reportPath, summary);
  let md = `# AXSTUDIO H9 — Mix summary\n\n`;
  for (const sc of summary.scenarios) {
    md += `## ${sc.scenario || "?"}\n- ok: ${sc.success}\n`;
    if (sc.payloadActuallySent?.metrics)
      md += `- peakFinal: ${sc.payloadActuallySent.metrics.peakAfterProcessing}, rmsFinal: ${sc.payloadActuallySent.metrics.rmsFinal}\n`;
    md += `\n`;
  }
  fs.writeFileSync(path.join(REPORTS_DIR, `h9-mix-summary-${slug}.md`), md, "utf8");
  logAxstudio("report", "mix summary", reportPath);
  return summary;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runAxstudioTestAudioMix().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
