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

  /** Chiave OpenAI da `Connettori.txt` (cartella progetto), se presente. */
  getOpenAiKey: () => ipcRenderer.invoke("get-openai-key"),
});
