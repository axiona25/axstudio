/**
 * STEP 3 — heal on load (self-persist merge corrections).
 *   cd ai-studio-app && node test-pcid-heal.mjs
 */

import {
  loadScenografiaProjectById,
  SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID,
  SCENOGRAFIA_PROJECT_VERSION,
  SCENOGRAFIA_WORKSPACE_VERSION,
} from "./src/services/scenografieProjectPersistence.js";

const LS_PREFIX = "ai-studio-scenografia-project-v1::";

function lsKey(id) {
  return `${LS_PREFIX}${id}`;
}

function installFakeLocalStorage() {
  const map = new Map();
  const ls = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
  globalThis.localStorage = ls;
  return ls;
}

const URL_M = "https://example.test/heal-maria.jpg";
const PC_POOL = "pcid_aabb01";
const PC_WRONG = "pcid_ccdd02";

function workspaceV2MismatchOnDisk(pid) {
  return {
    workspaceVersion: SCENOGRAFIA_WORKSPACE_VERSION,
    version: SCENOGRAFIA_PROJECT_VERSION,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    narrativeProjectTitle: "Heal test",
    narrativeProjectDescription: "",
    projectTitle: "Heal test",
    projectDescription: "",
    projectSchemaVersion: SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID,
    projectMasterByCharName: { maria: PC_POOL },
    projectMasterImages: { [PC_POOL]: URL_M },
    projectCharacterMasters: {
      [PC_POOL]: {
        characterId: "char_1",
        characterName: "Maria",
        masterImageUrl: URL_M,
        approved: false,
        source: "test",
      },
    },
    projectCharacterApprovalMap: {},
    chapters: [
      {
        id: "ch_heal",
        sortOrder: 0,
        chapterTitle: "Cap 1",
        data: {
          version: SCENOGRAFIA_PROJECT_VERSION,
          updatedAt: "2020-01-01T00:00:00.000Z",
          plan: {
            characters: [{ id: "char_1", name: "Maria", is_protagonist: true, pcid: PC_WRONG }],
            scenes: [{ id: "sc_1", title_it: "S", characters_present: ["char_1"] }],
          },
          masterImages: { [PC_WRONG]: URL_M },
          masterByCharName: {},
          projectCharacterMasters: {
            [PC_WRONG]: {
              characterId: "char_1",
              characterName: "Maria",
              masterImageUrl: URL_M,
              approved: false,
              source: "chapter",
            },
          },
          characterApprovalMap: {},
        },
      },
    ],
  };
}

function assert(cond, msg) {
  if (!cond) {
    console.error("ASSERT FAILED:", msg);
    process.exit(1);
  }
}

function workspaceV2Coherent() {
  const w = workspaceV2MismatchOnDisk("x");
  const ch = w.chapters[0];
  ch.data = {
    ...ch.data,
    plan: {
      ...ch.data.plan,
      characters: [{ id: "char_1", name: "Maria", is_protagonist: true, pcid: PC_POOL }],
    },
    masterImages: { [PC_POOL]: URL_M },
    masterByCharName: { maria: PC_POOL },
    projectCharacterMasters: {
      [PC_POOL]: {
        characterId: "char_1",
        characterName: "Maria",
        masterImageUrl: URL_M,
        approved: false,
        source: "chapter",
      },
    },
  };
  return w;
}

async function main() {
  console.log("=== test-pcid-heal.mjs ===\n");

  console.log("--- Caso heal necessario: save esattamente 1 volta (solo hook heal/migrate path) ---");
  {
    const PID = "proj_pcid_heal_need";
    installFakeLocalStorage();
    globalThis.localStorage.setItem(lsKey(PID), JSON.stringify(workspaceV2MismatchOnDisk(PID)));
    let saveCalls = 0;
    const out = await loadScenografiaProjectById(PID, {
      saveScenografiaProjectById: async () => {
        saveCalls += 1;
        return true;
      },
    });
    assert(out, "workspace caricato");
    const maria = out.chapters[0].data.plan.characters.find((c) => c.id === "char_1");
    assert(maria?.pcid === PC_POOL, `Maria pcid deve allinearsi al pool: got ${maria?.pcid}`);
    assert(saveCalls === 1, `save atteso 1 chiamata (heal o coerenza disco), got ${saveCalls}`);
    console.log("ASSERT PASSED: heal necessario → save 1x");
  }

  console.log("\n--- Caso no-op: save NON chiamato ---");
  {
    const PID = "proj_pcid_heal_noop";
    installFakeLocalStorage();
    globalThis.localStorage.setItem(lsKey(PID), JSON.stringify(workspaceV2Coherent()));
    let saveCalls = 0;
    const out = await loadScenografiaProjectById(PID, {
      saveScenografiaProjectById: async () => {
        saveCalls += 1;
        return true;
      },
    });
    assert(out?.chapters?.[0]?.data?.plan?.characters?.[0]?.pcid === PC_POOL, "pcid coerente");
    assert(saveCalls === 0, `save non atteso, got ${saveCalls}`);
    console.log("ASSERT PASSED: no-op → save 0x");
  }

  console.log("\n--- Caso save che lancia: load non crasha, RAM corretta ---");
  {
    const PID = "proj_pcid_heal_throw";
    installFakeLocalStorage();
    globalThis.localStorage.setItem(lsKey(PID), JSON.stringify(workspaceV2MismatchOnDisk(PID)));
    let saveCalls = 0;
    let out;
    try {
      out = await loadScenografiaProjectById(PID, {
        saveScenografiaProjectById: async () => {
          saveCalls += 1;
          throw new Error("disk full (test)");
        },
      });
    } catch (e) {
      console.error("ASSERT FAILED: load non deve lanciare:", e);
      process.exit(1);
    }
    assert(out, "workspace restituito");
    const maria = out.chapters[0].data.plan.characters.find((c) => c.id === "char_1");
    assert(maria?.pcid === PC_POOL, "RAM: pcid allineato al pool nonostante save fallito");
    assert(saveCalls >= 1, "save tentato almeno una volta");
    console.log("ASSERT PASSED: save throw → load ok + RAM healed");
  }

  console.log("\n=== Fine test-pcid-heal.mjs (tutti ASSERT PASSED) ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
