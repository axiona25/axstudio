const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");

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

function isPathUnderDir(filePath, rootDir) {
  const f = path.resolve(filePath);
  const r = path.resolve(rootDir);
  if (f === r) return true;
  return f.startsWith(r + path.sep);
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

// ── Copia file in AI-Studio-Data → percorso scelto (Scarica) ──
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

// ══════════════════════════════════════════
// Window
// ══════════════════════════════════════════
let mainWindow;

function getDefaultWindowSize() {
  try {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const ratio = 0.94;
    const w = Math.max(1000, Math.floor(sw * ratio));
    const h = Math.max(680, Math.floor(sh * ratio));
    return { width: w, height: h };
  } catch {
    return { width: 1680, height: 1050 };
  }
}

function createWindow() {
  const { width, height } = getDefaultWindowSize();
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 600,
    title: "AI Studio",
    backgroundColor: "#0a0a0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.center();

  // In dev: load from React dev server
  const isDev = process.env.ELECTRON_DEV === "true" || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../build/index.html"));
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
