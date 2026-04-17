import { useState, useEffect, useRef } from "react";

// ── RunPod Serverless API Config ──
const RUNPOD_API_URL = "https://api.runpod.ai/v2/kdpat0w70yx2x2";
const RUNPOD_API_KEY = process.env.REACT_APP_RUNPOD_API_KEY || "";

// ── FaceSwap Pro Endpoint ──
const FACESWAP_API_URL = "https://api.runpod.ai/v2/rvbbvrqahjgoz1";

// ── Storage helpers ──
const loadState = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const saveState = (key, val) => localStorage.setItem(key, JSON.stringify(val));

// ── FaceSwap Pro helper ──
async function applyFaceSwap(generatedImageB64, character, onStatus) {
  try {
    onStatus("faceswap");

    // Remove data URI prefix if present
    const cleanB64 = (b64) => b64.includes(",") ? b64.split(",")[1] : b64;

    const body = {
      input: {
        source_image: cleanB64(character.image),
        target_image: cleanB64(generatedImageB64),
        source_indexes: "0",
        target_indexes: "0",
        face_restore: true,
        face_restore_model: "CodeFormer",
        codeformer_fidelity: 0.7,
        skin_color_match: true,
        lighting_match: true,
        hair_transfer: true,
        blend_method: "poisson",
        blend_radius: 15,
        body_match: character.mode === "full",
        body_reference: character.mode === "full" ? cleanB64(character.image) : null,
        output_format: "PNG",
        upscale: 1,
      },
    };

    const res = await fetch(`${FACESWAP_API_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RUNPOD_API_KEY}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.id) {
      console.error("FaceSwap error:", data);
      return generatedImageB64;
    }

    // Poll for result
    const poll = () =>
      new Promise((resolve) => {
        const check = async () => {
          const sr = await fetch(`${FACESWAP_API_URL}/status/${data.id}`, {
            headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
          });
          const status = await sr.json();
          if (status.status === "COMPLETED") {
            const output = status.output?.output || status.output;
            if (output?.image) {
              resolve(`data:image/png;base64,${output.image}`);
            } else {
              console.error("FaceSwap: no image in output", status);
              resolve(generatedImageB64);
            }
          } else if (status.status === "FAILED") {
            console.error("FaceSwap failed:", status.error);
            resolve(generatedImageB64);
          } else {
            setTimeout(check, 3000);
          }
        };
        setTimeout(check, 5000);
      });

    return await poll();
  } catch (e) {
    console.error("FaceSwap error:", e);
    return generatedImageB64;
  }
}

// ── Main App ──
export default function AIStudio() {
  const [view, setView] = useState("home");
  const [projects, setProjects] = useState(() => loadState("ai_projects", []));
  const [currentProject, setCurrentProject] = useState(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewCharacter, setShowNewCharacter] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
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

  useEffect(() => { saveState("ai_projects", projects); }, [projects]);

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

  const addCharacter = (name, imageData, mode) => {
    if (!currentProject) return;
    const c = { id: Date.now().toString(), name, image: imageData, mode, createdAt: new Date().toISOString() };
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

  return (
    <div style={st.wrap}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}} textarea:focus,input:focus{border-color:rgba(201,164,97,0.3)!important} ::selection{background:rgba(201,164,97,0.3)} ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px}`}</style>

      {/* Header */}
      <header style={st.hdr}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BackBtn />
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 21, fontWeight: 600, background: "linear-gradient(135deg, #c9a461, #e8d5a8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>AI Studio</h1>
          <span style={{ fontSize: 10, color: "#444", marginTop: 3 }}>by IT Values</span>
        </div>
        <StatusDot />
      </header>

      <main style={st.main}>
        {/* ═══ HOME ═══ */}
        {view === "home" && <>
          <div style={{ textAlign: "center", marginBottom: 44, paddingTop: 16 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, fontWeight: 500, marginBottom: 10, color: "#f0ece4" }}>Crea senza limiti</h2>
            <p style={{ color: "#6b6f85", fontSize: 14, maxWidth: 480, margin: "0 auto" }}>Immagini, video e voci AI — powered by GPU Cloud, nessuna censura, totale libertà creativa.</p>
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

          {activeTab === "image" && <ImgGen {...{ prompt, setPrompt, negPrompt, setNegPrompt, resolution, setResolution, generating, setGenerating, genStatus, setGenStatus, generatedImages, setGeneratedImages, selectedCharacter, scenes }} />}
          {activeTab === "video" && <VidGen {...{ videoPrompt, setVideoPrompt, videoDuration, setVideoDuration, videoResolution, setVideoResolution, generating, setGenerating, selectedCharacter, vidTemplates }} />}
          {activeTab === "voice" && <VoiceGen />}
        </>}

        {/* ═══ FREE IMAGE ═══ */}
        {view === "free-image" && <>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 600, color: "#f0ece4", marginBottom: 22 }}>Immagine Libera</h2>
          <ImgGen {...{ prompt, setPrompt, negPrompt, setNegPrompt, resolution, setResolution, generating, setGenerating, genStatus, setGenStatus, generatedImages, setGeneratedImages, selectedCharacter: null, scenes }} />
        </>}

        {/* ═══ FREE VIDEO ═══ */}
        {view === "free-video" && <>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 600, color: "#f0ece4", marginBottom: 22 }}>Video Libero</h2>
          <VidGen {...{ videoPrompt, setVideoPrompt, videoDuration, setVideoDuration, videoResolution, setVideoResolution, generating, setGenerating, selectedCharacter: null, vidTemplates }} />
        </>}
      </main>

      {showNewProject && <Modal title="Nuovo Progetto" onClose={() => setShowNewProject(false)}><NewProjectForm onCreate={createProject} /></Modal>}
      {showNewCharacter && <Modal title="Nuovo Personaggio" onClose={() => setShowNewCharacter(false)}><NewCharForm onAdd={addCharacter} /></Modal>}
    </div>
  );
}

// ── Image Generator ──
function ImgGen({ prompt, setPrompt, negPrompt, setNegPrompt, resolution, setResolution, generating, setGenerating, genStatus, setGenStatus, generatedImages, setGeneratedImages, selectedCharacter, scenes }) {
  const [tmpl, setTmpl] = useState(null);
  const [adv, setAdv] = useState(false);
  const [steps, setSteps] = useState(4);
  const [cfg, setCfg] = useState(1.0);

  const generate = async () => {
    setGenerating(true);
    setGenStatus("generating");
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

      // Send to RunPod Serverless (ComfyUI/FLUX)
      const res = await fetch(`${RUNPOD_API_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RUNPOD_API_KEY}` },
        body: JSON.stringify({ input: { workflow: wf } }),
      });
      const data = await res.json();

      if (data.id) {
        // Poll for FLUX result
        const poll = async () => {
          const sr = await fetch(`${RUNPOD_API_URL}/status/${data.id}`, {
            headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` },
          });
          const status = await sr.json();
          if (status.status === "COMPLETED") {
            let imgB64 = null;
            if (status.output?.images) {
              imgB64 = `data:image/png;base64,${status.output.images[0].image}`;
            } else if (status.output?.message) {
              imgB64 = `data:image/png;base64,${status.output.message}`;
            }

            if (imgB64) {
              // ── Auto Face Swap if character selected with image ──
              if (selectedCharacter?.image) {
                setGenStatus("faceswap");
                const swappedImg = await applyFaceSwap(imgB64, selectedCharacter, setGenStatus);
                setGeneratedImages(p => [swappedImg, ...p]);
              } else {
                setGeneratedImages(p => [imgB64, ...p]);
              }
            }
            setGenerating(false);
            setGenStatus("");
          } else if (status.status === "FAILED") {
            console.error("Generation failed:", status.error);
            setGenerating(false);
            setGenStatus("");
          } else {
            setTimeout(poll, 3000);
          }
        };
        setTimeout(poll, 5000);
      } else {
        console.error("RunPod error:", data);
        setGenerating(false);
        setGenStatus("");
      }
    } catch (e) { console.error(e); setGenerating(false); setGenStatus(""); }
  };

  const statusLabel = genStatus === "faceswap"
    ? "🎭 Face Swap + Body Match..."
    : genStatus === "generating"
    ? "⚡ Generazione FLUX..."
    : "Generazione...";

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
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#e8d5a8" }}>Personaggio: {selectedCharacter.name}</div>
            <div style={{ fontSize: 10, color: "#8b8fa3" }}>
              {selectedCharacter.mode === "face" ? "Viso + Capelli" : "Corpo Intero + Viso + Capelli"}
              {selectedCharacter.image ? " • Face Swap attivo" : " • Carica foto per Face Swap"}
            </div>
          </div>
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

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 22 }}>
        <div>
          <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Risoluzione</label>
          <div style={{ display: "flex", gap: 5 }}>
            {["512x512", "768x768", "1024x1024", "1280x720", "720x1280"].map(r => (
              <button key={r} onClick={() => setResolution(r)} style={{ padding: "5px 9px", borderRadius: 6, fontSize: 10, fontWeight: 500, border: "1px solid", cursor: "pointer", borderColor: resolution === r ? "rgba(201,164,97,0.5)" : "rgba(255,255,255,0.08)", background: resolution === r ? "rgba(201,164,97,0.1)" : "transparent", color: resolution === r ? "#e8d5a8" : "#6b6f85" }}>{r}</button>
            ))}
          </div>
        </div>
        <button onClick={generate} disabled={generating || !prompt.trim()} style={{ flex: 1, padding: "11px 20px", borderRadius: 10, border: "none", background: generating ? "rgba(201,164,97,0.2)" : "linear-gradient(135deg, #c9a461, #b8934e)", color: generating ? "#8b8fa3" : "#0a0a0f", fontWeight: 700, fontSize: 13, cursor: generating ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 42 }}>
          {generating ? <><div style={{ width: 14, height: 14, border: "2px solid rgba(201,164,97,0.3)", borderTopColor: "#c9a461", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />{statusLabel}</> : "⚡ Genera Immagine"}
        </button>
      </div>

      {/* Progress indicator */}
      {generating && selectedCharacter?.image && (
        <div style={{ marginBottom: 18, padding: "12px 16px", borderRadius: 10, background: "rgba(201,164,97,0.04)", border: "1px solid rgba(201,164,97,0.1)" }}>
          <div style={{ display: "flex", gap: 20, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: genStatus === "generating" ? "#c9a461" : "#22c55e", boxShadow: genStatus === "generating" ? "0 0 8px #c9a461" : "none", animation: genStatus === "generating" ? "pulse 1.5s infinite" : "none" }} />
              <span style={{ color: genStatus === "generating" ? "#e8d5a8" : "#22c55e" }}>1. Generazione FLUX</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: genStatus === "faceswap" ? "#c9a461" : genStatus === "" && !generating ? "#22c55e" : "#3a3a4a", boxShadow: genStatus === "faceswap" ? "0 0 8px #c9a461" : "none", animation: genStatus === "faceswap" ? "pulse 1.5s infinite" : "none" }} />
              <span style={{ color: genStatus === "faceswap" ? "#e8d5a8" : "#4a4e62" }}>2. Face Swap + {selectedCharacter.mode === "full" ? "Body Match" : "Hair Transfer"}</span>
            </div>
          </div>
        </div>
      )}

      {generatedImages.length > 0 && (
        <div>
          <h4 style={{ fontSize: 13, color: "#8b8fa3", marginBottom: 10 }}>🖼 Risultati</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
            {generatedImages.map((img, i) => (
              <div key={i} style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", background: "#111" }}>
                <img src={img} alt="" style={{ width: "100%", display: "block" }} onError={e => e.target.style.display = "none"} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Video Generator ──
function VidGen({ videoPrompt, setVideoPrompt, videoDuration, setVideoDuration, videoResolution, setVideoResolution, generating, setGenerating, selectedCharacter, vidTemplates }) {
  const [tmpl, setTmpl] = useState(null);
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

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Descrivi il video</label>
        <textarea value={videoPrompt} onChange={e => setVideoPrompt(e.target.value)} placeholder="Descrivi il video..." style={{ width: "100%", minHeight: 90, padding: "12px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#e8e6e3", fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: "vertical", outline: "none", boxSizing: "border-box" }} />
      </div>

      <div style={{ display: "flex", gap: 18, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: 12, color: "#6b6f85", display: "block", marginBottom: 5 }}>Durata: {videoDuration}s</label>
          <input type="range" min="2" max="15" value={videoDuration} onChange={e => setVideoDuration(+e.target.value)} style={{ width: 180 }} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: "#6b6f85", fontWeight: 500, marginBottom: 5, display: "block" }}>Risoluzione</label>
          <div style={{ display: "flex", gap: 5 }}>
            {[["480x320", "320p"], ["640x480", "480p"], ["1280x720", "720p"], ["1920x1080", "1080p"]].map(([r, l]) => (
              <button key={r} onClick={() => setVideoResolution(r)} style={{ padding: "5px 9px", borderRadius: 6, fontSize: 10, fontWeight: 500, border: "1px solid", cursor: "pointer", borderColor: videoResolution === r ? "rgba(99,133,201,0.5)" : "rgba(255,255,255,0.08)", background: videoResolution === r ? "rgba(99,133,201,0.1)" : "transparent", color: videoResolution === r ? "#a8c1e8" : "#6b6f85" }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <button disabled={generating || !videoPrompt.trim()} style={{ width: "100%", padding: "13px 20px", borderRadius: 10, border: "none", background: generating ? "rgba(99,133,201,0.2)" : "linear-gradient(135deg, #6385c9, #4e6bb8)", color: generating ? "#8b8fa3" : "#fff", fontWeight: 700, fontSize: 14, cursor: generating ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
        {generating ? "Generazione in corso..." : "⚡ Genera Video"}
      </button>

      <div style={{ marginTop: 14, padding: 14, borderRadius: 9, background: "rgba(99,133,201,0.04)", border: "1px solid rgba(99,133,201,0.1)", fontSize: 11, color: "#6b6f85" }}>
        💡 Video generati via GPU Cloud RunPod. Endpoint Wan2.2 da configurare separatamente.
      </div>
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
      <div onClick={e => e.stopPropagation()} style={{ background: "#16162a", borderRadius: 14, padding: 24, border: "1px solid rgba(255,255,255,0.08)", minWidth: 380, maxWidth: 480, width: "90%", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }}>
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
          {[["face", "👤 Solo Viso", "Viso + Capelli"], ["full", "🧍 Corpo Intero", "Viso + Capelli + Corpo"]].map(([id, l, d]) => (
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
