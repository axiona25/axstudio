# ComfyUI FLUX + IP-Adapter - RunPod Serverless

Endpoint serverless per generazione immagini con FLUX.1-dev e IP-Adapter.
Mantiene l'identità del volto da una foto di riferimento.

## Modelli inclusi
- FLUX.1-dev (fp8)
- IP-Adapter FLUX (InstantX/Shakker-Labs)
- SigLIP Vision (google/siglip-so400m-patch14-384)

## Custom Nodes
- ComfyUI-IPAdapter-Flux

## Deploy
Push su main → GitHub Actions builda e pusha su Docker Hub → Deploy su RunPod Serverless
