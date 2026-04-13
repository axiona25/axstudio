# RunPod Serverless Worker — FaceSwap Pro

Worker serverless per RunPod che esegue face swap avanzato con body matching, hair transfer, e blending naturale.

## Funzionalità

| Feature | Descrizione |
|---|---|
| **Face Swap** | InsightFace + inswapper_128 per sostituzione volto |
| **Hair Transfer** | Segmentazione BiSeNet per copiare i capelli dal source |
| **Body Matching** | Color transfer LAB del tono pelle dal body reference |
| **Skin Color Match** | Adattamento tono pelle volto ↔ corpo nel target |
| **Lighting Match** | Histogram matching luminanza + CLAHE adattivo |
| **Poisson Blending** | cv2.seamlessClone per bordi invisibili |
| **Face Restoration** | CodeFormer (fidelity 0.7) o GFPGAN |
| **Upscale** | Lanczos4 (Real-ESRGAN opzionale) |

## Pipeline di Processing

```
Source Image ──┐
               ├─→ Face Swap ─→ Hair Transfer ─→ Skin Color Match
Target Image ──┘         │            │                  │
                         ▼            ▼                  ▼
                   Lighting Match ─→ Poisson Blend ─→ Face Restore
                         │
Body Reference ──────────┴─→ Body Color Match ─→ Output
```

## API

### Input

```json
{
  "input": {
    "source_image": "base64",
    "target_image": "base64",
    "body_reference": "base64 (opzionale)",
    "source_indexes": "0",
    "target_indexes": "0",
    "face_restore": true,
    "face_restore_model": "CodeFormer",
    "codeformer_fidelity": 0.7,
    "skin_color_match": true,
    "lighting_match": true,
    "hair_transfer": true,
    "blend_method": "poisson",
    "blend_radius": 15,
    "body_match": true,
    "output_format": "PNG",
    "upscale": 1
  }
}
```

### Output

```json
{
  "output": {
    "image": "base64",
    "status": "ok",
    "faces_detected": 1,
    "face_swapped_index": 0,
    "faces_swapped": 1,
    "hair_transferred": true,
    "body_matched": true
  }
}
```

### Parametri

| Parametro | Tipo | Default | Descrizione |
|---|---|---|---|
| `source_image` | string | *required* | Foto del personaggio (base64) |
| `target_image` | string | *required* | Immagine generata da FLUX (base64) |
| `body_reference` | string | null | Foto full-body del personaggio (base64) |
| `source_indexes` | string | "0" | Indice volto nel source (multi: "0,1") |
| `target_indexes` | string | "0" | Indice volto nel target da sostituire |
| `face_restore` | bool | true | Attiva face restoration |
| `face_restore_model` | string | "CodeFormer" | "CodeFormer" o "GFPGAN" |
| `codeformer_fidelity` | float | 0.7 | 0.0=qualità max, 1.0=fedeltà max |
| `skin_color_match` | bool | true | Match tono pelle volto/corpo |
| `lighting_match` | bool | true | Adatta illuminazione volto alla scena |
| `hair_transfer` | bool | true | Trasferisci capelli dal source |
| `blend_method` | string | "poisson" | "poisson" o "alpha" |
| `blend_radius` | int | 15 | Raggio sfumatura bordi |
| `body_match` | bool | true | Match colore corpo da reference |
| `output_format` | string | "PNG" | "PNG" o "JPEG" |
| `upscale` | int | 1 | Fattore di upscale (1=nessuno) |

## Deployment

### Build & Push

```bash
docker build -t USERNAME/faceswap-pro:1.0.0 .
docker push USERNAME/faceswap-pro:1.0.0
```

### RunPod Setup

1. RunPod Console → Serverless → New Endpoint
2. Container Image: `USERNAME/faceswap-pro:1.0.0`
3. GPU: **24 GB Pro** (RTX 4090 / A5000)
4. Container Disk: **20 GB**
5. Idle Timeout: 60s (per cold start veloce)

### Test Locale

```bash
# Con RunPod CLI
runpodctl test --input test_input.json

# Oppure con Python
python3 -c "
import json, requests
with open('test_input.json') as f:
    data = json.load(f)
r = requests.post('https://api.runpod.ai/v2/YOUR_ENDPOINT/runsync',
    json=data,
    headers={'Authorization': 'Bearer YOUR_API_KEY'})
print(r.json())
"
```

## Integrazione AI Studio

Sostituire l'endpoint face swap attuale con il nuovo endpoint RunPod.
L'API è retrocompatibile con i parametri base (`source_image`, `target_image`, `source_indexes`, `target_indexes`) e aggiunge i parametri avanzati.

## Note Tecniche

- **Poisson blending** (`cv2.seamlessClone`) è la chiave per risultati naturali
- **LAB color space** produce color matching migliore di RGB
- `blend_radius` controlla la morbidezza della transizione volto/corpo
- **CodeFormer fidelity 0.7** bilancia qualità e fedeltà al volto
- Il **hair transfer** usa BiSeNet per segmentare i capelli e li warpa con affine transform
- Il **body matching** trasferisce il tono pelle dal `body_reference` alle parti visibili del corpo
- Testare con immagini di diverse illuminazioni per verificare il lighting match
