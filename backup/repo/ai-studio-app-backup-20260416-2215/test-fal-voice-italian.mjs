import fs from "fs";
import { fal } from "@fal-ai/client";

const CONNECTORS_FILE = "/Users/r.amoroso/Documents/AI_IMAGE&VIDEO/connettori.txt";
const OUTPUT_FILE = "/Users/r.amoroso/Documents/AI-Studio-Data/test-fal-voice-italian.json";

const TEXT = "Giuseppe è pensieroso, ma nel suo cuore sta tornando la pace. In questa notte speciale, Dio lo rassicura e lo guida con amore.";

if (!fs.existsSync(CONNECTORS_FILE)) {
  throw new Error(`File non trovato: ${CONNECTORS_FILE}`);
}

const connectors = fs.readFileSync(CONNECTORS_FILE, "utf8");
const falKeyMatch = connectors.match(/^FAL_KEY=(.+)$/m);

if (!falKeyMatch) {
  throw new Error("FAL_KEY non trovata in connettori.txt");
}

fal.config({
  credentials: falKeyMatch[1].trim()
});

async function runVoice(voice) {
  console.log(`\n=== TEST VOCE: ${voice} ===`);
  const result = await fal.subscribe("fal-ai/kokoro/italian", {
    input: {
      prompt: TEXT,
      voice,
      speed: 1
    },
    logs: true
  });
  return {
    voice,
    result
  };
}

const sara = await runVoice("if_sara");
const nicola = await runVoice("im_nicola");

const finalResult = {
  sara,
  nicola
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalResult, null, 2), "utf8");

console.log("\n=== RISULTATO COMPLETO ===");
console.log(JSON.stringify(finalResult, null, 2));
console.log(`\nJSON salvato in: ${OUTPUT_FILE}`);
