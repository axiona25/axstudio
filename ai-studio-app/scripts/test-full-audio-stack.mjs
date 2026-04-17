/**
 * AXSTUDIO H9 — Esegue tutti i test audio e produce summary finale (controverifica).
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
  REPORTS_DIR,
} from "./axstudio-h9-lib.mjs";
import { runAxstudioTestElevenVoice } from "./test-eleven-voice.mjs";
import { runAxstudioTestDialogueMultivoice } from "./test-dialogue-multivoice.mjs";
import { runAxstudioTestMusicProviders } from "./test-music-providers.mjs";
import { runAxstudioTestSfxAmbient } from "./test-sfx-ambient.mjs";
import { runAxstudioTestAudioMix } from "./test-audio-mix.mjs";

function okRunsVoice(c) {
  return (c.runs || []).filter((r) => r.success).length;
}

function recommendProviders(full) {
  const rec = {
    voice: "ElevenLabs è l’unico provider TTS nel path Scenografie; confrontare solo voice ID / preset.",
    music:
      "Default codice: FAL Stable Audio quando REACT_APP_FAL_API_KEY è disponibile; ElevenLabs /v1/music come alternativa configurabile o fallback a catena H6.",
    ambientSfx:
      "Oggi: solo sintesi procedural MVP in audioRenderEngine; nessun provider cloud per ambient/SFX finché non integrato.",
    mix: "Motore H7 (professionalAudioMixEngine) in-browser/Node con shim AudioContext; richiede ffmpeg nel CLI per allineare MP3/WAV.",
  };
  const music = full.music;
  if (music?.runs) {
    const falOk = music.runs.find((r) => r.scenario === "music_fal_stable_audio")?.success;
    const elOk = music.runs.find((r) => r.scenario === "music_elevenlabs_compose")?.success;
    if (falOk && !elOk) rec.music = "Misurazione: FAL ok, ElevenLabs fallito o assente — preferire FAL per AXSTUDIO fino a nuova prova.";
    if (!falOk && elOk) rec.music = "Misurazione: ElevenLabs ok, FAL fallito o assente — usare ElevenLabs music o ripristinare chiave FAL.";
    if (falOk && elOk) rec.music = "Entrambi ok: default prodotto resta FAL; ElevenLabs utile per ridondanza o preferenza creativa (confronto manuale sui file).";
    if (!falOk && !elOk) rec.music = "Entrambi falliti in questo run: verificare chiavi, quota, rete; resta solo synth MVP.";
  }
  return rec;
}

export async function runAxstudioTestFullAudioStack() {
  loadAxstudioEnv();
  ensureDirs();
  const slug = timestampSlug();
  logAxstudio("full", `run H9 stack ${slug}`);

  const full = {
    slug,
    startedAt: new Date().toISOString(),
    voice: null,
    dialogue: null,
    music: null,
    sfxAmbient: null,
    mix: null,
    errors: [],
  };

  try {
    full.voice = await runAxstudioTestElevenVoice();
  } catch (e) {
    full.errors.push({ step: "voice", message: e?.message || String(e) });
  }
  try {
    full.dialogue = await runAxstudioTestDialogueMultivoice();
  } catch (e) {
    full.errors.push({ step: "dialogue", message: e?.message || String(e) });
  }
  try {
    full.music = await runAxstudioTestMusicProviders();
  } catch (e) {
    full.errors.push({ step: "music", message: e?.message || String(e) });
  }
  try {
    full.sfxAmbient = await runAxstudioTestSfxAmbient();
  } catch (e) {
    full.errors.push({ step: "sfx", message: e?.message || String(e) });
  }
  try {
    full.mix = await runAxstudioTestAudioMix();
  } catch (e) {
    full.errors.push({ step: "mix", message: e?.message || String(e) });
  }

  const summary = {
    slug,
    completedAt: new Date().toISOString(),
    voiceRunsSucceeded: full.voice ? okRunsVoice(full.voice) : 0,
    dialogueOk: !!full.dialogue?.success,
    musicRuns: full.music?.runs?.map((r) => ({ scenario: r.scenario, success: r.success, latencyMs: r.latencyMs })) || [],
    sfxAmbientOk: !!full.sfxAmbient?.success,
    mixScenarios: full.mix?.scenarios?.map((s) => ({ scenario: s.scenario, success: s.success })) || [],
    harnessErrors: full.errors,
    providerRecommendations: recommendProviders(full),
    limitationsHarness: [
      "Nessun punteggio di qualità percepita automatico.",
      "Dialogo concat dipende da ffmpeg; mix dipende da ffmpeg+ffprobe.",
      "Import src/.js in Node può emettere warning MODULE_TYPELESS_PACKAGE_JSON — innocuo per questi test.",
    ],
  };

  const out = path.join(REPORTS_DIR, `h9-full-stack-summary-${slug}.json`);
  writeJson(out, { full, summary });

  let md = `# AXSTUDIO H9 — Full stack summary\n\n`;
  md += `- JSON: \`${path.relative(process.cwd(), out)}\`\n\n`;
  md += `## Raccomandazioni (euristiche su questo run)\n\n`;
  for (const [k, v] of Object.entries(summary.providerRecommendations || {})) {
    md += `- **${k}**: ${v}\n`;
  }
  md += `\n## Esiti rapidi\n\n`;
  md += `- Voce (run ok): ${summary.voiceRunsSucceeded}\n`;
  md += `- Dialogo: ${summary.dialogueOk ? "ok" : "fail/partial"}\n`;
  md += `- SFX/Ambient: ${summary.sfxAmbientOk ? "ok" : "fail"}\n`;
  fs.writeFileSync(path.join(REPORTS_DIR, `h9-full-stack-summary-${slug}.md`), md, "utf8");
  logAxstudio("report", "full stack summary", out);
  logAxstudio("full", "done");
  return { full, summary };
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runAxstudioTestFullAudioStack().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
