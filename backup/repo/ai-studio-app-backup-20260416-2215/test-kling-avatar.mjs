import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { fal } from "@fal-ai/client";

const CONNECTORS_FILE = "/Users/r.amoroso/Documents/AI_IMAGE&VIDEO/connettori.txt";
const SCENE_FILE = "/Users/r.amoroso/Documents/AI-Studio-Data/images/img_1776285982224.png";
const TEXT = "Giuseppe è pensieroso, ma nel suo cuore sta tornando la pace.";
const MAC_VOICE = "Alice";

if (!fs.existsSync(CONNECTORS_FILE)) {
  throw new Error(`File non trovato: ${CONNECTORS_FILE}`);
}

if (!fs.existsSync(SCENE_FILE)) {
  throw new Error(`File scena non trovato: ${SCENE_FILE}`);
}

const connectors = fs.readFileSync(CONNECTORS_FILE, "utf8");
const falKeyMatch = connectors.match(/^FAL_KEY=(.+)$/m);

if (!falKeyMatch) {
  throw new Error("FAL_KEY non trovata in connettori.txt");
}

fal.config({
  credentials: falKeyMatch[1].trim()
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kling-test-"));
const aiffPath = path.join(tmpDir, "speech.aiff");
const m4aPath = path.join(tmpDir, "speech.m4a");

console.log("[1/5] Upload scena su fal CDN...");
const imageBuffer = fs.readFileSync(SCENE_FILE);
const imageFile = new File([imageBuffer], "scene.png", { type: "image/png" });
const sceneUrl = await fal.storage.upload(imageFile);
console.log("SCENE_URL:", sceneUrl);

console.log("[2/5] Genero audio locale con macOS say...");
execSync(`say -v "${MAC_VOICE}" -o "${aiffPath}" "${TEXT.replace(/"/g, '\\"')}"`, {
  stdio: "inherit"
});

console.log("[3/5] Converto audio in m4a...");
execSync(`afconvert "${aiffPath}" -f m4af -d aac "${m4aPath}"`, {
  stdio: "inherit"
});

console.log("[4/5] Upload audio su fal CDN...");
const audioBuffer = fs.readFileSync(m4aPath);
const audioFile = new File([audioBuffer], "speech.m4a", { type: "audio/mp4" });
const audioUrl = await fal.storage.upload(audioFile);
console.log("AUDIO_URL:", audioUrl);

console.log("[5/5] Chiamo Kling Avatar v2 Standard...");
const result = await fal.subscribe("fal-ai/kling-video/ai-avatar/v2/standard", {
  input: {
    image_url: sceneUrl,
    audio_url: audioUrl
  },
  logs: true
});

console.log(JSON.stringify(result, null, 2));
