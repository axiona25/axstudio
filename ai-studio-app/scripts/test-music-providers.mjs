/**
 * AXSTUDIO H9 — Musica: stesso intent strategia, esecuzione FAL vs ElevenLabs.
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
  downloadToFile,
  ffprobeDurationSec,
  baseReportFields,
  RENDERS_DIR,
  REPORTS_DIR,
} from "./axstudio-h9-lib.mjs";
import { buildMusicExecutionStrategy, buildMusicRenderPlan } from "../src/services/musicSourceEngine.js";
import { generateMusicWithFal, generateMusicWithEleven } from "../src/services/musicProviderAdapters.js";

export async function runAxstudioTestMusicProviders() {
  loadAxstudioEnv();
  ensureDirs();
  const slug = timestampSlug();
  const outDir = path.join(RENDERS_DIR, `h9-music-${slug}`);
  fs.mkdirSync(outDir, { recursive: true });

  const clipDurationSec = 12;
  const clip = {
    clipMusicMood: "spiritual",
    musicProviderPreference: "fal",
  };
  const compiledMusicPlan = {
    enabled: true,
    mood: "spiritual",
    intensityLevel: "medium",
  };

  const strategy = buildMusicExecutionStrategy({
    clip,
    compiledMusicPlan,
    clipDurationSec,
    compiledAudioDesignBundle: {},
  });

  const comparison = {
    scenario: "H9-C music providers",
    sharedStrategySummary: {
      promptText: strategy.promptText?.slice(0, 400),
      providerChoice: strategy.providerChoice,
      fallbackChain: strategy.fallbackChain,
    },
    runs: [],
  };

  const falPlan = buildMusicRenderPlan(strategy, { activeProvider: "fal", clipDurationSec });
  const elPlan = buildMusicRenderPlan(strategy, { activeProvider: "elevenlabs", clipDurationSec });

  const runFal = baseReportFields("music_fal_stable_audio");
  runFal.provider = "fal";
  runFal.modelOrMode = falPlan.chosenModel;
  runFal.payloadIntent = falPlan.requestPayloadIntent;
  runFal.payloadActuallySent = falPlan.requestPayloadActuallySent;
  const t0f = Date.now();
  try {
    logAxstudio("music", "FAL Stable Audio…");
    const r = await generateMusicWithFal(falPlan, {});
    runFal.latencyMs = Date.now() - t0f;
    if (r.ok && r.audioUrl) {
      const wavPath = path.join(outDir, "music_fal.wav");
      await downloadToFile(r.audioUrl, wavPath);
      runFal.success = true;
      runFal.outputFiles = [wavPath];
      runFal.outputDurationSec = ffprobeDurationSec(wavPath);
      runFal.technicalNotes.push("URL da coda FAL; file scaricato locale per confronto.");
    } else {
      runFal.errors.push(r.error || "FAL fail");
      runFal.fallbackUsed.push(...(strategy.fallbackChain || []).filter(Boolean));
    }
  } catch (e) {
    runFal.errors.push(e?.message || String(e));
    runFal.latencyMs = Date.now() - t0f;
  }
  comparison.runs.push(runFal);

  const runEl = baseReportFields("music_elevenlabs_compose");
  runEl.provider = "elevenlabs";
  runEl.modelOrMode = elPlan.chosenModel;
  runEl.payloadIntent = elPlan.requestPayloadIntent;
  runEl.payloadActuallySent = elPlan.requestPayloadActuallySent;
  const t0e = Date.now();
  try {
    logAxstudio("music", "ElevenLabs /v1/music…");
    const r = await generateMusicWithEleven(elPlan);
    runEl.latencyMs = Date.now() - t0e;
    if (r.ok && r.audioBlob) {
      const mp3Path = path.join(outDir, "music_elevenlabs.mp3");
      const buf = Buffer.from(await r.audioBlob.arrayBuffer());
      fs.writeFileSync(mp3Path, buf);
      runEl.success = true;
      runEl.outputFiles = [mp3Path];
      runEl.outputDurationSec = ffprobeDurationSec(mp3Path);
      runEl.technicalNotes.push("MP3 44100/128 come richiesto dall'adapter.");
    } else {
      runEl.errors.push(r.error || "Eleven music fail");
      runEl.rawStatus = r.rawStatus;
    }
  } catch (e) {
    runEl.errors.push(e?.message || String(e));
    runEl.latencyMs = Date.now() - t0e;
  }
  comparison.runs.push(runEl);

  for (const r of comparison.runs) {
    r.limitationsObserved = [
      ...(strategy.limitations || []),
      "Giudizio qualitativo solo manuale; nessun score oggettivo generato da questo harness.",
    ];
    if (r.success) {
      r.practicalRecommendation =
        r.provider === "fal"
          ? "Default AXSTUDIO: FAL per bed strumentale con controllo seconds_total."
          : "ElevenLabs music utile quando FAL non disponibile o per preferenza di timbro.";
    }
  }

  const reportPath = path.join(REPORTS_DIR, `h9-provider-comparison-music-${slug}.json`);
  writeJson(reportPath, comparison);

  let md = `# AXSTUDIO H9 — Music provider comparison\n\n`;
  md += `JSON: \`${path.relative(process.cwd(), reportPath)}\`\n\n`;
  for (const r of comparison.runs) {
    md += `## ${r.scenario}\n- Provider: ${r.provider}\n- Esito: ${r.success ? "ok" : "fail"}\n`;
    md += `- Latenza: ${r.latencyMs != null ? r.latencyMs + " ms" : "n/a"}\n\n`;
  }
  fs.writeFileSync(path.join(REPORTS_DIR, `h9-provider-comparison-music-${slug}.md`), md, "utf8");
  logAxstudio("report", "music comparison", reportPath);

  return comparison;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runAxstudioTestMusicProviders().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
