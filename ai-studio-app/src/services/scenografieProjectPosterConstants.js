/** Stati locandina progetto — file separato per evitare dipendenze circolari (persistence ↔ poster). */

export const PROJECT_POSTER_STATUS = {
  NONE: "none",
  PENDING: "pending",
  GENERATING: "generating",
  READY: "ready",
  FAILED: "failed",
};
