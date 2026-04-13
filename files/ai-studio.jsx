import { useState, useEffect, useRef, useCallback } from "react";

// ── RunPod Serverless API Config ──
const RUNPOD_API_URL = "https://api.runpod.ai/v2/kdpat0w70yx2x2";
const RUNPOD_VIDEO_API_URL = "https://api.runpod.ai/v2/ulp5se2xlm10et";
const RUNPOD_API_KEY = process.env.REACT_APP_RUNPOD_API_KEY || "";

// ── Electron detection ──
const isElectron = !!(window.electronAPI);

// ── Storage helpers: Electron-native first, localStorage fallback ──
const storage = {
  async saveJson(fileName, data) {
    if (isElectron) {
      return window.electronAPI.saveJson(fileName, data);
    }
    localStorage.setItem(fileName, JSON.stringify(data));
    return { success: true };
  },
  async loadJson(fileName, fallback = null) {
    if (isElectron) {
      const res = await window.electronAPI.loadJson(fileName);
      return res?.success ? (res.data ?? fallback) : fallback;
    }
    try {
      const raw = localStorage.getItem(fileName);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  async saveFile(fileName, base64Data, subDir) {
    if (isElectron) {
      return window.electronAPI.saveFile(fileName, base64Data, subDir);
    }
    // Browser fallback: no file save, just return success
    return { success: true, path: null };
  },
};

// ── Main App ──
export default function AIStudio() {
  const [view, setView] = useState("home");
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewCharacter, setShowNewCharacter] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("low quality, blurry, distorted, deformed, ugly, bad anatomy");
  const [resolution, setResolution] = useState("1024x1024");
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [serverStatus, setServerStatus] = useState("checking");
  const [activeTab, setActiveTab] = useState("image");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoResolution, setVideoResolution] = useState("1280x720");
  const [balance, setBalance] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [dataDir, setDataDir] = useState("");

  // ── Load persisted data on mount ──
  useEffect(() => {
    (async () => {
      const savedProjects = await storage.loadJson("projects.json", []);
      setProjects(savedProjects);
      const savedHistory = await storage.loadJson("history.json", []);
      setHistory(savedHistory);
      if (isElectron) {
        const dir = await window.electronAPI.getDataDir();
        setDataDir(dir);
      }
    })();
  }, []);

  // ── Auto-save projects when they change ──
  const projectsLoaded = useRef(false);
  useEffect(() => {
    if (!projectsLoaded.current) { projectsLoaded.current = true; return; }
    storage.saveJson("projects.json", projects);
  }, [projects]);

  // ── Auto-save history ──
  const historyLoaded = useRef(false);
  useEffect(() => {
    if (!historyLoaded.current) { historyLoaded.current = true; return; }
    storage.saveJson("history.json", history);
  }, [history]);

  // ── Balance: native Electron IPC (no proxy!) or fallback to localhost proxy ──
  useEffect(() => {
    const fetchBalance = async () => {
      try {
        if (isElectron) {
          const bal = await window.electronAPI.getBalance();
          if (bal != null) setBalance(bal);
        } else {
          // Fallback for browser dev: use proxy
          const r = await fetch("http://localhost:3001/api/balance");
          const data = await r.json();
          if (data?.data?.myself?.clientBalance != null) {
            setBalance(data.data.myself.clientBalance);
          }
        }
      } catch (e) { console.log("Balance fetch error:", e); }
    };
    fetchBalance();
    const iv = setInterval(fetchBalance, 60000);
    return () => clearInterval(iv);
  }, []);

  // ── Server health check ──
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${RUNPOD_API_URL}/health`, { headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` } });
        const data = await r.json();
        setServerStatus(data.workers ? "connected" : "error");
      } catch { setServerStatus("offline"); }
    };
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, []);

  // ── Save generated media to disk + history ──
  const saveGeneratedImage = useCallback(async (base64DataUrl, promptUsed, params = {}) => {
    const ts = Date.now();
    const fileName = `img_${ts}.png`;
    const raw = base64DataUrl.startsWith("data:") ? base64DataUrl.split(",")[1] : base64DataUrl;

    const saveResult = await storage.saveFile(fileName, raw, "images");

    const entry = {
      id: ts.toString(),
      type: "image",
      fileName,
      filePath: saveResult.path,
      prompt: promptUsed,
      params,
      createdAt: new Date().toISOString(),
      projectId: currentProject?.id || null,
    };
    setHistory(prev => [entry, ...prev]);
    return entry;
  }, [currentProject]);

  const saveGeneratedVideo = useCallback(async (base64Data, promptUsed, params = {}) => {
    const ts = Date.now();
    const fileName = `vid_${ts}.mp4`;
    const raw = base64Data.startsWith("data:") ? base64Data.split(",")[1] : base64Data;

    const saveResult = await storage.saveFile(fileName, raw, "videos");

    const entry = {
      id: ts.toString(),
      type: "video",
      fileName,
      filePath: saveResult.path,
      prompt: promptUsed,
      params,
      createdAt: new Date().toISOString(),
      projectId: currentProject?.id || null,
    };
    setHistory(prev => [entry, ...prev]);
    return entry;
  }, [currentProject]);

  // ── Project CRUD ──
  const createProject = (name, description) => {
    const proj = { id: Date.now().toString(), name, description, characters: [], scenes: [], createdAt: new Date().toISOString() };
    setProjects(p => [...p, proj]);
    setCurrentProject(proj);
    setShowNewProject(false);
    setView("project");
  };

  const deleteProject = (id) => {
    setProjects(p => p.filter(x => x.id !== id));
    if (currentProject?.id === id) { setCurrentProject(null); setView("home"); }
  };

  const updateProject = (u) => {
    setProjects(p => p.map(x => x.id === u.id ? u : x));
    setCurrentProject(u);
  };

  // ── Characters with disk persistence ──
  const addCharacter = async (name, imageData, mode) => {
    if (!currentProject) return;
    let savedPath = null;
    if (imageData) {
      const ts = Date.now();
      const fileName = `char_${ts}.png`;
      const raw = imageData.startsWith("data:") ? imageData.split(",")[1] : imageData;
      const res = await storage.saveFile(fileName, raw, `characters`);
      savedPath = res.path;
    }
    const c = {
      id: Date.now().toString(),
      name,
      image: imageData,       // keep base64 for in-memory display
      imagePath: savedPath,   // disk path for persistence
      mode,
      createdAt: new Date().toISOString(),
    };
    updateProject({ ...currentProject, characters: [...currentProject.characters, c] });
    setShowNewCharacter(false);
  };

  const deleteCharacter = (cid) => {
    if (!currentProject) return;
    updateProject({ ...currentProject, characters: currentProject.characters.filter(c => c.id !== cid) });
    if (selectedCharacter?.id === cid) setSelectedCharacter(null);
  };

  const scenes = [
    { id: "portrait", label: "Ritratto", prefix: "A close-up portrait, ", icon: "👤" },
    { id: "cinematic", label: "Cinematico", prefix: "A cinematic wide shot, ", icon: "🎬" },
    { id: "outdoor", label: "Esterno", prefix: "Outdoor natural light, ", icon: "🌿" },
    { id: "studio", label: "Studio", prefix: "Professional studio shot, ", icon: "📸" },
    { id: "urban", label: "Urbano", prefix: "Urban street photography, ", icon: "🏙️" },
    { id: "fashion", label: "Fashion", prefix: "High-fashion editorial, ", icon: "👗" },
    { id: "dramatic", label: "Drammatico", prefix: "Dramatic chiaroscuro, ", icon: "🎭" },
    { id: "fantasy", label: "Fantasy", prefix: "Fantasy digital art, ", icon: "🐉" },
  ];

  const vidTemplates = [
    { id: "cinematic", label: "Cinematico", prefix: "Cinematic video, ", icon: "🎬" },
    { id: "product", label: "Prodotto", prefix: "Product reveal, ", icon: "📦" },
    { id: "nature", label: "Natura", prefix: "Nature documentary, ", icon: "🌊" },
    { id: "action", label: "Azione", prefix: "Dynamic action, ", icon: "💥" },
    { id: "portrait-v", label: "Ritratto", prefix: "Close-up portrait video, ", icon: "👤" },
    { id: "aerial", label: "Aereo", prefix: "Aerial drone shot, ", icon: "🚁" },
  ];

  const st = {
    wrap: { minHeight: "100vh", background: "linear-gradient(145deg, #0a0a0f 0%, #12121f 50%, #0d0d18 100%)", color: "#e8e6e3", fontFamily: "'DM Sans', sans-serif" },
    hdr: { padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 100, background: "rgba(10,10,15,0.85)" },
    main: { maxWidth: 1200, margin: "0 auto", padding: "28px 20px" },
    goldBtn: { background: "linear-gradient(135deg, #c9a461, #b8934e)", border: "none", borderRadius: 10, color: "#0a0a0f", fontWeight: 700, cursor: "pointer" },
    card: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20, cursor: "pointer", transition: "all 0.3s" },
    input: { width: "100%", padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#e8e6e3", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" },
    label: { fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 6, display: "block" },
    tag: (active, color = "201,164,97") => ({ padding: "7px 13px", borderRadius: 8, border: "1px solid", borderColor: active ? `rgba(${color},0.5)` : "rgba(255,255,255,0.08)", background: active ? `rgba(${color},0.1)` : "rgba(255,255,255,0.02)", color: active ? `rgba(${color},1)` : "#8b8fa3", cursor: "pointer", fontSize: 12, fontWeight: 500, transition: "all 0.2s" }),
  };

  const StatusDot = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 20, background: serverStatus === "connected" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${serverStatus === "connected" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: serverStatus === "connected" ? "#22c55e" : "#ef4444", boxShadow: `0 0 8px ${serverStatus === "connected" ? "#22c55e" : "#ef4444"}` }} />
      <span style={{ fontSize: 11, color: serverStatus === "connected" ? "#22c55e" : "#ef4444" }}>{serverStatus === "connected" ? "Cloud GPU" : "GPU Offline"}</span>
    </div>
  );

  const BackBtn = () => view !== "home" ? <button onClick={() => { setView("home"); setCurrentProject(null); setGeneratedImages([]); }} style={{ background: "none", border: "none", color: "#8b8fa3", cursor: "pointer", padding: 4, fontSize: 18 }}>←</button> : null;

  // History for current project
  const projectHistory = currentProject
    ? history.filter(h => h.projectId === currentProject.id)
    : history;

  return (
    <div style={st.wrap}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} textarea:focus,input:focus{border-color:rgba(201,164,97,0.3)!important} ::selection{background:rgba(201,164,97,0.3)} ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}`}</style>

      {/* Header */}
      <header style={st.hdr}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BackBtn />
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 21, fontWeight: 600, background: "linear-gradient(135deg, #c9a461, #e8d5a8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>AI Studio</h1>
          <span style={{ fontSize: 10, color: "#444", marginTop: 3 }}>by IT Values</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {balance !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 20, background: "rgba(201,164,97,0.08)", border: "1px solid rgba(201,164,97,0.15)" }}>
              <span style={{ fontSize: 11, color: "#c9a461", fontWeight: 600 }}>${typeof balance === 'number' ? balance.toFixed(2) : balance}</span>
            </div>
          )}
          {/* History button */}
          <button onClick={() => setShowHistory(true)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 11px", borderRadius: 20, background: "rgba(168,193,232,0.08)", border: "1px solid rgba(168,193,232,0.15)", color: "#a8c1e8", fontSize: 11, fontWeight: 500, cursor: "pointer" }}>
            📋 Storico {history.length > 0 && `(${history.length})`}
          </button>
          <StatusDot />
        </div>
      </header>

      <main style={st.main}>
        {/* ═══ HOME ═══ */}
        {view === "home" && <>
          <div style={{ textAlign: "center", marginBottom: 44, paddingTop: 16 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, fontWeight: 500, marginBottom: 10, color: "#f0ece4" }}>Crea senza limiti</h2>
            <p style={{ color: "#6b6f85", fontSize: 14, maxWidth: 480, margin: "0 auto" }}>Immagini, video e voci AI — powered by GPU Cloud, nessuna censura, totale libertà creativa.</p>
            {dataDir && <p style={{ color: "#3a3e52", fontSize: 10, marginTop: 8 }}>💾 Dati salvati in: {dataDir}</p>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 44 }}>
            {[
              { v: "free-image", icon: "🖼️", title: "Immagine Libera", desc: "Genera un'immagine singola", c: "201,164,97" },
              { v: "free-video", icon: "🎬", title: "Video Libero", desc: "Genera un video da prompt", c: "99,133,201" },
            ].map(q => (
              <button key={q.v} onClick={() => setView(q.v)} style={{ background: `linear-gradient(135deg, rgba(${q.c},0.08), rgba(${q.c},0.02))`, border: `1px solid rgba(${q.c},0.15)`, borderRadius: 14, padding: "24px 20px", cursor: "pointer", textAlign: "left", transition: "all 0.3s" }}>
                <div style={{ fontSize: 26, marginBottom: 10 }}>{q.icon}</div>
                <div style={{ color: `rgba(${q.c},1)`, fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{q.title}</div>
                <div style={{ color: "#6b6f85", fontSize: 12 }}>{q.desc}</div>
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <h3 style={{ fontSize: 17, fontWeight: 600, color: "#d0cdc5", margin: 0 }}>📁 I tuoi Progetti</h3>
            <button onClick={() => setShowNewProject(true)} style={{ ...st.goldBtn, display: "flex", alignItems: "center", gap: 5, padding: "7px 15px", fontSize: 12 }}>+ Nuovo Progetto</button>
          </div>

          {projects.length === 0 ? (
            <div style={{ textAlign: "center", padding: "44px 20px", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 14, color: "#4a4e62" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📁</div>
              <p style={{ fontSize: 13, margin: 0 }}>Nessun progetto. Crea il primo per gestire personaggi e scene.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
              {projects.map(p => (
                <div key={p.id} onClick={() => { setCurrentProject(p); setView("project"); }} style={st.card}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(201,164,97,0.3)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <h4 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "#e8d5a8" }}>{p.name}</h4>
                      <p style={{ margin: 0, fontSize: 12, color: "#6b6f85" }}>{p.description || "—"}</p>
                    </div>
                    <button onClick={e => { e.stopPropagation(); deleteProject(p.id); }} style={{ background: "none", border: "none", color: "#4a4e62", cursor: "pointer", fontSize: 14 }}>🗑</button>
                  </div>
                  <div style={{ display: "flex", gap: 14, marginTop: 14, fontSize: 11, color: "#555" }}>
                    <span>👤 {p.characters.length} personaggi</span>
                    <span>🖼️ {p.scenes.length} scene</span>
                    <span>📋 {history.filter(h => h.projectId === p.id).length} generazioni</span>
                  </div>
                  {p.characters.length > 0 && (
                    <div style={{ display: "flex", marginTop: 10 }}>
                      {p.characters.slice(0, 4).map((c, i) => (
                        <div key={c.id} style={{ width: 30, height: 30, borderRadius: "50%", border: "2px solid #1a1a2e", background: c.image ? `url(${c.image}) center/cover` : "linear-gradient(135deg, #c9a461, #b8934e)", marginLeft: i ? -6 : 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "#0a0a0f" }}>
                          {!c.image && c.name[0]}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>}

        {/* ═══ PROJECT ═══ */}
        {view === "project" && currentProject && <>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 600, color: "#f0ece4", marginBottom: 3 }}>{currentProject.name}</h2>
            <p style={{ color: "#6b6f85", fontSize: 13, margin: 0 }}>{currentProject.description}</p>
          </div>

          {/* Characters */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "#d0cdc5", margin: 0 }}>👤 Personaggi</h3>
              <button onClick={() => setShowNewCharacter(true)} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(201,164,97,0.1)", border: "1px solid rgba(201,164,97,0.2)", borderRadius: 8, padding: "5px 12px", color: "#c9a461", fontWeight: 500, fontSize: 11, cursor: "pointer" }}>+ Aggiungi</button>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {currentProject.characters.map(c => (
                <div key={c.id} onClick={() => setSelectedCharacter(selectedCharacter?.id === c.id ? null : c)}
                  style={{ width: 110, padding: 10, borderRadius: 11, cursor: "pointer", background: selectedCharacter?.id === c.id ? "rgba(201,164,97,0.1)" : "rgba(255,255,255,0.02)", border: `1px solid ${selectedCharacter?.id === c.id ? "rgba(201,164,97,0.4)" : "rgba(255,255,255,0.06)"}`, textAlign: "center", transition: "all 0.2s", position: "relative" }}>
                  <button onClick={e => { e.stopPropagation(); deleteCharacter(c.id); }} style={{ position: "absolute", top: 4, right: 4, background: "rgba(239,68,68,0.15)", border: "none", borderRadius: 5, padding: "1px 4px", cursor: "pointer", color: "#ef4444", fontSize: 9 }}>✕</button>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", margin: "0 auto 6px", background: c.image ? `url(${c.image}) center/cover` : "linear-gradient(135deg, #2a2a4a, #3a3a5a)", border: selectedCharacter?.id === c.id ? "2px solid #c9a461" : "2px solid transparent" }} />
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#e0dcd4" }}>{c.name}</div>
                  <div style={{ fontSize: 9, color: "#6b6f85", marginTop: 2, background: "rgba(255,255,255,0.05)", borderRadius: 3, padding: "1px 5px", display: "inline-block" }}>{c.mode === "face" ? "Viso" : "Corpo"}</div>
                </div>
              ))}
              {currentProject.characters.length === 0 && (
                <div style={{ flex: 1, padding: 28, textAlign: "center", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 11, color: "#4a4e62", fontSize: 12 }}>Aggiungi un personaggio per mantenere consistenza</div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, marginBottom: 22, background: "rgba(255,255,255,0.03)", borderRadius: 11, padding: 3, border: "1px solid rgba(255,255,255,0.06)" }}>
            {[{ id: "image", label: "🖼️ Immagine" }, { id: "video", label: "🎬 Video" }, { id: "voice", label: "🎙️ Voce" }].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, padding: "9px 14px", borderRadius: 8, border: "none", background: activeTab === t.id ? "rgba(201,164,97,0.12)" : "transparent", color: activeTab === t.id ? "#e8d5a8" : "#6b6f85", fontWeight: activeTab === t.id ? 600 : 400, fontSize: 13, cursor: "pointer" }}>{t.label}</button>
            ))}
          </div>

          {activeTab === "image" && <ImgGen {...{ prompt, setPrompt, negPrompt, setNegPrompt, resolution, setResolution, generating, setGenerating, generatedImages, setGeneratedImages, selectedCharacter, scenes, onSave: saveGeneratedImage }} />}
          {activeTab === "video" && <VidGen {...{ videoPrompt, setVideoPrompt, videoDuration, setVideoDuration, videoResolution, setVideoResolution, generating, setGenerating, selectedCharacter, vidTemplates, onSaveVideo: saveGeneratedVideo }} />}
          {activeTab === "voice" && <VoiceGen />}

          {/* Project History */}
          {projectHistory.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "#d0cdc5", marginBottom: 14 }}>📋 Storico Progetto</h3>
              <HistoryList items={projectHistory} />
            </div>
          )}
        </>}

        {/* ═══ FREE IMAGE ═══ */}
        {view === "free-image" && <>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 600, color: "#f0ece4", marginBottom: 22 }}>Immagine Libera</h2>
          <ImgGen {...{ prompt, setPrompt, negPrompt, setNegPrompt, resolution, setResolution, generating, setGenerating, generatedImages, setGeneratedImages, selectedCharacter: null, scenes, onSave: saveGeneratedImage }} />
        </>}

        {/* ═══ FREE VIDEO ═══ */}
        {view === "free-video" && <>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 600, color: "#f0ece4", marginBottom: 22 }}>Video Libero</h2>
          <VidGen {...{ videoPrompt, setVideoPrompt, videoDuration, setVideoDuration, videoResolution, setVideoResolution, generating, setGenerating, selectedCharacter: null, vidTemplates, onSaveVideo: saveGeneratedVideo }} />
        </>}
      </main>

      {showNewProject && <Modal title="Nuovo Progetto" onClose={() => setShowNewProject(false)}><NewProjectForm onCreate={createProject} /></Modal>}
      {showNewCharacter && <Modal title="Nuovo Personaggio" onClose={() => setShowNewCharacter(false)}><NewCharForm onAdd={addCharacter} /></Modal>}

      {/* History Modal */}
      {showHistory && (
        <Modal title={`📋 Storico Generazioni (${history.length})`} onClose={() => setShowHistory(false)}>
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {history.length === 0 ? (
              <p style={{ color: "#4a4e62", textAlign: "center", fontSize: 13 }}>Nessuna generazione ancora.</p>
            ) : (
              <HistoryList items={history} />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── History List Component ──
function HistoryList({ items }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.slice(0, 50).map(h => (
        <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 9, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ fontSize: 20 }}>{h.type === "image" ? "🖼️" : h.type === "video" ? "🎬" : "🎙️"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#e0dcd4", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.prompt}</div>
            <div style={{ display: "flex", gap: 10, fontSize: 10, color: "#4a4e62", marginTop: 2 }}>
              <span>{new Date(h.createdAt).toLocaleString("it-IT")}</span>
              <span>{h.fileName}</span>
              {h.filePath && <span style={{ color: "#22c55e" }}>💾 Salvato</span>}
            </div>
          </div>
          {h.filePath && isElectron && (
            <button onClick={() => window.electronAPI.openInSystem(h.filePath)} style={{ background: "rgba(201,164,97,0.1)", border: "1px solid rgba(201,164,97,0.2)", borderRadius: 6, padding: "3px 8px", color: "#c9a461", fontSize: 10, cursor: "pointer", whiteSpace: "nowrap" }}>Apri</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Image Generator ──
function ImgGen({ prompt, setPrompt, negPrompt, setNegPrompt, resolution, setResolution, generating, setGenerating, generatedImages, setGeneratedImages, selectedCharacter, scenes, onSave }) {
  const [tmpl, setTmpl] = useState(null);
  const [adv, setAdv] = useState(false);
  const [steps, setSteps] = useState(30);
  const [cfg, setCfg] = useState(1.0);
  const [previewImg, setPreviewImg] = useState(null);
  const [aspect, setAspect] = useState("1:1");

  const aspectResolutions = {
    "1:1": [["512x512", "512p"], ["768x768", "768p"], ["1024x1024", "1024p"]],
    "16:9": [["854x480", "480p"], ["1280x720", "720p"], ["1920x1080", "1080p"]],
    "9:16": [["480x854", "480p"], ["720x1280", "720p"], ["1080x1920", "1080p"]],
  };

  const generate = async () => {
    setGenerating(true);
    try {
      let fp = prompt;
      const t = scenes.find(s => s.id === tmpl);
      if (t) fp = t.prefix + fp;
      if (selectedCharacter) fp += `, consistent character "${selectedCharacter.name}", ${selectedCharacter.mode === "face" ? "same face" : "same body"}`;
      fp += ", masterpiece, best quality, highly detailed, 8K";
      const [w, h] = resolution.split("x").map(Number);
      const seed = Math.floor(Math.random() * 2147483647);
      const wf = {
        "5": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "flux1-dev-fp8.safetensors" } },
        "14": { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: 1 } },
        "6": { class_type: "CLIPTextEncode", inputs: { text: fp, clip: ["5", 1] } },
        "7": { class_type: "CLIPTextEncode", inputs: { text: negPrompt, clip: ["5", 1] } },
        "13": { class_type: "KSampler", inputs: { seed, steps, cfg, sampler_name: "euler", scheduler: "simple", denoise: 1.0, model: ["5", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["14", 0] } },
        "8": { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["5", 2] } },
        "9": { class_type: "SaveImage", inputs: { filename_prefix: "ai_studio", images: ["8", 0] } },
      };

      const res = await fetch(`${RUNPOD_API_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RUNPOD_API_KEY}` },
        body: JSON.stringify({ input: { workflow: wf } }),
      });
      const data = await res.json();

      if (data.id) {
        const poll = async () => {
          const sr = await fetch(`${RUNPOD_API_URL}/status/${data.id}`, {
            headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
          });
          const status = await sr.json();
          if (status.status === "COMPLETED") {
            let imgDataUrl = null;
            if (status.output?.images) {
              const imgs = status.output.images.map(img => `data:image/png;base64,${img.data}`);
              setGeneratedImages(p => [...imgs, ...p]);
              imgDataUrl = imgs[0];
            } else if (status.output?.message) {
              imgDataUrl = `data:image/png;base64,${status.output.message}`;
              setGeneratedImages(p => [imgDataUrl, ...p]);
            }
            // Auto-save to disk
            if (imgDataUrl && onSave) {
              onSave(imgDataUrl, fp, { resolution, steps, cfg, seed, template: tmpl });
            }
            setGenerating(false);
          } else if (status.status === "FAILED") {
            console.error("Generation failed:", status.error);
            setGenerating(false);
          } else {
            setTimeout(poll, 3000);
          }
        };
        setTimeout(poll, 5000);
      } else {
        console.error("RunPod error:", data);
        setGenerating(false);
      }
    } catch (e) { console.error(e); setGenerating(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 7, display: "block" }}>Stile Scena</label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {scenes.map(s => (
            <button key={s.id} onClick={() => setTmpl(tmpl === s.id ? null : s.id)}
              style={{ padding: "7px 13px", borderRadius: 8, border: "1px solid", borderColor: tmpl === s.id ? "rgba(201,164,97,0.5)" : "rgba(255,255,255,0.08)", background: tmpl === s.id ? "rgba(201,164,97,0.1)" : "rgba(255,255,255,0.02)", color: tmpl === s.id ? "#e8d5a8" : "#8b8fa3", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>
      </div>

      {selectedCharacter && (
        <div style={{ padding: "10px 14px", borderRadius: 9, marginBottom: 14, background: "rgba(201,164,97,0.06)", border: "1px solid rgba(201,164,97,0.15)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: selectedCharacter.image ? `url(${selectedCharacter.image}) center/cover` : "linear-gradient(135deg, #c9a461, #b8934e)", border: "2px solid #c9a461" }} />
          <div><div style={{ fontSize: 12, fontWeight: 600, color: "#e8d5a8" }}>Personaggio: {selectedCharacter.name}</div><div style={{ fontSize: 10, color: "#8b8fa3" }}>{selectedCharacter.mode === "face" ? "Solo Viso" : "Corpo Intero"}</div></div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Descrivi la scena</label>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Descrivi cosa vuoi generare..." style={{ width: "100%", minHeight: 90, padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#e8e6e3", fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
      </div>

      <button onClick={() => setAdv(!adv)} style={{ background: "none", border: "none", color: "#6b6f85", cursor: "pointer", fontSize: 11, marginBottom: 10 }}>⚙️ Avanzate {adv ? "▲" : "▼"}</button>

      {adv && (
        <div style={{ padding: 14, borderRadius: 10, marginBottom: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: "#6b6f85", display: "block", marginBottom: 3 }}>Negative Prompt</label>
            <textarea value={negPrompt} onChange={e => setNegPrompt(e.target.value)} style={{ width: "100%", minHeight: 50, padding: "8px 10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 7, color: "#8b8fa3", fontSize: 11, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <div><label style={{ fontSize: 11, color: "#6b6f85" }}>Steps: {steps}</label><br /><input type="range" min="1" max="30" value={steps} onChange={e => setSteps(+e.target.value)} style={{ width: 130 }} /></div>
            <div><label style={{ fontSize: 11, color: "#6b6f85" }}>CFG: {cfg}</label><br /><input type="range" min="0.5" max="10" step="0.1" value={cfg} onChange={e => setCfg(+e.target.value)} style={{ width: 130 }} /></div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 22 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 7, display: "block" }}>Formato</label>
          <div style={{ display: "flex", gap: 6 }}>
            {[["1:1", "⬜ 1:1"], ["16:9", "▬ 16:9"], ["9:16", "▮ 9:16"]].map(([id, l]) => (
              <button key={id} onClick={() => { setAspect(id); setResolution(aspectResolutions[id][1][0]); }} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid", cursor: "pointer", fontSize: 12, fontWeight: 500, borderColor: aspect === id ? "rgba(201,164,97,0.5)" : "rgba(255,255,255,0.08)", background: aspect === id ? "rgba(201,164,97,0.1)" : "rgba(255,255,255,0.02)", color: aspect === id ? "#e8d5a8" : "#8b8fa3" }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Risoluzione</label>
          <div style={{ display: "flex", gap: 5 }}>
            {(aspectResolutions[aspect] || []).map(([res, label]) => (
              <button key={res} onClick={() => setResolution(res)} style={{ padding: "5px 11px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: "1px solid", cursor: "pointer", borderColor: resolution === res ? "rgba(201,164,97,0.5)" : "rgba(255,255,255,0.08)", background: resolution === res ? "rgba(201,164,97,0.1)" : "transparent", color: resolution === res ? "#e8d5a8" : "#6b6f85" }}>{label}</button>
            ))}
          </div>
        </div>
        <button onClick={generate} disabled={generating || !prompt.trim()} style={{ width: "100%", padding: "12px 20px", borderRadius: 10, border: "none", background: generating ? "rgba(201,164,97,0.2)" : "linear-gradient(135deg, #c9a461, #b8934e)", color: generating ? "#8b8fa3" : "#0a0a0f", fontWeight: 700, fontSize: 14, cursor: generating ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 44 }}>
          {generating ? <><div style={{ width: 14, height: 14, border: "2px solid rgba(201,164,97,0.3)", borderTopColor: "#c9a461", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />Generazione...</> : "⚡ Genera Immagine"}
        </button>
      </div>

      {generatedImages.length > 0 && (
        <div>
          <h4 style={{ fontSize: 13, color: "#8b8fa3", marginBottom: 10 }}>🖼 Risultati</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
            {generatedImages.map((img, i) => (
              <div key={i} onClick={() => setPreviewImg(img)} style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", background: "#111", cursor: "pointer", position: "relative", transition: "all 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(201,164,97,0.4)"; e.currentTarget.style.transform = "scale(1.02)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.transform = "scale(1)"; }}>
                <img src={img} alt="" style={{ width: "100%", display: "block" }} onError={e => e.target.style.display = "none"} />
                <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "4px 8px", fontSize: 10, color: "#aaa" }}>🔍 Clicca per ingrandire</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {previewImg && (
        <div onClick={() => setPreviewImg(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, cursor: "zoom-out" }}>
          <div onClick={e => e.stopPropagation()} style={{ position: "relative", maxWidth: "92vw", maxHeight: "92vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <img src={previewImg} alt="" style={{ maxWidth: "100%", maxHeight: "82vh", borderRadius: 10, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <a href={previewImg} download={`ai-studio-${Date.now()}.png`} onClick={e => e.stopPropagation()}
                style={{ padding: "10px 22px", borderRadius: 9, background: "linear-gradient(135deg, #c9a461, #b8934e)", color: "#0a0a0f", fontWeight: 700, fontSize: 13, textDecoration: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                💾 Scarica Immagine
              </a>
              <button onClick={() => setPreviewImg(null)}
                style={{ padding: "10px 22px", borderRadius: 9, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#aaa", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                ✕ Chiudi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Video Generator ──
function VidGen({ videoPrompt, setVideoPrompt, videoDuration, setVideoDuration, videoResolution, setVideoResolution, generating, setGenerating, selectedCharacter, vidTemplates, onSaveVideo }) {
  const [tmpl, setTmpl] = useState(null);
  const [sourceImg, setSourceImg] = useState(null);
  const [generatedVideos, setGeneratedVideos] = useState([]);
  const [previewVideo, setPreviewVideo] = useState(null);
  const [vidSteps, setVidSteps] = useState(20);
  const [vidAspect, setVidAspect] = useState("9:16");
  const [videoStatus, setVideoStatus] = useState("");
  const fileRef = useRef(null);

  const vidResolutions = {
    "1:1": [["512x512", "512p"], ["768x768", "768p"], ["1024x1024", "1024p"]],
    "16:9": [["854x480", "480p"], ["1280x720", "720p"], ["1920x1080", "1080p"]],
    "9:16": [["480x854", "480p"], ["720x1280", "720p"], ["1080x1920", "1080p"]],
  };

  const handleFile = e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => setSourceImg(ev.target.result);
    r.readAsDataURL(f);
  };

  const generateVideo = async () => {
    if (!videoPrompt.trim()) return;
    setGenerating(true);
    setVideoStatus("");
    try {
      let fp = videoPrompt;
      const t = vidTemplates.find(s => s.id === tmpl);
      if (t) fp = t.prefix + fp;
      if (selectedCharacter) fp += `, consistent character "${selectedCharacter.name}"`;

      const [w, h] = videoResolution.split("x").map(Number);
      const seed = Math.floor(Math.random() * 2147483647);
      const exportFps = 18;
      const length = Math.min(Math.max(videoDuration * exportFps, 17), 129);

      let imageBase64 = null;

      if (sourceImg) {
        imageBase64 = sourceImg.startsWith("data:") ? sourceImg.split(",")[1] : sourceImg;
      } else if (selectedCharacter?.image) {
        imageBase64 = selectedCharacter.image.startsWith("data:") ? selectedCharacter.image.split(",")[1] : selectedCharacter.image;
      } else {
        // Step 1: Generate image with FLUX
        setVideoStatus("🖼️ Generazione frame iniziale con FLUX...");
        const imgWf = {
          "5": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "flux1-dev-fp8.safetensors" } },
          "14": { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: 1 } },
          "6": { class_type: "CLIPTextEncode", inputs: { text: fp + ", masterpiece, best quality, highly detailed, 8K", clip: ["5", 1] } },
          "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, low quality, distorted", clip: ["5", 1] } },
          "13": { class_type: "KSampler", inputs: { seed, steps: 20, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0, model: ["5", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["14", 0] } },
          "8": { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["5", 2] } },
          "9": { class_type: "SaveImage", inputs: { filename_prefix: "video_frame", images: ["8", 0] } },
        };

        const imgRes = await fetch(`${RUNPOD_API_URL}/runsync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RUNPOD_API_KEY}` },
          body: JSON.stringify({ input: { workflow: imgWf } }),
        });
        const imgData = await imgRes.json();

        if (imgData.status === "COMPLETED" && imgData.output?.images?.[0]?.data) {
          imageBase64 = imgData.output.images[0].data;
          setVideoStatus("✅ Frame generato! 🎬 Animazione in corso...");
        } else {
          console.error("Image generation failed:", imgData);
          setGenerating(false);
          setVideoStatus("❌ Errore nella generazione del frame");
          return;
        }
      }

      // Step 2: Generate video with Wan2.2
      if (!videoStatus.includes("Animazione")) setVideoStatus("🎬 Generazione video in corso...");

      const input = {
        prompt: fp,
        negative_prompt: "blurry, low quality, distorted, deformed",
        image_base64: imageBase64,
        width: w,
        height: h,
        length,
        steps: vidSteps,
        seed,
        cfg: 2.0,
        context_overlap: 48,
      };

      const res = await fetch(`${RUNPOD_VIDEO_API_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RUNPOD_API_KEY}` },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();

      if (data.id) {
        const poll = async () => {
          const sr = await fetch(`${RUNPOD_VIDEO_API_URL}/status/${data.id}`, {
            headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
          });
          const status = await sr.json();
          if (status.status === "COMPLETED") {
            if (status.output?.video) {
              let videoData = status.output.video;
              let base64 = videoData.startsWith("data:") ? videoData.split(",")[1] : videoData;

              // Save to disk before creating blob
              if (onSaveVideo) {
                onSaveVideo(base64, fp, { resolution: videoResolution, duration: videoDuration, steps: vidSteps, seed });
              }

              const byteChars = atob(base64);
              const byteArray = new Uint8Array(byteChars.length);
              for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
              const blob = new Blob([byteArray], { type: "video/mp4" });
              const blobUrl = URL.createObjectURL(blob);
              setGeneratedVideos(p => [blobUrl, ...p]);
            }
            setGenerating(false);
            setVideoStatus("✅ Video completato!");
            setTimeout(() => setVideoStatus(""), 3000);
          } else if (status.status === "FAILED") {
            console.error("Video generation failed:", status.error);
            setGenerating(false);
            setVideoStatus("❌ Errore: " + (status.error || "generazione fallita"));
          } else {
            setVideoStatus("🎬 Animazione in corso... attendere");
            setTimeout(poll, 5000);
          }
        };
        setTimeout(poll, 10000);
      } else {
        console.error("RunPod video error:", data);
        setGenerating(false);
        setVideoStatus("❌ Errore RunPod");
      }
    } catch (e) { console.error(e); setGenerating(false); setVideoStatus("❌ Errore: " + e.message); }
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 7, display: "block" }}>Stile Video</label>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {vidTemplates.map(t => (
            <button key={t.id} onClick={() => setTmpl(tmpl === t.id ? null : t.id)} style={{ padding: "7px 13px", borderRadius: 8, border: "1px solid", borderColor: tmpl === t.id ? "rgba(99,133,201,0.5)" : "rgba(255,255,255,0.08)", background: tmpl === t.id ? "rgba(99,133,201,0.1)" : "rgba(255,255,255,0.02)", color: tmpl === t.id ? "#a8c1e8" : "#8b8fa3", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      {selectedCharacter && (
        <div style={{ padding: "10px 14px", borderRadius: 9, marginBottom: 14, background: "rgba(99,133,201,0.06)", border: "1px solid rgba(99,133,201,0.15)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: selectedCharacter.image ? `url(${selectedCharacter.image}) center/cover` : "linear-gradient(135deg, #6385c9, #4e6bb8)", border: "2px solid #6385c9" }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: "#a8c1e8" }}>Personaggio: {selectedCharacter.name}</div>
        </div>
      )}

      {/* Source Image Upload */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Immagine di Partenza (opzionale — image-to-video)</label>
        <div onClick={() => fileRef.current?.click()} style={{ padding: sourceImg ? 0 : 20, borderRadius: 10, textAlign: "center", border: `2px dashed ${sourceImg ? "rgba(99,133,201,0.4)" : "rgba(255,255,255,0.08)"}`, cursor: "pointer", color: "#4a4e62", overflow: "hidden", position: "relative" }}>
          {sourceImg ? (
            <>
              <img src={sourceImg} alt="" style={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }} />
              <button onClick={e => { e.stopPropagation(); setSourceImg(null); }} style={{ position: "absolute", top: 6, right: 6, background: "rgba(239,68,68,0.8)", border: "none", borderRadius: 6, padding: "3px 8px", color: "#fff", fontSize: 11, cursor: "pointer" }}>✕ Rimuovi</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 20, marginBottom: 6 }}>🖼️</div>
              <p style={{ margin: 0, fontSize: 12 }}>Carica un'immagine per animarla in video</p>
              <p style={{ margin: "3px 0 0", fontSize: 10 }}>JPG, PNG — oppure lascia vuoto per text-to-video</p>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Descrivi il video</label>
        <textarea value={videoPrompt} onChange={e => setVideoPrompt(e.target.value)} placeholder="Descrivi il movimento e l'azione del video..." style={{ width: "100%", minHeight: 90, padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#e8e6e3", fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
      </div>

      <div style={{ display: "flex", gap: 18, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, display: "block", marginBottom: 5 }}>Durata</label>
          <div style={{ display: "flex", gap: 5 }}>
            {[3, 5, 7].map(s => (
              <button key={s} onClick={() => setVideoDuration(s)} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: "1px solid", cursor: "pointer", borderColor: videoDuration === s ? "rgba(99,133,201,0.5)" : "rgba(255,255,255,0.08)", background: videoDuration === s ? "rgba(99,133,201,0.1)" : "transparent", color: videoDuration === s ? "#a8c1e8" : "#6b6f85" }}>{s}s</button>
            ))}
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, color: "#6b6f85", display: "block", marginBottom: 5 }}>Steps: {vidSteps}</label>
          <input type="range" min="5" max="30" value={vidSteps} onChange={e => setVidSteps(+e.target.value)} style={{ width: 130 }} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 7, display: "block" }}>Formato</label>
        <div style={{ display: "flex", gap: 6 }}>
          {[["1:1", "⬜ 1:1"], ["16:9", "▬ 16:9"], ["9:16", "▮ 9:16"]].map(([id, l]) => (
            <button key={id} onClick={() => { setVidAspect(id); setVideoResolution(vidResolutions[id][0][0]); }} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid", cursor: "pointer", fontSize: 12, fontWeight: 500, borderColor: vidAspect === id ? "rgba(99,133,201,0.5)" : "rgba(255,255,255,0.08)", background: vidAspect === id ? "rgba(99,133,201,0.1)" : "rgba(255,255,255,0.02)", color: vidAspect === id ? "#a8c1e8" : "#8b8fa3" }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Risoluzione</label>
        <div style={{ display: "flex", gap: 5 }}>
          {(vidResolutions[vidAspect] || []).map(([res, label]) => (
            <button key={res} onClick={() => setVideoResolution(res)} style={{ padding: "5px 11px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: "1px solid", cursor: "pointer", borderColor: videoResolution === res ? "rgba(99,133,201,0.5)" : "rgba(255,255,255,0.08)", background: videoResolution === res ? "rgba(99,133,201,0.1)" : "transparent", color: videoResolution === res ? "#a8c1e8" : "#6b6f85" }}>{label}</button>
          ))}
        </div>
      </div>

      <button onClick={generateVideo} disabled={generating || !videoPrompt.trim()} style={{ width: "100%", padding: "13px 20px", borderRadius: 10, border: "none", background: generating ? "rgba(99,133,201,0.2)" : "linear-gradient(135deg, #6385c9, #4e6bb8)", color: generating ? "#8b8fa3" : "#fff", fontWeight: 700, fontSize: 14, cursor: generating ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
        {generating ? <><div style={{ width: 14, height: 14, border: "2px solid rgba(99,133,201,0.3)", borderTopColor: "#6385c9", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />Generazione Video...</> : "⚡ Genera Video"}
      </button>

      <div style={{ marginTop: 14, padding: 14, borderRadius: 9, background: "rgba(99,133,201,0.04)", border: "1px solid rgba(99,133,201,0.1)", fontSize: 11, color: "#6b6f85" }}>
        💡 Wan2.2 — Carica un'immagine per animarla, oppure genera solo da prompt (il sistema creerà automaticamente il primo frame). Durata max 7s.
      </div>

      {videoStatus && (
        <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 9, background: videoStatus.includes("❌") ? "rgba(239,68,68,0.08)" : "rgba(99,133,201,0.08)", border: `1px solid ${videoStatus.includes("❌") ? "rgba(239,68,68,0.2)" : "rgba(99,133,201,0.2)"}`, fontSize: 13, color: videoStatus.includes("❌") ? "#ef4444" : "#a8c1e8", fontWeight: 500 }}>
          {videoStatus}
        </div>
      )}

      {generatedVideos.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h4 style={{ fontSize: 13, color: "#8b8fa3", marginBottom: 10 }}>🎬 Video Generati</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {generatedVideos.map((vid, i) => (
              <div key={i} style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(99,133,201,0.15)", background: "#111" }}>
                <video src={vid} controls style={{ width: "100%", display: "block" }} />
                <div style={{ display: "flex", gap: 6, padding: 8 }}>
                  <a href={vid} download={`ai-studio-video-${Date.now()}.mp4`}
                    style={{ flex: 1, padding: "7px", borderRadius: 7, background: "linear-gradient(135deg, #6385c9, #4e6bb8)", color: "#fff", fontWeight: 600, fontSize: 11, textDecoration: "none", textAlign: "center", cursor: "pointer" }}>
                    💾 Scarica
                  </a>
                  <button onClick={() => setPreviewVideo(vid)}
                    style={{ flex: 1, padding: "7px", borderRadius: 7, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#aaa", fontWeight: 600, fontSize: 11, cursor: "pointer" }}>
                    🔍 Fullscreen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {previewVideo && (
        <div onClick={() => setPreviewVideo(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, cursor: "zoom-out" }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: "92vw", maxHeight: "92vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <video src={previewVideo} controls autoPlay style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 10, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <a href={previewVideo} download={`ai-studio-video-${Date.now()}.mp4`} onClick={e => e.stopPropagation()}
                style={{ padding: "10px 22px", borderRadius: 9, background: "linear-gradient(135deg, #6385c9, #4e6bb8)", color: "#fff", fontWeight: 700, fontSize: 13, textDecoration: "none", cursor: "pointer" }}>
                💾 Scarica Video
              </a>
              <button onClick={() => setPreviewVideo(null)}
                style={{ padding: "10px 22px", borderRadius: 9, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#aaa", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
                ✕ Chiudi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Voice Generator ──
function VoiceGen() {
  const [text, setText] = useState("");
  const [lang, setLang] = useState("it");
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Audio di Riferimento</label>
        <div style={{ padding: 20, borderRadius: 10, textAlign: "center", border: "2px dashed rgba(255,255,255,0.08)", cursor: "pointer", color: "#4a4e62" }}>
          <div style={{ fontSize: 20, marginBottom: 6 }}>🎤</div>
          <p style={{ margin: 0, fontSize: 12 }}>Carica audio 3+ sec per clonare la voce</p>
          <p style={{ margin: "3px 0 0", fontSize: 10 }}>MP3, WAV, M4A</p>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Lingua</label>
        <div style={{ display: "flex", gap: 5 }}>
          {[["it", "🇮🇹 Italiano"], ["en", "🇬🇧 English"], ["es", "🇪🇸 Español"], ["fr", "🇫🇷 Français"], ["de", "🇩🇪 Deutsch"]].map(([id, l]) => (
            <button key={id} onClick={() => setLang(id)} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, border: "1px solid", cursor: "pointer", borderColor: lang === id ? "rgba(168,193,232,0.5)" : "rgba(255,255,255,0.08)", background: lang === id ? "rgba(168,193,232,0.1)" : "transparent", color: lang === id ? "#a8c1e8" : "#6b6f85" }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Testo</label>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Scrivi il testo da pronunciare..." style={{ width: "100%", minHeight: 100, padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#e8e6e3", fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
      </div>
      <button disabled={!text.trim()} style={{ width: "100%", padding: "13px 20px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #7c6d9f, #5e4f82)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: text.trim() ? 1 : 0.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>🎙️ Genera Voce</button>
      <div style={{ marginTop: 14, padding: 14, borderRadius: 9, background: "rgba(124,109,159,0.04)", border: "1px solid rgba(124,109,159,0.1)", fontSize: 11, color: "#6b6f85" }}>🎙️ Qwen3-TTS — 10 lingue, clonazione da 3 secondi di audio.</div>
    </div>
  );
}

// ── Modal ──
function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#16162a", borderRadius: 14, padding: 24, border: "1px solid rgba(255,255,255,0.08)", minWidth: 380, maxWidth: 520, width: "90%", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#e8d5a8" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#6b6f85", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── New Project Form ──
function NewProjectForm({ onCreate }) {
  const [n, setN] = useState("");
  const [d, setD] = useState("");
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", display: "block", marginBottom: 5 }}>Nome *</label>
        <input value={n} onChange={e => setN(e.target.value)} placeholder="Es: Film Roma..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e6e3", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
      </div>
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", display: "block", marginBottom: 5 }}>Descrizione</label>
        <textarea value={d} onChange={e => setD(e.target.value)} placeholder="Descrivi il progetto..." style={{ width: "100%", minHeight: 70, padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e6e3", fontSize: 12, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
      </div>
      <button onClick={() => n.trim() && onCreate(n, d)} disabled={!n.trim()} style={{ width: "100%", padding: "11px", borderRadius: 9, border: "none", background: n.trim() ? "linear-gradient(135deg, #c9a461, #b8934e)" : "rgba(255,255,255,0.05)", color: n.trim() ? "#0a0a0f" : "#4a4e62", fontWeight: 700, fontSize: 13, cursor: n.trim() ? "pointer" : "not-allowed" }}>Crea Progetto</button>
    </div>
  );
}

// ── New Character Form ──
function NewCharForm({ onAdd }) {
  const [n, setN] = useState("");
  const [m, setM] = useState("face");
  const [img, setImg] = useState(null);
  const [src, setSrc] = useState("upload");
  const [gp, setGp] = useState("");
  const fr = useRef();
  const handleFile = e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setImg(ev.target.result); r.readAsDataURL(f); };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", display: "block", marginBottom: 5 }}>Nome *</label>
        <input value={n} onChange={e => setN(e.target.value)} placeholder="Es: Maria, Marco..." style={{ width: "100%", padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#e8e6e3", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", display: "block", marginBottom: 5 }}>Modalità</label>
        <div style={{ display: "flex", gap: 7 }}>
          {[["face", "👤 Solo Viso", "Mantiene il volto"], ["full", "🧍 Corpo Intero", "Mantiene corporatura"]].map(([id, l, d]) => (
            <button key={id} onClick={() => setM(id)} style={{ flex: 1, padding: "9px 10px", borderRadius: 8, border: "1px solid", borderColor: m === id ? "rgba(201,164,97,0.5)" : "rgba(255,255,255,0.08)", background: m === id ? "rgba(201,164,97,0.08)" : "transparent", color: m === id ? "#e8d5a8" : "#6b6f85", cursor: "pointer", textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{l}</div>
              <div style={{ fontSize: 10, marginTop: 1, opacity: 0.7 }}>{d}</div>
            </button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", display: "block", marginBottom: 5 }}>Immagine</label>
        <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
          <button onClick={() => setSrc("upload")} style={{ flex: 1, padding: "7px", borderRadius: 7, border: "1px solid", borderColor: src === "upload" ? "rgba(201,164,97,0.4)" : "rgba(255,255,255,0.08)", background: src === "upload" ? "rgba(201,164,97,0.06)" : "transparent", color: src === "upload" ? "#e8d5a8" : "#6b6f85", cursor: "pointer", fontSize: 11, fontWeight: 500 }}>📤 Carica</button>
          <button onClick={() => setSrc("generate")} style={{ flex: 1, padding: "7px", borderRadius: 7, border: "1px solid", borderColor: src === "generate" ? "rgba(201,164,97,0.4)" : "rgba(255,255,255,0.08)", background: src === "generate" ? "rgba(201,164,97,0.06)" : "transparent", color: src === "generate" ? "#e8d5a8" : "#6b6f85", cursor: "pointer", fontSize: 11, fontWeight: 500 }}>✨ Genera AI</button>
        </div>
        {src === "upload" ? (
          <div onClick={() => fr.current?.click()} style={{ padding: 20, borderRadius: 10, textAlign: "center", border: "2px dashed rgba(255,255,255,0.1)", cursor: "pointer", minHeight: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#4a4e62", backgroundImage: img ? `url(${img})` : "none", backgroundSize: "cover", backgroundPosition: "center" }}>
            {!img && <><div style={{ fontSize: 20, marginBottom: 6 }}>📷</div><span style={{ fontSize: 11 }}>Clicca per caricare</span></>}
            <input ref={fr} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
          </div>
        ) : (
          <div>
            <textarea value={gp} onChange={e => setGp(e.target.value)} placeholder="Descrivi il personaggio..." style={{ width: "100%", minHeight: 50, padding: "8px 10px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#e8e6e3", fontSize: 12, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
            <button style={{ marginTop: 6, padding: "6px 14px", borderRadius: 7, border: "none", background: "rgba(201,164,97,0.2)", color: "#e8d5a8", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✨ Genera Aspetto</button>
          </div>
        )}
      </div>
      <button onClick={() => n.trim() && onAdd(n, img, m)} disabled={!n.trim()} style={{ width: "100%", padding: "11px", borderRadius: 9, border: "none", background: n.trim() ? "linear-gradient(135deg, #c9a461, #b8934e)" : "rgba(255,255,255,0.05)", color: n.trim() ? "#0a0a0f" : "#4a4e62", fontWeight: 700, fontSize: 13, cursor: n.trim() ? "pointer" : "not-allowed" }}>Aggiungi Personaggio</button>
    </div>
  );
}
