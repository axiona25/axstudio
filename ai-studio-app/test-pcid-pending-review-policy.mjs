/**
 * Policy pendingManualReview / source post-migrateProjectToPcidSchema + log riepilogativo.
 *   cd ai-studio-app && node test-pcid-pending-review-policy.mjs
 */

import { migrateProjectToPcidSchema } from "./src/services/scenografieProjectPersistence.js";

const URL_A = "https://example.test/faces/a.jpg";
const URL_B = "https://example.test/faces/b.jpg";
const URL_C = "https://example.test/faces/c.jpg";
const PCID_RE = /^pcid_[0-9a-f]{6}$/;

function assert(name, cond) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    process.exit(1);
  }
  console.log(`PASS: ${name}`);
}

function baseWorkspace(chapterData) {
  return {
    workspaceVersion: 2,
    version: 1,
    chapters: [{ id: "ch1", sortOrder: 0, chapterTitle: "T", data: chapterData }],
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterMasters: {},
    projectCharacterApprovalMap: {},
  };
}

function pcmPcidEntries(out) {
  return Object.entries(out.projectCharacterMasters || {}).filter(([k]) => PCID_RE.test(k));
}

function main() {
  console.log("--- Scenario 1: stesso URL id+nome, approved ---");
  {
    const data = {
      version: 1,
      plan: {
        characters: [{ id: "char_1", name: "Maria", is_protagonist: true }],
        scenes: [{ id: "scene_1", title_it: "S", characters_present: ["char_1"] }],
      },
      masterImages: { char_1: URL_A },
      masterByCharName: { maria: URL_A },
      projectCharacterMasters: {},
      characterApprovalMap: { char_1: { approved: true } },
      sceneVideoClips: [],
      characterVoiceMasters: {},
    };
    const out = migrateProjectToPcidSchema(baseWorkspace(data));
    const rows = pcmPcidEntries(out);
    assert("un solo pcid in pool", rows.length === 1);
    const [, row] = rows[0];
    assert("source migrated_id_and_name_same_url", row.source === "migrated_id_and_name_same_url");
    assert("pendingManualReview false", row.pendingManualReview === false);
  }

  console.log("--- Scenario 2: URL diversi id vs nome ---");
  {
    const data = {
      version: 1,
      plan: {
        characters: [{ id: "char_1", name: "Maria", is_protagonist: true }],
        scenes: [{ id: "scene_1", title_it: "S", characters_present: ["char_1"] }],
      },
      masterImages: { char_1: URL_A },
      masterByCharName: { maria: URL_B },
      projectCharacterMasters: {},
      characterApprovalMap: {},
      sceneVideoClips: [],
      characterVoiceMasters: {},
    };
    const out = migrateProjectToPcidSchema(baseWorkspace(data));
    const [, row] = pcmPcidEntries(out)[0];
    assert("source migrated_id_and_name", row.source === "migrated_id_and_name");
    assert("pendingManualReview true", row.pendingManualReview === true);
  }

  console.log("--- Scenario 3: due personaggi, stesso URL (condiviso) ---");
  {
    const data = {
      version: 1,
      plan: {
        characters: [
          { id: "char_1", name: "Maria", is_protagonist: true },
          { id: "char_2", name: "Giuseppe", is_protagonist: false },
        ],
        scenes: [{ id: "scene_1", title_it: "S", characters_present: ["char_1"] }],
      },
      masterImages: { char_1: URL_A, char_2: URL_A },
      masterByCharName: { maria: URL_A, giuseppe: URL_A },
      projectCharacterMasters: {},
      characterApprovalMap: {},
      sceneVideoClips: [],
      characterVoiceMasters: {},
    };
    const out = migrateProjectToPcidSchema(baseWorkspace(data));
    const rows = pcmPcidEntries(out);
    assert("due pcid", rows.length === 2);
    assert("entrambi pending", rows.every(([, r]) => r.pendingManualReview === true));
  }

  console.log("--- Scenario 4: solo masterByCharName (no masterImages per id) ---");
  {
    const data = {
      version: 1,
      plan: {
        characters: [{ id: "char_1", name: "Maria", is_protagonist: true }],
        scenes: [{ id: "scene_1", title_it: "S", characters_present: ["char_1"] }],
      },
      masterImages: {},
      masterByCharName: { maria: URL_A },
      projectCharacterMasters: {},
      characterApprovalMap: {},
      sceneVideoClips: [],
      characterVoiceMasters: {},
    };
    const out = migrateProjectToPcidSchema(baseWorkspace(data));
    const [, row] = pcmPcidEntries(out)[0];
    assert("source migrated_name_only", row.source === "migrated_name_only");
    assert("pendingManualReview true", row.pendingManualReview === true);
  }

  console.log("--- Scenario 5: tre personaggi coerenti + log una riga ---");
  {
    const data = {
      version: 1,
      plan: {
        characters: [
          { id: "char_1", name: "Maria", is_protagonist: true },
          { id: "char_2", name: "Giuseppe", is_protagonist: false },
          { id: "char_3", name: "Anna", is_protagonist: false },
        ],
        scenes: [{ id: "scene_1", title_it: "S", characters_present: ["char_1"] }],
      },
      masterImages: { char_1: URL_A, char_2: URL_B, char_3: URL_C },
      masterByCharName: { maria: URL_A, giuseppe: URL_B, anna: URL_C },
      projectCharacterMasters: {},
      characterApprovalMap: {},
      sceneVideoClips: [],
      characterVoiceMasters: {},
    };
    const lines = [];
    const orig = console.info;
    console.info = (...a) => {
      const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
      lines.push(line);
      orig(...a);
    };
    try {
      const out = migrateProjectToPcidSchema(baseWorkspace(data));
      const rows = pcmPcidEntries(out);
      assert("tre pcid", rows.length === 3);
      assert("tutti pending false", rows.every(([, r]) => r.pendingManualReview === false));
      const policyLines = lines.filter((l) => l.includes("[PCID MIGRATION · PENDING REVIEW POLICY]"));
      assert("esattamente un log policy", policyLines.length === 1);
      const pl = policyLines[0];
      assert("nonPending=3", pl.includes("nonPending=3"));
      assert("pending=0", pl.includes("pending=0"));
      assert("reasons con same_url x3", pl.includes('"migrated_id_and_name_same_url":3'));
    } finally {
      console.info = orig;
    }
  }

  console.log("=== ALL TESTS PASSED ===");
}

main();
