#!/bin/bash
# ============================================================
#  SETUP COMPLETO ComfyUI + FLUX.1 schnell + Wan 2.1
#  Per MacBook Pro M4 Pro (24 GB)
#
#  Copia e incolla i blocchi uno alla volta nel Terminale.
#  Tempo totale: ~30 min (dipende dalla velocità internet)
# ============================================================


# ─────────────────────────────────────────────
# FASE 1: Prerequisiti (salta se li hai già)
# ─────────────────────────────────────────────

# 1a. Installa Xcode Command Line Tools
xcode-select --install

# 1b. Installa Homebrew (se non ce l'hai)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 1c. Installa Python 3.11 e Git
brew install python@3.11 git


# ─────────────────────────────────────────────
# FASE 2: Installa ComfyUI
# ─────────────────────────────────────────────

cd ~/Documents
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI

# Crea ambiente virtuale
python3.11 -m venv venv
source venv/bin/activate

# Installa PyTorch con supporto Metal/MPS
pip install --pre torch torchvision torchaudio \
  --extra-index-url https://download.pytorch.org/whl/nightly/cpu

# Installa dipendenze ComfyUI
pip install -r requirements.txt


# ─────────────────────────────────────────────
# FASE 3: Installa ComfyUI Manager
# ─────────────────────────────────────────────

cd ~/Documents/ComfyUI/custom_nodes
git clone https://github.com/ltdrdata/ComfyUI-Manager.git
cd ~/Documents/ComfyUI
pip install -r custom_nodes/ComfyUI-Manager/requirements.txt


# ─────────────────────────────────────────────
# FASE 4: Verifica che MPS (GPU) funzioni
# ─────────────────────────────────────────────

python -c "import torch; print('MPS disponibile:', torch.backends.mps.is_available())"
# >>> Deve stampare: MPS disponibile: True


# ─────────────────────────────────────────────
# FASE 5: Installa huggingface-cli per download
# ─────────────────────────────────────────────

pip install "huggingface_hub[cli]"


# ─────────────────────────────────────────────
# FASE 6: Scarica FLUX.1 schnell (FOTO)
#          Download totale: ~12 GB
# ─────────────────────────────────────────────

# 6a. Modello UNET (~12 GB) — il cuore del modello
huggingface-cli download black-forest-labs/FLUX.1-schnell \
  flux1-schnell.safetensors \
  --local-dir ~/Documents/ComfyUI/models/unet/

# 6b. Text Encoders / CLIP (~5 GB fp8 + ~250 MB)
#     Usa fp8 perché hai 24 GB (fp16 richiede 32+ GB)
huggingface-cli download comfyanonymous/flux_text_encoders \
  t5xxl_fp8_e4m3fn.safetensors \
  --local-dir ~/Documents/ComfyUI/models/clip/

huggingface-cli download comfyanonymous/flux_text_encoders \
  clip_l.safetensors \
  --local-dir ~/Documents/ComfyUI/models/clip/

# 6c. VAE (~335 MB)
huggingface-cli download black-forest-labs/FLUX.1-schnell \
  ae.safetensors \
  --local-dir ~/Documents/ComfyUI/models/vae/


# ─────────────────────────────────────────────
# FASE 7: Scarica Wan 2.1 T2V 1.3B (VIDEO)
#          Download totale: ~3 GB
# ─────────────────────────────────────────────

# 7a. Modello video 1.3B (quello leggero per i tuoi 24 GB)
huggingface-cli download Wan-AI/Wan2.1-T2V-1.3B \
  --local-dir ~/Documents/ComfyUI/models/diffusion_models/Wan2.1-T2V-1.3B/


# ─────────────────────────────────────────────
# FASE 8: Crea script di avvio rapido
# ─────────────────────────────────────────────

cat > ~/Documents/ComfyUI/start.sh << 'EOF'
#!/bin/bash
cd ~/Documents/ComfyUI
source venv/bin/activate
export PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0
echo ""
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   ComfyUI — AI Studio Locale              ║"
echo "  ║   Apri: http://127.0.0.1:8188             ║"
echo "  ║   Per fermare: Ctrl+C                     ║"
echo "  ╚═══════════════════════════════════════════╝"
echo ""
python main.py --force-fp16
EOF

chmod +x ~/Documents/ComfyUI/start.sh


# ─────────────────────────────────────────────
# FASE 9: PRIMO AVVIO!
# ─────────────────────────────────────────────

~/Documents/ComfyUI/start.sh

# Apri nel browser: http://127.0.0.1:8188
# ComfyUI è pronto!


# ============================================================
#  COME USARE
# ============================================================
#
#  GENERARE FOTO con FLUX.1:
#  1. In ComfyUI, clicca "Load Default" (o trascina un workflow)
#  2. Nel nodo "Load Checkpoint" seleziona flux1-schnell
#     OPPURE usa il workflow Flux dal menu Templates
#  3. Scrivi il prompt nel nodo "CLIP Text Encode"
#  4. Clicca "Queue Prompt" (o premi Ctrl+Enter)
#  5. L'immagine appare nel nodo "Save Image"
#
#  GENERARE VIDEO con Wan 2.1:
#  1. In ComfyUI Manager, cerca "Wan" e installa i nodi necessari
#  2. Carica un workflow Wan 2.1 T2V (dal menu Templates)
#  3. Scrivi il prompt, imposta risoluzione e frames
#  4. Clicca "Queue Prompt"
#  5. Il video viene salvato in ~/Documents/ComfyUI/output/
#
#  AVVII SUCCESSIVI:
#  Apri Terminale e scrivi:
#     ~/Documents/ComfyUI/start.sh
#
# ============================================================
