const { app, BrowserWindow, ipcMain, shell, protocol, net, dialog, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { pathToFileURL } = require("url");
const { execFile } = require("child_process");

console.log("[AI Studio main] entry file:", __filename);

/** Permette a net.fetch nel protocol handler di servire file locali (Electron 30+). */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "axstudio-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ── Data directory ──
const DATA_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  "Documents",
  "AI-Studio-Data"
);
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};
ensureDir(DATA_DIR);
ensureDir(path.join(DATA_DIR, "images"));
ensureDir(path.join(DATA_DIR, "videos"));
ensureDir(path.join(DATA_DIR, "projects"));
ensureDir(path.join(DATA_DIR, "characters"));
ensureDir(path.join(DATA_DIR, "voices"));

function isPathUnderDir(filePath, rootDir) {
  const f = path.resolve(filePath);
  const r = path.resolve(rootDir);
  if (f === r) return true;
  return f.startsWith(r + path.sep);
}

/** Estrae la riga `KEY: …` sotto la sezione `OPENAI` in Connettori.txt */
function parseOpenAiKeyFromConnettori(raw) {
  const lines = raw.split(/\r?\n/);
  let inOpenAi = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^OPENAI\b/i.test(t)) {
      inOpenAi = true;
      continue;
    }
    if (inOpenAi) {
      const m = line.match(/KEY:\s*(.+)/i);
      if (m) return m[1].trim();
      if (t && /^[A-Z][A-Za-z0-9\s]{2,}$/.test(t) && !/KEY/i.test(t) && !t.includes(":")) {
        inOpenAi = false;
      }
    }
  }
  const fm = raw.match(/OPENAI[\s\S]{0,400}?KEY:\s*([^\s\r\n]+)/i);
  return fm ? fm[1].trim() : null;
}

function connettoriCandidatePaths() {
  const fileNames = ["Connettori.txt", "connettori.txt"];
  const dirs = new Set();
  if (process.env.CONNETTORI_DIR) dirs.add(path.resolve(process.env.CONNETTORI_DIR));
  dirs.add(path.join(__dirname, "..", ".."));
  dirs.add(path.join(__dirname, ".."));
  dirs.add(process.cwd());
  const out = [];
  for (const d of dirs) {
    for (const n of fileNames) out.push(path.join(d, n));
  }
  return out;
}

function readOpenAiKeyFromConnettoriFile() {
  for (const p of connettoriCandidatePaths()) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const key = parseOpenAiKeyFromConnettori(raw);
      if (key) return key;
    } catch (e) {
      console.error("Lettura Connettori:", p, e.message);
    }
  }
  return null;
}

// ── RunPod config (used only for balance) ──
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || "";

// ── Native HTTPS fetch helper (no CORS in Node!) ──
function fetchGraphQL(query) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
    const options = {
      hostname: "api.runpod.io",
      path: "/graphql",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
        "Content-Length": Buffer.byteLength(postData),
      },
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

// ══════════════════════════════════════════
// IPC Handlers — exposed to renderer via preload
// ══════════════════════════════════════════

// ── Balance (native, no proxy needed) ──
ipcMain.handle("get-balance", async () => {
  try {
    const data = await fetchGraphQL("{ myself { clientBalance } }");
    return data?.data?.myself?.clientBalance ?? null;
  } catch (e) {
    console.error("Balance fetch error:", e.message);
    return null;
  }
});

// ── File System: save binary file (image/video) ──
ipcMain.handle("save-file", async (_event, { fileName, base64Data, subDir }) => {
  try {
    const dir = path.join(DATA_DIR, subDir || "");
    ensureDir(dir);
    const filePath = path.join(dir, fileName);
    const buffer = Buffer.from(base64Data, "base64");
    fs.writeFileSync(filePath, buffer);
    return { success: true, path: filePath };
  } catch (e) {
    console.error("save-file error:", e);
    return { success: false, error: e.message };
  }
});

// ── File System: load binary file → base64 ──
ipcMain.handle("load-file", async (_event, { filePath }) => {
  try {
    if (!fs.existsSync(filePath)) return { success: false, error: "File not found" };
    const buffer = fs.readFileSync(filePath);
    return { success: true, data: buffer.toString("base64") };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── JSON storage ──
ipcMain.handle("save-json", async (_event, { fileName, data }) => {
  try {
    const filePath = path.join(DATA_DIR, fileName);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("load-json", async (_event, { fileName }) => {
  try {
    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) return { success: true, data: null };
    const raw = fs.readFileSync(filePath, "utf-8");
    return { success: true, data: JSON.parse(raw) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── List files in a subdirectory ──
ipcMain.handle("list-files", async (_event, { subDir }) => {
  try {
    const dir = path.join(DATA_DIR, subDir || "");
    if (!fs.existsSync(dir)) return { success: true, files: [] };
    const files = fs.readdirSync(dir).map((name) => ({
      name,
      path: path.join(dir, name),
      stat: fs.statSync(path.join(dir, name)),
    }));
    return { success: true, files };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Delete file ──
ipcMain.handle("delete-file", async (_event, { filePath }) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Copia file dati app verso percorso scelto dall’utente (Scarica / Esporta) ──
ipcMain.handle("export-file-copy", async (event, { sourcePath, defaultFileName }) => {
  try {
    const normalized = path.normalize(sourcePath);
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
      return { success: false, error: "File non trovato" };
    }
    if (!isPathUnderDir(normalized, DATA_DIR)) {
      return { success: false, error: "Percorso non consentito" };
    }
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const baseName = defaultFileName || path.basename(normalized);
    const { canceled, filePath: dest } = await dialog.showSaveDialog(win, {
      title: "Salva con nome",
      defaultPath: baseName,
      buttonLabel: "Salva",
    });
    if (canceled || !dest) return { success: false, canceled: true };
    await fs.promises.copyFile(normalized, dest);
    return { success: true, filePath: dest };
  } catch (e) {
    console.error("export-file-copy:", e);
    return { success: false, error: e.message || String(e) };
  }
});

// ── Open file in system viewer ──
ipcMain.handle("open-in-system", async (_event, { filePath }) => {
  shell.openPath(filePath);
  return { success: true };
});

// ── Get data directory path ──
ipcMain.handle("get-data-dir", async () => DATA_DIR);

// ── Check if a file exists on disk ──
ipcMain.handle("file-exists", async (_event, filePath) => {
  try { await fs.promises.access(filePath); return true; } catch { return false; }
});

// ── Trim video with ffmpeg ──
ipcMain.handle("trim-video", async (_event, inputPath, outputPath, trimSeconds) => {
  return new Promise((resolve) => {
    execFile("ffmpeg", [
      "-y", "-i", inputPath,
      "-ss", String(trimSeconds || 1.0),
      "-c:v", "libx264", "-crf", "18", "-preset", "fast",
      "-c:a", "aac", "-b:a", "192k",
      outputPath,
    ], { timeout: 60000 }, (error) => {
      if (error) {
        console.error("[FFMPEG TRIM] Error:", error.message);
        resolve({ success: false, error: error.message });
      } else {
        console.log("[FFMPEG TRIM] OK:", outputPath);
        resolve({ success: true, outputPath });
      }
    });
  });
});

// ── Rename / move file ──
ipcMain.handle("rename-file", async (_event, oldPath, newPath) => {
  try {
    await fs.promises.rename(oldPath, newPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Mix audio + video con ffmpeg (voce ElevenLabs sopra video Kling) ──
ipcMain.handle("mix-audio-video", async (_event, videoPath, audioPath, outputPath) => {
  return new Promise((resolve) => {
    // Controlla se il video ha già una traccia audio
    execFile("ffprobe", [
      "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type",
      "-of", "csv=p=0", videoPath,
    ], { timeout: 10000 }, (probeErr, stdout) => {
      const hasExistingAudio = !probeErr && stdout.trim().length > 0;

      const args = hasExistingAudio
        ? ["-y", "-i", videoPath, "-i", audioPath,
           "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first[a]",
           "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
           outputPath]
        : ["-y", "-i", videoPath, "-i", audioPath,
           "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
           "-shortest", outputPath];

      execFile("ffmpeg", args, { timeout: 120000 }, (err) => {
        if (err) {
          console.error("[FFMPEG MIX]", err.message);
          resolve({ success: false, error: err.message });
        } else {
          console.log("[FFMPEG MIX] OK:", outputPath);
          resolve({ success: true, outputPath });
        }
      });
    });
  });
});

// ── OpenAI key from Connettori.txt (workspace / env CONNETTORI_DIR) ──
ipcMain.handle("get-openai-key", async () => {
  const key = readOpenAiKeyFromConnettoriFile();
  return { key: key || "" };
});

// ══════════════════════════════════════════
// Window
// ══════════════════════════════════════════
console.log("[AI Studio main] IPC handlers registered (export-file-copy included).");
let mainWindow;

/** Finestra proporzionata all’area lavoro: abbastanza alta da mostrare Home/progetti senza scroll sulla colonna centrale (solo sidebar destra / griglie interne scrollano). */
function getDefaultWindowSize() {
  try {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const margin = 24;
    const w = Math.min(1480, Math.max(1120, sw - margin * 2));
    const h = Math.min(920, Math.max(760, sh - margin * 2));
    return { width: w, height: h };
  } catch {
    return { width: 1360, height: 880 };
  }
}

function createWindow() {
  const { width, height } = getDefaultWindowSize();
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 1024,
    minHeight: 700,
    title: "AI Studio",
    backgroundColor: "#0a0a0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      // Anteprime disco via protocollo `axstudio-local` (non più file:// da localhost).
      webSecurity: true,
    },
  });
  mainWindow.center();

  // In dev: load from React dev server
  const isDev = true;
  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../build/index.html"));
   }
}

app.whenReady().then(() => {
  const MIME_BY_EXT = {
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  };

  protocol.handle("axstudio-local", (request) => {
    try {
      const u = new URL(request.url);
      const raw = u.searchParams.get("p");
      if (!raw) {
        return new Response("Missing path", { status: 400 });
      }
      const normalized = path.normalize(raw);
      if (!isPathUnderDir(normalized, DATA_DIR)) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!fs.existsSync(normalized)) {
        return new Response("Not found", { status: 404 });
      }
      const st = fs.statSync(normalized);
      if (!st.isFile()) {
        return new Response("Not a file", { status: 400 });
      }

      const ext = path.extname(normalized).toLowerCase();
      const contentType = MIME_BY_EXT[ext] || "application/octet-stream";

      const rangeHeader = request.headers.get("range");
      if (rangeHeader) {
        const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : st.size - 1;
        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(normalized, { start, end });
        return new Response(stream, {
          status: 206,
          headers: {
            "Content-Range": `bytes ${start}-${end}/${st.size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunkSize),
            "Content-Type": contentType,
          },
        });
      }

      const body = fs.createReadStream(normalized);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(st.size),
          "Accept-Ranges": "bytes",
        },
      });
    } catch (e) {
      console.error("axstudio-local:", e);
      return new Response("Error", { status: 500 });
    }
  });
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
