/**
 * AXSTUDIO H9 — Ambient / SFX: path reale nel codice = MVP procedural Web Audio (nessun provider esterno).
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
  audioBufferLikeToWavFile,
  ffprobeDurationSec,
  baseReportFields,
  RENDERS_DIR,
  REPORTS_DIR,
} from "./axstudio-h9-lib.mjs";

export async function runAxstudioTestSfxAmbient() {
  loadAxstudioEnv();
  installAudioContextShim();
  ensureDirs();
  const { renderProceduralAmbientBuffer, renderProceduralSfxBuffer } = await import(
    "../src/services/audioRenderEngine.js"
  );

  const slug = timestampSlug();
  const outDir = path.join(RENDERS_DIR, `h9-sfx-ambient-${slug}`);
  fs.mkdirSync(outDir, { recursive: true });

  const report = baseReportFields("H9-D ambient + SFX procedural MVP");
  report.provider = "none (client-side synthesis)";
  report.modelOrMode = "renderProceduralAmbientBuffer / renderProceduralSfxBuffer";
  report.payloadIntent = {
    ambientPresetId: "nature",
    ambientDurationSec: 6,
    sfxDurationSec: 2,
    sampleRate: 48000,
  };
  report.technicalNotes.push(
    "Allineato a audioRenderEngine.js: ambiente e SFX non passano da FAL/Eleven nel path attuale.",
  );
  report.limitationsObserved.push(
    "Timbro rudimentale (rumore colorato / impulsi); non sostituisce libreria SFX né generazione cloud.",
  );

  const sr = 48000;
  let ambPath = null;
  let sfxPath = null;
  try {
    logAxstudio("sfx", "render ambient bed nature…");
    const amb = renderProceduralAmbientBuffer("nature", 6, sr);
    ambPath = path.join(outDir, "ambient_nature.wav");
    audioBufferLikeToWavFile(ambPath, amb);
    logAxstudio("sfx", "render SFX spot…");
    const sfx = renderProceduralSfxBuffer(2, sr);
    sfxPath = path.join(outDir, "sfx_spot.wav");
    audioBufferLikeToWavFile(sfxPath, sfx);
    report.success = true;
    report.outputFiles = [ambPath, sfxPath];
    report.outputDurationSec = (ffprobeDurationSec(ambPath) || 6) + (ffprobeDurationSec(sfxPath) || 2);
    report.payloadActuallySent = {
      executedPath: "MVP synth in-process (AudioContext shim Node)",
      files: report.outputFiles,
    };
    report.practicalRecommendation =
      "Per produzione: pianificare provider SFX/ambient o libreria; questo output è solo smoke test del ramo codice esistente.";
  } catch (e) {
    report.errors.push(e?.message || String(e));
    logAxstudio("sfx", "fail", report.errors[0]);
  }

  const reportPath = path.join(REPORTS_DIR, `h9-sfx-ambient-${slug}.json`);
  writeJson(reportPath, report);
  logAxstudio("report", "sfx/ambient", reportPath);
  return report;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runAxstudioTestSfxAmbient().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
