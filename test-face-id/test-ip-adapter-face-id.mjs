/**
 * Test rapido: fal-ai/ip-adapter-face-id
 *
 * Scopo: verificare se l'endpoint IP-Adapter Face ID di fal.ai produce
 * un'immagine stilizzata (comic/anime) che mantiene la likeness del volto
 * della persona reale.
 *
 * IMPORTANTE: questo endpoint è text-to-image con face embedding, NON img2img.
 * Non accetta un'immagine target/stilizzata da modificare.
 * Genera da zero un'immagine con il volto della persona nello stile richiesto.
 *
 * Uso:
 *   FAL_KEY=<tua-key> node test-ip-adapter-face-id.mjs <face-photo-url>
 *
 * Esempio:
 *   FAL_KEY=abc123 node test-ip-adapter-face-id.mjs https://example.com/face.jpg
 */

const FAL_KEY = process.env.FAL_KEY || process.env.REACT_APP_FAL_API_KEY || "";
if (!FAL_KEY) {
  console.error("ERROR: set FAL_KEY env var");
  process.exit(1);
}

const faceUrl = process.argv[2] || "";
if (!faceUrl) {
  console.error("Usage: FAL_KEY=... node test-ip-adapter-face-id.mjs <face-photo-url>");
  process.exit(1);
}

// ── Parametri test ──────────────────────────────────────────────────────────

const TESTS = [
  {
    name: "SDXL-comic-hero",
    model_type: "SDXL-v2-plus",
    prompt: [
      "portrait of a comic book superhero, same person as the face reference,",
      "western comic book art style, bold ink outlines, flat graphic colors,",
      "dramatic heroic pose, dynamic shading, cape, emblem on chest,",
      "highly detailed face preserving exact facial features of the reference photo,",
      "high quality, 4k, sharp focus"
    ].join(" "),
    negative_prompt: "photorealistic, photo, realistic skin pores, blurry, low quality, deformed face, different person, changed identity",
    width: 1024,
    height: 1024,
  },
  {
    name: "SDXL-anime",
    model_type: "SDXL-v2-plus",
    prompt: [
      "anime illustration portrait of the same person as the face reference,",
      "clean cel shading, expressive eyes, crisp linework,",
      "vibrant colors, anime art style, stylized but recognizable face,",
      "high quality, detailed, sharp"
    ].join(" "),
    negative_prompt: "photorealistic, photo, blurry, low quality, deformed face, different person",
    width: 1024,
    height: 1024,
  },
  {
    name: "1.5-comic-hero",
    model_type: "1_5-v1-plus",
    prompt: [
      "portrait of a comic book superhero, same person as the face reference,",
      "western comic book art style, bold ink outlines, flat graphic colors,",
      "dramatic heroic pose, dynamic shading,",
      "highly detailed face preserving exact facial features,",
      "high quality, sharp focus"
    ].join(" "),
    negative_prompt: "photorealistic, photo, blurry, low quality, deformed, different person",
    width: 512,
    height: 768,
  },
];

// ── Esecuzione ──────────────────────────────────────────────────────────────

async function runTest(test) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`TEST: ${test.name}`);
  console.log(`Model: ${test.model_type}`);
  console.log(`Prompt: ${test.prompt.slice(0, 80)}...`);
  console.log(`${"═".repeat(60)}`);

  const payload = {
    model_type: test.model_type,
    prompt: test.prompt,
    face_image_url: faceUrl,
    negative_prompt: test.negative_prompt,
    guidance_scale: 7.5,
    num_inference_steps: 50,
    num_samples: 4,
    width: test.width,
    height: test.height,
    face_id_det_size: 640,
  };

  console.log("\nPayload:", JSON.stringify(payload, null, 2));

  const t0 = Date.now();

  try {
    // Step 1: submit to queue
    console.log("\n→ Submitting to queue...");
    const submitRes = await fetch(`https://queue.fal.run/fal-ai/ip-adapter-face-id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${FAL_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      console.error("Submit failed:", submitRes.status, err);
      return;
    }

    const { request_id, status_url, response_url } = await submitRes.json();
    console.log("  request_id:", request_id);

    // Step 2: poll status
    console.log("→ Polling status...");
    let status = "IN_QUEUE";
    while (status !== "COMPLETED") {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(
        `https://queue.fal.run/fal-ai/ip-adapter-face-id/requests/${request_id}/status`,
        { headers: { "Authorization": `Key ${FAL_KEY}` } }
      );
      const statusData = await statusRes.json();
      status = statusData.status;
      console.log(`  status: ${status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

      if (status === "FAILED") {
        console.error("  FAILED:", JSON.stringify(statusData));
        return;
      }
    }

    // Step 3: get result
    const resultRes = await fetch(
      `https://queue.fal.run/fal-ai/ip-adapter-face-id/requests/${request_id}`,
      { headers: { "Authorization": `Key ${FAL_KEY}` } }
    );
    const result = await resultRes.json();

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\n✅ Completed in ${elapsed}s`);
    console.log("Raw response:", JSON.stringify(result, null, 2));

    const imageUrl = result?.image?.url;
    if (imageUrl) {
      console.log(`\n🖼️  Result image: ${imageUrl}`);
      console.log(`   Content type: ${result.image.content_type || "unknown"}`);
      console.log(`   Size: ${result.image.width || "?"}x${result.image.height || "?"}`);
      console.log(`   Seed: ${result.seed || "?"}`);
    } else {
      console.error("❌ No image URL in response!");
    }

  } catch (err) {
    console.error("Exception:", err.message);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  Test IP-Adapter Face ID — fal.ai                          ║");
console.log("╚══════════════════════════════════════════════════════════════╝");
console.log(`\nFace reference: ${faceUrl}`);
console.log(`Tests to run: ${TESTS.length}`);

for (const test of TESTS) {
  await runTest(test);
}

console.log("\n\n" + "═".repeat(60));
console.log("DONE. Check the image URLs above in a browser.");
console.log("═".repeat(60));
