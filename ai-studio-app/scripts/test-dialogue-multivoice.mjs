/**
 * AXSTUDIO H9 — Dialogo multi-speaker (ElevenLabs per battuta, concat ffmpeg).
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
  hasFfmpeg,
  runFfmpeg,
  RENDERS_DIR,
  REPORTS_DIR,
} from "./axstudio-h9-lib.mjs";

const LINES = [
  { speaker: "ELENA", preset: "female_young", text: "Marco, hai sentito? La festa è stasera." },
  { speaker: "MARCO", preset: "male_mature", text: "Sì, ma dobbiamo ancora sistemare il materiale audio." },
  { speaker: "ELENA", preset: "female_young", text: "AXSTUDIO può generare le battute una per una." },
  { speaker: "MARCO", preset: "male_mature", text: "Perfetto. Concateniamo e verifichiamo i tempi." },
];

export async function runAxstudioTestDialogueMultivoice() {
  loadAxstudioEnv();
  ensureDirs();
  const slug = timestampSlug();
  const outDir = path.join(RENDERS_DIR, `h9-dialogue-${slug}`);
  fs.mkdirSync(outDir, { recursive: true });

  const report = baseReportFields("H9-B dialogue multi-speaker");
  report.provider = "elevenlabs";
  report.modelOrMode = "eleven_multilingual_v2 per linea";
  report.payloadIntent = { lines: LINES.map((l) => ({ speaker: l.speaker, text: l.text })) };
  report.fallbackUsed = [];
  report.technicalNotes.push(
    "Concat: ffmpeg re-encode (libmp3lame) se disponibile; altrimenti solo file per-linea.",
  );
  report.limitationsObserved.push(
    "Niente AudioContext in Node: pause tra battute come nel dialogueExecutionEngine browser non replicate qui senza ffmpeg filter.",
  );

  const speakerVoiceMap = {};
  const lineResults = [];
  let totalLatency = 0;

  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i];
    const { voiceId, source } = resolvePresetVoiceId(line.preset);
    speakerVoiceMap[line.speaker] = { preset: line.preset, voiceId: voiceId || null, envKey: source };
    const file = path.join(outDir, `line-${i + 1}-${line.speaker.toLowerCase()}.mp3`);
    if (!voiceId) {
      lineResults.push({ index: i, speaker: line.speaker, error: `Manca voice ID per preset ${line.preset} (${source})` });
      report.errors.push(lineResults[lineResults.length - 1].error);
      continue;
    }
    try {
      const t0 = Date.now();
      const r = await elevenLabsTtsToFile(voiceId, line.text, file, {});
      totalLatency += r.latencyMs;
      const dur = ffprobeDurationSec(file);
      lineResults.push({
        index: i,
        speaker: line.speaker,
        voiceId,
        file,
        latencyMs: r.latencyMs,
        durationSec: dur,
      });
      logAxstudio("dialogue", `line ${i + 1} ok`, line.speaker);
    } catch (e) {
      const msg = e?.message || String(e);
      lineResults.push({ index: i, speaker: line.speaker, error: msg });
      report.errors.push(msg);
      logAxstudio("dialogue", `line ${i + 1} fail`, msg);
    }
  }

  report.payloadActuallySent = { speakerVoiceMap, lineResults };

  const concatOut = path.join(outDir, "dialogue_concat.mp3");
  const okLines = lineResults.filter((x) => x.file);
  let concatOk = false;
  if (okLines.length === LINES.length && hasFfmpeg()) {
    const listPath = path.join(outDir, "concat_list.txt");
    const listBody = okLines.map((x) => `file '${path.basename(x.file)}'`).join("\n");
    fs.writeFileSync(listPath, listBody, "utf8");
    const ff = runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "4",
      concatOut,
    ], { cwd: outDir });
    if (ff.status === 0) {
      concatOk = true;
      report.outputFiles.push(concatOut);
      report.outputDurationSec = ffprobeDurationSec(concatOut);
    } else {
      report.fallbackUsed.push("ffmpeg_concat_failed_keep_stems_only");
      report.errors.push(ff.stderr || "ffmpeg concat failed");
    }
  } else {
    report.fallbackUsed.push("ffmpeg_missing_or_partial_lines");
    if (!hasFfmpeg()) report.errors.push("ffmpeg non disponibile: nessun concat unico.");
  }

  report.latencyMs = totalLatency;
  report.outputFiles = [...report.outputFiles, ...okLines.map((x) => x.file)];
  report.success = okLines.length === LINES.length && concatOk;
  writeJson(path.join(outDir, "dialogue_timing.json"), {
    speakerVoiceMap,
    lineResults,
    totalLatencyMs: totalLatency,
  });

  const summaryPath = path.join(REPORTS_DIR, `h9-dialogue-multivoice-${slug}.json`);
  writeJson(summaryPath, { ...report, speakerVoiceMap, lineResults });
  logAxstudio("report", "dialogue summary", summaryPath);

  return report;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runAxstudioTestDialogueMultivoice().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
