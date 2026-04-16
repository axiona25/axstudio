/**
 * characterMasterReadyForScenes — ready con source migrati (no stallo post-migrazione).
 *   cd ai-studio-app && node test-pcid-migration-ready.mjs
 */

import {
  PCM_SOURCE_USER_CANONICAL_LOCK,
  __resetMigrationReadyLogForTests,
  characterMasterReadyForScenes,
} from "./src/services/scenografieProjectPersistence.js";

const PCID = "pcid_aabb01";
const URL = "https://example.test/master.jpg";

function basePayload(rowOverrides, approvalApproved = true) {
  return {
    projectCharacterMasters: {
      [PCID]: {
        masterImageUrl: URL,
        pendingManualReview: false,
        ...rowOverrides,
      },
    },
    characterApprovalMap: {
      [PCID]: { approved: approvalApproved },
    },
  };
}

function assert(name, cond) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    process.exit(1);
  }
  console.log(`PASS: ${name}`);
}

function main() {
  __resetMigrationReadyLogForTests();

  const char = { id: "char_1", pcid: PCID };

  console.log("--- 1) user_canonical_lock + approved + non-pending ---");
  assert(
    "canonical lock → ready",
    characterMasterReadyForScenes(
      char,
      basePayload({ source: PCM_SOURCE_USER_CANONICAL_LOCK, pendingManualReview: false }),
    ) === true,
  );

  __resetMigrationReadyLogForTests();

  console.log("--- 2) migrated_id_and_name_same_url + approved + non-pending (nuovo comportamento) ---");
  assert(
    "migration same_url → ready",
    characterMasterReadyForScenes(
      char,
      basePayload({ source: "migrated_id_and_name_same_url", pendingManualReview: false }),
    ) === true,
  );

  __resetMigrationReadyLogForTests();

  console.log("--- 3) migrated_id_and_name_same_url + approved + pendingManualReview ---");
  assert(
    "migration ma pending review → NOT ready",
    characterMasterReadyForScenes(
      char,
      basePayload({ source: "migrated_id_and_name_same_url", pendingManualReview: true }),
    ) === false,
  );

  __resetMigrationReadyLogForTests();

  console.log("--- 4) unknown_legacy source (non in whitelist) ---");
  assert(
    "unknown_legacy → NOT ready",
    characterMasterReadyForScenes(
      char,
      basePayload({ source: "unknown_legacy", pendingManualReview: false }),
    ) === false,
  );

  console.log("=== ALL TESTS PASSED ===");
}

main();
