FROM runpod/worker-comfyui:5.3.0-flux1-dev

# Installa IP-Adapter FLUX custom node
RUN comfy-node-install ComfyUI-IPAdapter-Flux

# Scarica IP-Adapter weights (~1GB)
RUN comfy model download \
    --url https://huggingface.co/InstantX/FLUX.1-dev-IP-Adapter/resolve/main/ip-adapter.bin \
    --relative-path models/ipadapter-flux \
    --filename ip-adapter.bin

# Scarica SigLIP CLIP Vision (~3.5GB)
RUN comfy model download \
    --url https://huggingface.co/google/siglip-so400m-patch14-384/resolve/main/model.safetensors \
    --relative-path models/clip_vision \
    --filename siglib_vision_patch14_384.safetensors

RUN rm -f /comfyui/test_input.json

CMD ["/start.sh"]
