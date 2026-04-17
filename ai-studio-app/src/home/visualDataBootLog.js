/**
 * Log DEV per il timing hydration / commit dataset visivi (anti flash stale).
 */

function ts() {
  return typeof performance !== "undefined" && performance.now != null ? Math.round(performance.now()) : Date.now();
}

export function logVisualDataBoot(payload) {
  if (process.env.NODE_ENV !== "development") return;
  console.log("[VISUAL_DATA_BOOT]", { ...payload, timestamp: ts() });
}

export function logVisualDataReady(payload) {
  if (process.env.NODE_ENV !== "development") return;
  console.log("[VISUAL_DATA_READY]", { ...payload, timestamp: ts() });
}

export function logVisualDataCommit(payload) {
  if (process.env.NODE_ENV !== "development") return;
  console.log("[VISUAL_DATA_COMMIT]", { ...payload, timestamp: ts() });
}
