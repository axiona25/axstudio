/**
 * AXSTUDIO H9 — Test voce ElevenLabs (preset + clone opzionale).
 * Uso: da ai-studio-app → node scripts/test-eleven-voice.mjs
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
  elevenLabsTtsToFile,
  resolvePresetVoiceId,
  ffprobeDurationSec,
  baseReportFields,
  RENDERS_DIR,
  REPORTS_DIR,
} from "./axstudio-h9-lib.mjs";

const NARRATOR_TEXT =
  "Questo è un test di narrazione AXSTUDIO H9. Obiettivo: verificare il path TTS reale e persistere metadati onesti.";

export async function runAxstudioTestElevenVoice() {
  loadAxstudioEnv();
  ensureDirs();
  const slug = timestampSlug();
  const outDir = path.join(RENDERS_DIR, `h9-voice-${slug}`);
  fs.mkdirSync(outDir, { recursive: true });

  const comparison = {
    scenario: "H9-A voice / narrator",
    providerNote:
      "AXSTUDIO usa ElevenLabs per TTS scenografie; non c'è confronto cross-provider voce nel codice attuale. Il report confronta preset / voice ID diversi.",
    runs: [],
  };

  const presetNeutral = resolvePresetVoiceId("neutral");
  const presetWarm = resolvePresetVoiceId("warm");
  const clonedId = String(process.env.REACT_APP_AXSTUDIO_H9_CLONED_VOICE_ID || "").trim();

  const attempts = [
    { label: "preset_neutral", voiceId: presetNeutral.voiceId, envKey: presetNeutral.source },
    { label: "preset_warm", voiceId: presetWarm.voiceId, envKey: presetWarm.source },
  ];
  if (clonedId) attempts.push({ label: "cloned_env", voiceId: clonedId, envKey: "REACT_APP_AXSTUDIO_H9_CLONED_VOICE_ID" });

  for (const a of attempts) {
    const row = baseReportFields(`voice_${a.label}`);
    row.provider = "elevenlabs";
    row.modelOrMode = "eleven_multilingual_v2";
    row.payloadIntent = { text: NARRATOR_TEXT, voiceSource: a.envKey };
    if (!a.voiceId) {
      row.errors.push(`Voice ID assente (${a.envKey || a.label})`);
      row.limitationsObserved.push("Configurare la variabile .env indicata per questo slot.");
      comparison.runs.push(row);
      logAxstudio("voice", `skip ${a.label}`, row.errors[0]);
      continue;
    }
    const mp3 = path.join(outDir, `narrator-${a.label}.mp3`);
    const metaPath = path.join(outDir, `narrator-${a.label}.meta.json`);
    try {
      logAxstudio("voice", `TTS ${a.label}`, a.voiceId);
      const { latencyMs, requestBody } = await elevenLabsTtsToFile(a.voiceId, NARRATOR_TEXT, mp3, {});
      row.payloadActuallySent = { endpoint: "POST /v1/text-to-speech/:voice_id", body: requestBody, voiceId: a.voiceId };
      row.latencyMs = latencyMs;
      row.outputFiles = [mp3, metaPath];
      row.outputDurationSec = ffprobeDurationSec(mp3);
      row.success = true;
      row.technicalNotes.push("Durata via ffprobe se disponibile; nessun MOS né LUFS misurato.");
      row.practicalRecommendation =
        a.label.startsWith("preset")
          ? "Usare preset mappati su .env per coerenza con la UI Scenografie."
          : "Voce clone: verificare diritti e stabilità timbrica su testi lunghi.";
      const meta = {
        label: a.label,
        voiceId: a.voiceId,
        voiceEnvKey: a.envKey,
        latencyMs,
        durationSec: row.outputDurationSec,
        modelId: requestBody.model_id,
        text: NARRATOR_TEXT,
      };
      writeJson(metaPath, meta);
    } catch (e) {
      row.errors.push(e?.message || String(e));
      logAxstudio("voice", `fail ${a.label}`, row.errors[0]);
    }
    comparison.runs.push(row);
  }

  const reportPath = path.join(REPORTS_DIR, `h9-provider-comparison-voice-${slug}.json`);
  writeJson(reportPath, comparison);

  let md = `# AXSTUDIO H9 — Voice comparison\n\n`;
  md += `- Timestamp: ${slug}\n- JSON: \`${path.relative(process.cwd(), reportPath)}\`\n\n`;
  for (const r of comparison.runs) {
    md += `## ${r.scenario}\n`;
    md += `- Esito: ${r.success ? "ok" : "fail"}\n`;
    md += `- Latenza: ${r.latencyMs != null ? `${r.latencyMs} ms` : "n/a"}\n`;
    md += `- Durata output: ${r.outputDurationSec != null ? `${r.outputDurationSec} s` : "n/a"}\n`;
    if (r.errors?.length) md += `- Errori: ${r.errors.join("; ")}\n`;
    md += `\n`;
  }
  fs.writeFileSync(path.join(REPORTS_DIR, `h9-provider-comparison-voice-${slug}.md`), md, "utf8");
  logAxstudio("report", "voice comparison", reportPath);

  return comparison;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runAxstudioTestElevenVoice().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
