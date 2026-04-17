/**
 * STEP 2 — hook load + migrazione PCID (in memoria / localStorage finto).
 *   node --experimental-default-type=module test-pcid-load-hook.mjs
 */

import {
  applyScenografiaPcidMigrationOnLoad,
  __clearPcidMigrateImplForTests,
  __setPcidMigrateImplForTests,
  ensureWorkspace,
  loadScenografiaProjectById,
  migrateProjectToPcidSchema,
  SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID,
  SCENOGRAFIA_PROJECT_VERSION,
} from "./src/services/scenografieProjectPersistence.js";

const LS_PREFIX = "ai-studio-scenografia-project-v1::";
const PID = "proj_pcid_load_hook_test";

function lsKey(id) {
  return `${LS_PREFIX}${id}`;
}

function buildRawWorkspaceV1() {
  return {
    workspaceVersion: 2,
    version: SCENOGRAFIA_PROJECT_VERSION,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    narrativeProjectTitle: "Hook test",
    narrativeProjectDescription: "",
    chapters: [
      {
        id: "ch_hook",
        sortOrder: 0,
        chapterTitle: "Unico",
        data: {
          version: SCENOGRAFIA_PROJECT_VERSION,
          plan: {
            characters: [{ id: "char_1", name: "Solo", is_protagonist: true }],
            scenes: [{ id: "sc_1", title_it: "Scena", characters_present: ["char_1"] }],
          },
          masterImages: { char_1: "https://example.test/hook-solo.jpg" },
          masterByCharName: {},
          projectCharacterMasters: {
            char_1: {
              characterId: "char_1",
              characterName: "Solo",
              masterImageUrl: "https://example.test/hook-solo.jpg",
              approved: false,
              source: "test",
            },
          },
          characterApprovalMap: {},
          sceneVideoClips: [],
          characterVoiceMasters: { char_1: { voiceId: "voice_hook" } },
        },
      },
    ],
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterApprovalMap: {},
    projectCharacterMasters: {},
  };
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
    _dump: () => new Map(map),
  };
  globalThis.localStorage = ls;
  return ls;
}

async function runCase(name, fn) {
  const passed = [];
  let failed = false;
  const fail = (msg) => {
    failed = true;
    process.exitCode = 1;
    console.error(`ASSERT FAILED: ${msg}`);
  };

  console.log(`\n${"=".repeat(72)}\nCASE: ${name}\n${"=".repeat(72)}`);
  await fn({ passed, fail });

  if (!failed) {
    console.log("\n--- ASSERT PASSED ---");
    for (const line of passed) console.log(`  • ${line}`);
    console.log("--- Fine assert ---\n");
  } else {
    console.log("\n--- ASSERT PASSED: omesso (fallimenti sopra) ---\n");
  }
}

async function main() {
  console.log("=== PCID load hook (STEP 2) harness ===\n");

  await runCase("applyScenografiaPcidMigrationOnLoad: schema 1 → 2 + save una volta", async ({ passed, fail }) => {
    const ws = ensureWorkspace(JSON.parse(JSON.stringify(buildRawWorkspaceV1())));
    let saveCalls = 0;
    const out = await applyScenografiaPcidMigrationOnLoad(PID, ws, {
      saveScenografiaProjectById: async () => {
        saveCalls += 1;
        return true;
      },
      onHookMeta: (m) => {
        if (m.schemaBefore !== 0) fail(`schemaBefore atteso 0, got ${m.schemaBefore}`);
        if (m.schemaAfter !== SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID) {
          fail(`schemaAfter atteso ${SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID}, got ${m.schemaAfter}`);
        }
        if (m.wasMigrated !== true) fail("wasMigrated atteso true");
      },
    });
    if (saveCalls !== 1) fail(`save atteso 1 chiamata, got ${saveCalls}`);
    if (out.projectSchemaVersion !== SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID) {
      fail(`workspace.projectSchemaVersion atteso ${SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID}`);
    }
    passed.push(`save chiamato ${saveCalls} volta/e`);
    passed.push(`projectSchemaVersion = ${out.projectSchemaVersion}`);
    passed.push("onHookMeta: schemaBefore=0, schemaAfter=2, wasMigrated=true");
  });

  await runCase("apply: già schema 2 → idempotente (nessun save)", async ({ passed, fail }) => {
    const base = migrateProjectToPcidSchema(JSON.parse(JSON.stringify(buildRawWorkspaceV1())));
    let saveCalls = 0;
    const out = await applyScenografiaPcidMigrationOnLoad(PID, base, {
      saveScenografiaProjectById: async () => {
        saveCalls += 1;
        return true;
      },
      onHookMeta: (m) => {
        if (m.wasMigrated !== false) fail("wasMigrated deve essere false se già a schema 2");
        if (m.schemaBefore !== SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID) {
          fail(`schemaBefore atteso ${SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID}`);
        }
      },
    });
    if (saveCalls !== 0) fail(`save non deve essere chiamato, got ${saveCalls}`);
    if (out !== base) fail("migrate idempotente deve restituire lo stesso ref");
    passed.push("save non invocato (0 chiamate)");
    passed.push("stesso ref in uscita (idempotenza migrate)");
  });

  await runCase("apply: errore forzato in migrate → workspace originale, no schema 2", async ({ passed, fail }) => {
    const snap = JSON.parse(JSON.stringify(buildRawWorkspaceV1()));
    const ws = ensureWorkspace(snap);
    let saveCalls = 0;
    const out = await applyScenografiaPcidMigrationOnLoad(PID, ws, {
      migrateProjectToPcidSchema: () => {
        throw new Error("forced_migrate_failure");
      },
      saveScenografiaProjectById: async () => {
        saveCalls += 1;
        return true;
      },
      onHookMeta: (m) => {
        if (m.wasMigrated !== false) fail("wasMigrated false dopo FATAL");
        if (m.schemaAfter !== 0) fail(`schemaAfter deve restare 0, got ${m.schemaAfter}`);
      },
    });
    if (saveCalls !== 0) fail("save non deve essere chiamato se migrate fallisce");
    if (out !== ws) fail("deve restituire lo stesso workspace (non migrato)");
    if (out.projectSchemaVersion === SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID) {
      fail("non deve comparire projectSchemaVersion 2 dopo errore");
    }
    passed.push("stesso ref workspace + nessun save + schema non bumpato");
  });

  await runCase("loadScenografiaProjectById: storage → migrazione + persistenza simulata", async ({ passed, fail }) => {
    const ls = installFakeLocalStorage();
    ls.setItem(lsKey(PID), JSON.stringify(buildRawWorkspaceV1()));

    const a = await loadScenografiaProjectById(PID);
    if (!a || a.projectSchemaVersion !== SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID) {
      fail("primo load deve produrre schema 2");
    }
    const raw = ls.getItem(lsKey(PID));
    const disk = JSON.parse(raw);
    if (disk.projectSchemaVersion !== SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID) {
      fail("disco deve contenere schema 2 dopo save implicito");
    }

    const b = await loadScenografiaProjectById(PID);
    if (!b || b.projectSchemaVersion !== SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID) {
      fail("secondo load legge schema 2");
    }
    passed.push("Primo load: workspace migrato e salvato su localStorage finto");
    passed.push("Secondo load: legge schema 2 da storage (idempotente)");
  });

  await runCase("loadScenografiaProjectById: due load paralleli → una sola migrazione (inflight)", async ({ passed, fail }) => {
    const ls = installFakeLocalStorage();
    ls.setItem(lsKey(PID), JSON.stringify(buildRawWorkspaceV1()));

    let migrateRuns = 0;
    __setPcidMigrateImplForTests(async (p) => {
      migrateRuns += 1;
      await new Promise((r) => setTimeout(r, 45));
      return migrateProjectToPcidSchema(p);
    });

    try {
      const [r1, r2] = await Promise.all([loadScenografiaProjectById(PID), loadScenografiaProjectById(PID)]);
      if (migrateRuns !== 1) fail(`migrate atteso 1 esecuzione (lock), got ${migrateRuns}`);
      if (r1?.projectSchemaVersion !== SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID) fail("r1 schema 2");
      if (r2?.projectSchemaVersion !== SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID) fail("r2 schema 2");
      passed.push(`Promise condivisa: migrate eseguito ${migrateRuns} volta/e`);
      passed.push("Entrambi i risultati con projectSchemaVersion 2");
    } finally {
      __clearPcidMigrateImplForTests();
    }
  });

  console.log("=== Fine harness load hook ===");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
