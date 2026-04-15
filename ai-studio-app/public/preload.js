const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Balance (native GraphQL, no proxy!) ──
  getBalance: () => ipcRenderer.invoke("get-balance"),

  // ── Binary file save/load ──
  saveFile: (fileName, base64Data, subDir) =>
    ipcRenderer.invoke("save-file", { fileName, base64Data, subDir }),
  loadFile: (filePath) => ipcRenderer.invoke("load-file", { filePath }),

  // ── JSON storage ──
  saveJson: (fileName, data) =>
    ipcRenderer.invoke("save-json", { fileName, data }),
  loadJson: (fileName) => ipcRenderer.invoke("load-json", { fileName }),
  deleteJson: (fileName) => ipcRenderer.invoke("delete-json", { fileName }),

  // ── File management ──
  listFiles: (subDir) => ipcRenderer.invoke("list-files", { subDir }),
  deleteFile: (filePath) => ipcRenderer.invoke("delete-file", { filePath }),
  /** Copia un file già in AI-Studio-Data verso un percorso scelto con “Salva con nome”. */
  exportFileCopy: (sourcePath, defaultFileName) =>
    ipcRenderer.invoke("export-file-copy", { sourcePath, defaultFileName }),
  openInSystem: (filePath) =>
    ipcRenderer.invoke("open-in-system", { filePath }),
  getDataDir: () => ipcRenderer.invoke("get-data-dir"),
  fileExists: (filePath) => ipcRenderer.invoke("file-exists", filePath),

  /** Trim video con ffmpeg — taglia i primi N secondi */
  trimVideo: (inputPath, outputPath, trimSeconds) =>
    ipcRenderer.invoke("trim-video", inputPath, outputPath, trimSeconds),
  /** Rinomina/sposta un file */
  renameFile: (oldPath, newPath) =>
    ipcRenderer.invoke("rename-file", oldPath, newPath),

  /** Mix audio ElevenLabs + video Kling con ffmpeg */
  mixAudioVideo: (videoPath, audioPath, outputPath) =>
    ipcRenderer.invoke("mix-audio-video", videoPath, audioPath, outputPath),

  /** Estrai audio completo da URL web (YouTube ecc.) con yt-dlp */
  extractWebAudio: (url) =>
    ipcRenderer.invoke("extract-web-audio", url),
  /** Taglia segmento audio con ffmpeg */
  trimAudioSegment: (inputPath, startSec, durationSec, outputPath) =>
    ipcRenderer.invoke("trim-audio-segment", inputPath, startSec, durationSec, outputPath),

  /** Chiave OpenAI da `Connettori.txt` (cartella progetto), se presente. */
  getOpenAiKey: () => ipcRenderer.invoke("get-openai-key"),
});
