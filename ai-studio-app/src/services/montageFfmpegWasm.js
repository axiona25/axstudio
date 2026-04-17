/**
 * Montaggio MP4 in browser via ffmpeg.wasm — preflight CORS, path locali Electron, trim per segmento, concat copy/re-encode.
 */

import { buildFfmpegScalePadFpsFilter } from "./videoRenderProfiles.js";

const TRIM_EPS_SEC = 0.12;

function isHttpOrBlob(url) {
  const u = String(url || "").trim();
  return u.startsWith("blob:") || /^https?:\/\//i.test(u);
}

/**
 * @param {string} url
 * @returns {string|null}
 */
function localPathFromMontageUrl(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  if (u.startsWith("file://")) {
    try {
      const { pathname } = new URL(u);
      if (pathname.startsWith("/") && /^\/[A-Za-z]:/.test(pathname)) {
        return decodeURIComponent(pathname.slice(1));
      }
      return decodeURIComponent(pathname);
    } catch {
      return null;
    }
  }
  if (!isHttpOrBlob(u)) return u;
  return null;
}

/**
 * @param {string} videoUrl
 * @param {(u: string) => Promise<Uint8Array>} fetchFile
 */
async function fetchMontageClipBytes(videoUrl, fetchFile) {
  const u = String(videoUrl || "").trim();
  if (!u) throw new Error("URL clip vuoto.");
  if (isHttpOrBlob(u)) {
    return fetchFile(u);
  }
  if (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.loadFile === "function") {
    const path = localPathFromMontageUrl(u);
    if (!path) throw new Error("Percorso locale clip non valido per Electron.");
    const res = await window.electronAPI.loadFile(path);
    if (!res?.success) throw new Error(res?.error || "electron_loadFile_failed");
    const b64 = res.data;
    const binStr = atob(String(b64));
    const n = binStr.length;
    const arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) arr[i] = binStr.charCodeAt(i);
    return arr;
  }
  return fetchFile(u);
}

/**
 * Verifica fetch CORS (Range minimale) o file locale Electron.
 * @param {string} url
 * @returns {Promise<{ fetchable: boolean, status?: number, error?: string, likelyCors?: boolean, note?: string }>}
 */
/**
 * Mux video remoto (es. I2V senza traccia utile) + audio remoto (mix voce/bed) → MP4 con AAC.
 * Usato dalla pipeline Scenografie per clip cinematic: Kling O3 non riceve l'audio del mix.
 *
 * @param {{
 *   videoUrl: string,
 *   audioUrl: string,
 *   onProgress?: (msg: string) => void,
 *   renderProfile?: { width?: number, height?: number, fps?: number, x264Preset?: string, x264Crf?: number, audioBitrateK?: number, mode?: string } | null,
 * }} params
 * @returns {Promise<Blob>}
 */
export async function muxVideoUrlWithAudioUrlToMp4Blob(params) {
  const videoUrl = String(params?.videoUrl || "").trim();
  const audioUrl = String(params?.audioUrl || "").trim();
  const onProgress = params?.onProgress;
  const renderProfile = params?.renderProfile && typeof params.renderProfile === "object" ? params.renderProfile : null;
  if (!videoUrl || !audioUrl) throw new Error("mux: URL video o audio mancanti.");

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
  onProgress?.("Carico ffmpeg.wasm (mux)…");
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  onProgress?.("Scarico video…");
  const vData = await fetchMontageClipBytes(videoUrl, fetchFile);
  await ffmpeg.writeFile("vin.mp4", vData);

  onProgress?.("Scarico audio…");
  const aData = await fetchMontageClipBytes(audioUrl, fetchFile);
  const aLower = audioUrl.toLowerCase();
  const aExt = aLower.includes(".mp3")
    ? "mp3"
    : aLower.includes(".wav")
      ? "wav"
      : aLower.includes(".m4a")
        ? "m4a"
        : "bin";
  await ffmpeg.writeFile(`ain.${aExt}`, aData);

  const usePreviewEncode =
    renderProfile &&
    renderProfile.mode === "preview" &&
    typeof renderProfile.width === "number" &&
    typeof renderProfile.height === "number" &&
    renderProfile.width > 0 &&
    renderProfile.height > 0;

  onProgress?.("Mux audio + video…");
  if (usePreviewEncode) {
    const vf = buildFfmpegScalePadFpsFilter({
      width: renderProfile.width,
      height: renderProfile.height,
      fps: renderProfile.fps || 24,
    });
    const preset = String(renderProfile.x264Preset || "ultrafast");
    const crf = String(renderProfile.x264Crf ?? 26);
    const ab = `${renderProfile.audioBitrateK ?? 128}k`;
    onProgress?.(
      `Preview clip (${String(renderProfile.previewTier || "fast")}): encode ${renderProfile.width}×${renderProfile.height}…`,
    );
    await ffmpeg.exec([
      "-i",
      "vin.mp4",
      "-i",
      `ain.${aExt}`,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      "-c:a",
      "aac",
      "-b:a",
      ab,
      "-shortest",
      "out.mp4",
    ]);
  } else {
    try {
      await ffmpeg.exec([
        "-i",
        "vin.mp4",
        "-i",
        `ain.${aExt}`,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "out.mp4",
      ]);
    } catch {
      onProgress?.("Mux copy fallito — re-encode video…");
      await ffmpeg.exec([
        "-i",
        "vin.mp4",
        "-i",
        `ain.${aExt}`,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "out.mp4",
      ]);
    }
  }

  const out = await ffmpeg.readFile("out.mp4");
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out);
  return new Blob([u8], { type: "video/mp4" });
}

/**
 * Ricodifica un MP4 remoto (es. Kling Avatar) verso il profilo preview locale — risoluzione/fps/bitrate bozza.
 *
 * @param {{
 *   videoUrl: string,
 *   onProgress?: (msg: string) => void,
 *   renderProfile: { width: number, height: number, fps?: number, x264Preset?: string, x264Crf?: number, audioBitrateK?: number },
 * }} params
 * @returns {Promise<Blob>}
 */
export async function transcodeVideoUrlToProfileMp4Blob(params) {
  const videoUrl = String(params?.videoUrl || "").trim();
  const onProgress = params?.onProgress;
  const renderProfile = params?.renderProfile && typeof params.renderProfile === "object" ? params.renderProfile : null;
  if (!videoUrl) throw new Error("transcode: URL video mancante.");
  if (!renderProfile?.width || !renderProfile?.height) throw new Error("transcode: renderProfile dimensioni mancanti.");

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
  onProgress?.("Carico ffmpeg.wasm (preview clip)…");
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  onProgress?.("Scarico video provider…");
  const vData = await fetchMontageClipBytes(videoUrl, fetchFile);
  await ffmpeg.writeFile("vin.mp4", vData);

  const vf = buildFfmpegScalePadFpsFilter({
    width: renderProfile.width,
    height: renderProfile.height,
    fps: renderProfile.fps || 24,
  });
  const preset = String(renderProfile.x264Preset || "ultrafast");
  const crf = String(renderProfile.x264Crf ?? 26);
  const ab = `${renderProfile.audioBitrateK ?? 128}k`;

  onProgress?.(
    `Preview clip (${String(renderProfile.previewTier || "fast")}): encode ${renderProfile.width}×${renderProfile.height}…`,
  );
  await ffmpeg.exec([
    "-i",
    "vin.mp4",
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    crf,
    "-c:a",
    "aac",
    "-b:a",
    ab,
    "out.mp4",
  ]);

  const out = await ffmpeg.readFile("out.mp4");
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out);
  return new Blob([u8], { type: "video/mp4" });
}

export async function preflightMontageVideoUrl(url) {
  const u = String(url || "").trim();
  if (!u) return { fetchable: false, error: "empty_url" };
  if (u.startsWith("blob:")) return { fetchable: true, status: 0, note: "blob" };

  if (
    typeof window !== "undefined" &&
    window.electronAPI &&
    typeof window.electronAPI.fileExists === "function" &&
    !isHttpOrBlob(u)
  ) {
    const path = localPathFromMontageUrl(u) || u;
    try {
      const ok = await window.electronAPI.fileExists(path);
      if (ok) return { fetchable: true, status: 0, note: "electron_local_path" };
      return { fetchable: false, error: "local_file_not_found" };
    } catch (e) {
      return { fetchable: false, error: e?.message || "electron_file_check_failed" };
    }
  }

  if (u.startsWith("file://") && !(typeof window !== "undefined" && window.electronAPI?.fileExists)) {
    return { fetchable: false, error: "file_url_browser_not_supported" };
  }

  try {
    const r = await fetch(u, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      headers: { Range: "bytes=0-4095" },
    });
    if (r.ok || r.status === 206) return { fetchable: true, status: r.status };
    return { fetchable: false, error: `HTTP ${r.status}` };
  } catch (e) {
    return {
      fetchable: false,
      error: e?.message || "fetch_failed",
      likelyCors: true,
    };
  }
}

/**
 * @param {string[]} urls
 * @returns {Promise<{ results: object[], allFetchable: boolean, blockingUrl: string|null }>}
 */
export async function preflightMontageClipUrls(urls) {
  const list = (urls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const results = [];
  for (const url of list) {
    results.push({ url, ...(await preflightMontageVideoUrl(url)) });
  }
  const bad = results.find((x) => !x.fetchable);
  return {
    results,
    allFetchable: !bad,
    blockingUrl: bad ? bad.url : null,
  };
}

/**
 * @param {object} params
 * @param {{ index: number, videoUrl: string, trimDurationSec: number|null, fileDurationSec: number|null }[]} params.segments
 * @param {object} [params.deliveryProfile] — se `isFinal`, second pass encode verso risoluzione consegna (non usare per preview clip).
 * @param {object} [params.deliveryMeta] — metadati richiesta/fallback (passthrough in output).
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<{ blob: Blob, renderModeUsed: string, segmentResults: object[], concatHadToReencode: boolean, deliveryEncode?: boolean, deliveryMeta?: object|null }>}
 */
export async function renderMontageWithFfmpegWasm(params, onProgress) {
  const segments = Array.isArray(params?.segments) ? params.segments : [];
  if (!segments.length) throw new Error("Nessun segmento montaggio.");
  const deliveryProfile =
    params?.deliveryProfile && params.deliveryProfile.isFinal === true ? params.deliveryProfile : null;
  const deliveryMetaPassThrough =
    params?.deliveryMeta && typeof params.deliveryMeta === "object" ? { ...params.deliveryMeta } : null;

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => {
    if (message && onProgress && /error|concat|stream|frame|trim/i.test(message)) {
      onProgress(String(message).slice(0, 160));
    }
  });

  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
  onProgress?.("Carico ffmpeg.wasm…");
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  const segmentResults = [];
  const concatNames = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] || {};
    const url = String(seg.videoUrl || "").trim();
    if (!url) throw new Error(`Segmento ${i}: URL vuoto.`);
    onProgress?.(`Scarico clip ${i + 1}/${segments.length}…`);
    const data = await fetchMontageClipBytes(url, fetchFile);
    const rawName = `raw${i}.mp4`;
    await ffmpeg.writeFile(rawName, data);

    const fileDur =
      typeof seg.fileDurationSec === "number" && Number.isFinite(seg.fileDurationSec) && seg.fileDurationSec > 0
        ? seg.fileDurationSec
        : null;
    const trimDur =
      typeof seg.trimDurationSec === "number" && Number.isFinite(seg.trimDurationSec) && seg.trimDurationSec > 0
        ? seg.trimDurationSec
        : null;

    const shouldTrim = trimDur != null && fileDur != null && trimDur + TRIM_EPS_SEC < fileDur;

    const outName = `part${i}.mp4`;
    let trimMode = "none";
    let trimApplied = false;

    if (shouldTrim) {
      const t = Math.max(0.1, Math.round(trimDur * 1000) / 1000);
      onProgress?.(`Trim segmento ${i + 1} a ~${t}s (copy)…`);
      try {
        await ffmpeg.exec(["-i", rawName, "-t", String(t), "-c", "copy", outName]);
        trimMode = "time_limit_copy";
        trimApplied = true;
      } catch {
        onProgress?.(`Trim copy fallito seg ${i + 1} — re-encode…`);
        await ffmpeg.exec([
          "-i",
          rawName,
          "-t",
          String(t),
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          outName,
        ]);
        trimMode = "time_limit_reencode";
        trimApplied = true;
      }
    } else {
      await ffmpeg.writeFile(outName, data);
      trimMode =
        fileDur && trimDur && trimDur + TRIM_EPS_SEC >= fileDur ? "full_clip_no_trim_needed" : "full_clip_fallback";
    }

    concatNames.push(outName);
    segmentResults.push({
      index: i,
      trimApplied,
      trimMode,
      trimDurationSec: shouldTrim ? trimDur : null,
      fileDurationSec: fileDur,
    });
  }

  const listBody = concatNames.map((n) => `file '${n}'`).join("\n");
  await ffmpeg.writeFile("concat.txt", listBody);

  onProgress?.("Concatenazione (copy)…");
  let concatHadToReencode = false;
  let renderModeUsed = "concat_copy";
  try {
    await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "out.mp4"]);
  } catch {
    onProgress?.("Concat copy fallito — re-encode finale…");
    concatHadToReencode = true;
    renderModeUsed = "concat_reencode";
    await ffmpeg.exec([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "concat.txt",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "out.mp4",
    ]);
  }

  if (!concatHadToReencode && segmentResults.some((s) => s.trimMode === "time_limit_reencode")) {
    renderModeUsed = "per_segment_reencode_then_concat_copy";
  } else if (!concatHadToReencode) {
    renderModeUsed = segmentResults.some((s) => s.trimApplied) ? "trim_then_concat_copy" : "concat_copy";
  }

  if (
    deliveryProfile &&
    typeof deliveryProfile.width === "number" &&
    typeof deliveryProfile.height === "number" &&
    deliveryProfile.width > 0 &&
    deliveryProfile.height > 0
  ) {
    onProgress?.(
      `Filmato finale: encode consegna ${deliveryProfile.width}×${deliveryProfile.height} @ ${deliveryProfile.fps || 24}fps…`,
    );
    const vf = buildFfmpegScalePadFpsFilter({
      width: deliveryProfile.width,
      height: deliveryProfile.height,
      fps: deliveryProfile.fps || 24,
    });
    const preset = String(deliveryProfile.x264Preset || "medium");
    const crf = String(deliveryProfile.x264Crf ?? 19);
    const ab = `${deliveryProfile.audioBitrateK ?? 256}k`;
    const fpsStr = String(deliveryProfile.fps || 24);
    await ffmpeg.exec([
      "-i",
      "out.mp4",
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      "-r",
      fpsStr,
      "-c:a",
      "aac",
      "-b:a",
      ab,
      "out_delivery.mp4",
    ]);
    const deliveryOut = await ffmpeg.readFile("out_delivery.mp4");
    const du8 = deliveryOut instanceof Uint8Array ? deliveryOut : new Uint8Array(deliveryOut);
    const blob = new Blob([du8], { type: "video/mp4" });
    return {
      blob,
      renderModeUsed: `${renderModeUsed}+final_delivery_encode`,
      segmentResults,
      concatHadToReencode,
      deliveryEncode: true,
      deliveryMeta: deliveryMetaPassThrough,
    };
  }

  const out = await ffmpeg.readFile("out.mp4");
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out);
  const blob = new Blob([u8], { type: "video/mp4" });
  return { blob, renderModeUsed, segmentResults, concatHadToReencode, deliveryEncode: false, deliveryMeta: deliveryMetaPassThrough };
}

/**
 * @param {string[]} orderedVideoUrls
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function concatMp4UrlsWithFfmpegWasm(orderedVideoUrls, onProgress) {
  const urls = (orderedVideoUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const segments = urls.map((videoUrl, index) => ({
    index,
    videoUrl,
    trimDurationSec: null,
    fileDurationSec: null,
  }));
  const { blob } = await renderMontageWithFfmpegWasm({ segments }, onProgress);
  return blob;
}
