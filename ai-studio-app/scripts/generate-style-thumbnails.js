#!/usr/bin/env node
/**
 * generate-style-thumbnails.js
 *
 * Genera le thumbnail degli stili AXSTUDIO usando fal.ai FLUX Pro Ultra.
 * Legge i prompt da THUMBNAIL_MANIFEST.json e salva i JPEG risultanti in:
 *   public/UI/style-thumbnails/image/
 *   public/UI/style-thumbnails/video/
 *   public/UI/style-thumbnails/video-direction/
 *
 * Usage:
 *   FAL_API_KEY=<tua_chiave> node scripts/generate-style-thumbnails.js
 *   FAL_API_KEY=<tua_chiave> node scripts/generate-style-thumbnails.js --type image
 *   FAL_API_KEY=<tua_chiave> node scripts/generate-style-thumbnails.js --type video
 *   FAL_API_KEY=<tua_chiave> node scripts/generate-style-thumbnails.js --type video-direction
 *   FAL_API_KEY=<tua_chiave> node scripts/generate-style-thumbnails.js --only noir,cyberpunk
 */

const https  = require("https");
const http   = require("http");
const fs     = require("fs");
const path   = require("path");
const url    = require("url");

// ── Config ──────────────────────────────────────────────────────────────────
const FAL_API_KEY = process.env.FAL_API_KEY || "";
const FAL_ENDPOINT = "fal.run";
const MODEL = "fal-ai/flux-pro/v1.1-ultra";

const MANIFEST_PATH = path.join(__dirname, "../public/UI/style-thumbnails/THUMBNAIL_MANIFEST.json");
const OUT_IMAGE = path.join(__dirname, "../public/UI/style-thumbnails/image");
const OUT_VIDEO = path.join(__dirname, "../public/UI/style-thumbnails/video");
const OUT_VIDEO_DIR = path.join(__dirname, "../public/UI/style-thumbnails/video-direction");

// Delay tra una richiesta e l'altra per non saturare i rate limit
const DELAY_MS = 2500;

// ── CLI args ─────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const typeArg  = args.includes("--type")  ? args[args.indexOf("--type") + 1]  : "both";
const onlyArg  = args.includes("--only")  ? args[args.indexOf("--only") + 1].split(",") : null;
const forceArg = args.includes("--force");

// ── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJson(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: FAL_ENDPOINT,
      path: `/${MODEL}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Authorization": `Key ${FAL_API_KEY}`,
      },
    };
    const req = https.request(options, res => {
      let raw = "";
      res.on("data", d => raw += d);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { reject(new Error(`Bad JSON: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function downloadFile(fileUrl, destPath) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(fileUrl);
    const transport = parsed.protocol === "https:" ? https : http;
    const file = fs.createWriteStream(destPath);
    transport.get(fileUrl, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", e => { fs.unlinkSync(destPath); reject(e); });
  });
}

async function generateThumbnail(entry, outDir) {
  const destPath = path.join(outDir, entry.file);

  if (!forceArg && fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    if (stat.size > 10000) {
      console.log(`  SKIP  ${entry.file} (già presente, ${Math.round(stat.size/1024)}KB)`);
      return;
    }
  }

  console.log(`  GEN   ${entry.file}`);
  console.log(`         prompt: ${entry.prompt.slice(0, 80)}...`);

  const payload = {
    prompt: entry.prompt,
    aspect_ratio: "1:1",
    num_images: 1,
    enable_safety_checker: false,
    safety_tolerance: "6",
  };
  if (entry.negative_prompt) {
    payload.negative_prompt = entry.negative_prompt;
  }

  let attempt = 0;
  while (attempt < 3) {
    attempt++;
    try {
      const { status, data } = await fetchJson(FAL_ENDPOINT, payload);
      if (status !== 200) {
        console.warn(`  WARN  HTTP ${status}: ${JSON.stringify(data).slice(0, 120)}`);
        if (attempt < 3) { await sleep(DELAY_MS * 2); continue; }
        return;
      }
      const imgUrl = data?.images?.[0]?.url || data?.image?.url;
      if (!imgUrl) {
        console.warn(`  WARN  Nessun URL nella risposta per ${entry.file}`);
        return;
      }
      await downloadFile(imgUrl, destPath);
      const kb = Math.round(fs.statSync(destPath).size / 1024);
      console.log(`  OK    ${entry.file} salvato (${kb}KB)`);
      return;
    } catch (e) {
      console.warn(`  ERR   attempt ${attempt}: ${e.message}`);
      if (attempt < 3) await sleep(DELAY_MS * 2);
    }
  }
  console.error(`  FAIL  ${entry.file} dopo 3 tentativi`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!FAL_API_KEY) {
    console.error("Errore: variabile FAL_API_KEY non impostata.");
    console.error("Usa: FAL_API_KEY=<chiave> node scripts/generate-style-thumbnails.js");
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  fs.mkdirSync(OUT_IMAGE, { recursive: true });
  fs.mkdirSync(OUT_VIDEO,  { recursive: true });
  fs.mkdirSync(OUT_VIDEO_DIR, { recursive: true });

  const runSet = async (entries, outDir, label) => {
    if (!entries?.length) return;
    const filtered = onlyArg
      ? entries.filter(e => onlyArg.some(k => e.file.startsWith(k)))
      : entries;
    console.log(`\n── ${label} (${filtered.length} stili) ──`);
    for (const entry of filtered) {
      await generateThumbnail(entry, outDir);
      await sleep(DELAY_MS);
    }
  };

  const runAll = typeArg === "both";
  if (typeArg === "image" || runAll) {
    await runSet(manifest.image, OUT_IMAGE, "IMAGE thumbnails");
  }
  if (typeArg === "video" || runAll) {
    await runSet(manifest.video, OUT_VIDEO, "VIDEO thumbnails");
  }
  if (typeArg === "video-direction" || runAll) {
    await runSet(manifest["video-direction"], OUT_VIDEO_DIR, "VIDEO-DIRECTION thumbnails");
  }

  console.log("\nCompletato.");
}

main().catch(e => { console.error(e); process.exit(1); });
