import runpod
import sys

print(f"[TEST] Python {sys.version}")
print("[TEST] Minimal handler starting...")

def handler(event):
    return {"output": {"status": "ok", "message": "Worker is alive!"}}

runpod.serverless.start({"handler": handler})
