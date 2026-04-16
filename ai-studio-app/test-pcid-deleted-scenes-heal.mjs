/**
 * Heal orfani in deletedSceneIds (allineato a plan.scenes).
 *   cd ai-studio-app && node test-pcid-deleted-scenes-heal.mjs
 */

import {
  SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID,
  SCENOGRAFIA_PROJECT_VERSION,
  SCENOGRAFIA_WORKSPACE_VERSION,
  applyScenografiaPcidPostMergeHealOnLoad,
  healOrphanDeletedSceneIdsInChapterData,
} from "./src/services/scenografieProjectPersistence.js";

function assert(name, cond) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    process.exit(1);
  }
  console.log(`PASS: ${name}`);
}

function chapterWithScenes(ids, deleted) {
  return {
    plan: {
      scenes: ids.map((id) => ({ id })),
      characters: [],
    },
    deletedSceneIds: deleted,
  };
}

async function main() {
  console.log("--- Scenario 1: ghost in deleted, scena reale cancellata mantenuta ---");
  {
    const data = chapterWithScenes(["scene_1", "scene_2", "scene_3"], ["scene_2", "scene_4_ghost"]);
    const { wasHealed } = healOrphanDeletedSceneIdsInChapterData(data);
    assert("wasHealed true", wasHealed === true);
    assert("deleted solo scene_2", JSON.stringify(data.deletedSceneIds) === JSON.stringify(["scene_2"]));
  }

  console.log("--- Scenario 2: già coerente, nessuna modifica, nessun log DELETED SCENES (integrazione load heal) ---");
  {
    const data = chapterWithScenes(["scene_1"], []);
    const { wasHealed } = healOrphanDeletedSceneIdsInChapterData(data);
    assert("wasHealed false (unit)", wasHealed === false);
    assert("deleted ancora []", JSON.stringify(data.deletedSceneIds) === JSON.stringify([]));

    const ws = {
      workspaceVersion: SCENOGRAFIA_WORKSPACE_VERSION,
      version: SCENOGRAFIA_PROJECT_VERSION,
      projectSchemaVersion: SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID,
      projectMasterImages: {},
      projectMasterByCharName: {},
      projectCharacterMasters: {},
      projectCharacterApprovalMap: {},
      chapters: [
        {
          id: "ch_ok",
          sortOrder: 0,
          chapterTitle: "T",
          data: {
            version: SCENOGRAFIA_PROJECT_VERSION,
            plan: { scenes: [{ id: "scene_1" }], characters: [] },
            deletedSceneIds: [],
            masterImages: {},
            masterByCharName: {},
            projectCharacterMasters: {},
            characterApprovalMap: {},
          },
        },
      ],
    };
    const lines = [];
    const orig = console.info;
    console.info = (...a) => {
      lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
      orig(...a);
    };
    try {
      await applyScenografiaPcidPostMergeHealOnLoad("proj_del_test_clean", JSON.parse(JSON.stringify(ws)), {
        saveScenografiaProjectById: async () => true,
        diskBaselineFingerprint: null,
        diskProjectSchemaVersion: null,
      });
    } finally {
      console.info = orig;
    }
    const bad = lines.some((l) => l.includes("[PCID HEAL · DELETED SCENES]"));
    assert("apply: nessun log DELETED SCENES", !bad);
  }

  console.log("--- Scenario 3: solo orfani → lista vuota ---");
  {
    const data = chapterWithScenes(["scene_1", "scene_2"], ["scene_99"]);
    const { wasHealed } = healOrphanDeletedSceneIdsInChapterData(data);
    assert("wasHealed true", wasHealed === true);
    assert("deleted vuoto", JSON.stringify(data.deletedSceneIds) === JSON.stringify([]));
  }

  console.log("--- Scenario 4: due capitoli, heal solo sul secondo ---");
  {
    const ws = {
      chapters: [
        { id: "ch_clean", data: chapterWithScenes(["a1"], []) },
        {
          id: "ch_dirty",
          data: chapterWithScenes(["b1", "b2"], ["scene_ghost"]),
        },
      ],
    };
    const r1 = healOrphanDeletedSceneIdsInChapterData(ws.chapters[0].data);
    const r2 = healOrphanDeletedSceneIdsInChapterData(ws.chapters[1].data);
    assert("capitolo pulito non heal", r1.wasHealed === false);
    assert("capitolo sporco heal", r2.wasHealed === true);
    assert("ch_clean deleted invariato", JSON.stringify(ws.chapters[0].data.deletedSceneIds) === "[]");
    assert("ch_dirty deleted svuotato", JSON.stringify(ws.chapters[1].data.deletedSceneIds) === "[]");
  }

  console.log("=== ALL TESTS PASSED ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
