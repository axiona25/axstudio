import os, json, uuid, time, random, urllib.request
from fastapi import FastAPI, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
import websocket

COMFYUI_URL = "http://127.0.0.1:8188"
COMFYUI_OUTPUT = os.path.expanduser("~/Documents/AI_IMAGE&VIDEO/ComfyUI/output")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/", response_class=HTMLResponse)
def homepage():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")) as f:
        return f.read()

def queue_prompt(prompt, client_id):
    data = json.dumps({"prompt": prompt, "client_id": client_id}).encode("utf-8")
    req = urllib.request.Request(f"{COMFYUI_URL}/prompt", data=data, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())

def get_history(prompt_id):
    return json.loads(urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}").read())

def wait_for_completion(prompt_id, client_id, timeout=600):
    ws = websocket.WebSocket()
    ws.connect(f"ws://127.0.0.1:8188/ws?clientId={client_id}")
    start = time.time()
    try:
        while time.time() - start < timeout:
            msg = ws.recv()
            if isinstance(msg, str):
                data = json.loads(msg)
                if data.get("type") == "executing":
                    d = data.get("data", {})
                    if d.get("prompt_id") == prompt_id and d.get("node") is None:
                        return True
        return False
    finally:
        ws.close()

def build_flux_workflow(prompt, width, height, batch_size, seed):
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "flux1-schnell-fp8.safetensors"}},
        "5": {"class_type": "EmptySD3LatentImage", "inputs": {"width": width, "height": height, "batch_size": batch_size}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["4", 1]}},
        "3": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": 4, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "ai_studio", "images": ["8", 0]}}
    }

@app.get("/api/health")
def health():
    try:
        urllib.request.urlopen(f"{COMFYUI_URL}/system_stats")
        return {"status": "ok"}
    except:
        return {"status": "offline"}

@app.post("/api/generate-image")
def generate_image(prompt: str = Form(...), width: int = Form(768), height: int = Form(768), batch_size: int = Form(1), template_prefix: str = Form("")):
    full_prompt = f"{template_prefix} {prompt}".strip() if template_prefix else prompt
    client_id = str(uuid.uuid4())
    seed = random.randint(0, 2**53)
    workflow = build_flux_workflow(full_prompt, width, height, batch_size, seed)
    result = queue_prompt(workflow, client_id)
    if "error" in result:
        raise HTTPException(500, result["error"])
    prompt_id = result["prompt_id"]
    if not wait_for_completion(prompt_id, client_id):
        raise HTTPException(504, "Timeout")
    history = get_history(prompt_id)
    images = []
    for node_id, out in history.get(prompt_id, {}).get("outputs", {}).items():
        if "images" in out:
            for img in out["images"]:
                images.append({"filename": img["filename"], "url": f"/api/output/{img['filename']}"})
    return {"status": "completed", "prompt": full_prompt, "seed": seed, "images": images}

@app.get("/api/output/{filename}")
def get_output(filename: str):
    filepath = os.path.join(COMFYUI_OUTPUT, filename)
    if not os.path.exists(filepath):
        for root, dirs, files in os.walk(COMFYUI_OUTPUT):
            if filename in files:
                filepath = os.path.join(root, filename)
                break
    if not os.path.exists(filepath):
        raise HTTPException(404, "File non trovato")
    return FileResponse(filepath)

@app.get("/api/templates")
def get_templates():
    return {"image_templates": [
        {"id": "product", "name": "Foto Prodotto", "icon": "📦", "description": "Foto prodotto professionale", "prefix": "Professional product photography, clean background, studio lighting, 8k,", "example": "a leather watch on marble surface"},
        {"id": "portrait", "name": "Ritratto Studio", "icon": "👤", "description": "Ritratto con illuminazione professionale", "prefix": "Professional studio portrait, soft lighting, bokeh background, photorealistic, 8k,", "example": "a young woman with curly hair smiling"},
        {"id": "landscape", "name": "Paesaggio Cinematico", "icon": "🏔️", "description": "Paesaggi mozzafiato", "prefix": "Cinematic landscape, dramatic lighting, golden hour, ultra wide, 8k,", "example": "Italian coastline with cliffs and turquoise water"},
        {"id": "fashion", "name": "Fashion Editorial", "icon": "👗", "description": "Moda editoriale stile rivista", "prefix": "High fashion editorial, Vogue style, dramatic pose, professional lighting, 8k,", "example": "a model wearing an elegant red dress in a gallery"},
        {"id": "food", "name": "Food Photography", "icon": "🍝", "description": "Fotografia gastronomica", "prefix": "Professional food photography, appetizing, warm lighting, shallow depth of field, 8k,", "example": "a plate of fresh pasta carbonara"},
        {"id": "architecture", "name": "Architettura", "icon": "🏛️", "description": "Fotografia architettonica", "prefix": "Architectural photography, clean lines, dramatic perspective, 8k,", "example": "a modern minimalist villa with infinity pool"},
        {"id": "fantasy", "name": "Arte Fantasy", "icon": "🐉", "description": "Illustrazioni e concept art", "prefix": "Fantasy concept art, highly detailed, epic composition, digital painting,", "example": "a magical forest with glowing mushrooms"},
        {"id": "logo", "name": "Logo & Grafica", "icon": "✏️", "description": "Loghi e grafiche minimali", "prefix": "Minimalist logo design, clean vector style, simple shapes, professional,", "example": "a coffee shop logo with a stylized cup"}
    ], "video_templates": [
        {"id": "cinematic", "name": "Cinematico", "icon": "🎬", "description": "Scena cinematica", "prefix": "Cinematic shot, smooth camera movement, dramatic lighting, 24fps,", "example": "a woman walking through a sunlit corridor"},
        {"id": "product_reveal", "name": "Product Reveal", "icon": "✨", "description": "Rivelazione prodotto", "prefix": "Product reveal, elegant slow motion, studio lighting, commercial,", "example": "a perfume bottle rotating with light reflections"},
        {"id": "nature", "name": "Natura", "icon": "🌿", "description": "Scene naturali", "prefix": "Nature documentary style, organic motion, natural lighting,", "example": "waves crashing on rocks at sunset"},
        {"id": "urban", "name": "Street / Urban", "icon": "🌃", "description": "Scene urbane", "prefix": "Urban street scene, dynamic, neon lights, night, cinematic,", "example": "a rainy Tokyo street at night with neon reflections"}
    ]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3001)
