/**
 * Harness isolato per `migrateProjectToPcidSchema` (STEP 1).
 * Esecuzione da `ai-studio-app`:
 *   node --experimental-default-type=module test-pcid-migration.mjs
 */

import {
  migrateProjectToPcidSchema,
  PCM_SOURCE_USER_CANONICAL_LOCK,
} from "./src/services/scenografieProjectPersistence.js";

const URL_A = "https://example.test/faces/alice.jpg";
const URL_B = "https://example.test/faces/bob.jpg";
const URL_M1 = "https://example.test/faces/maria-ch1.jpg";
const URL_M2 = "https://example.test/faces/maria-ch2.jpg";
const URL_GHOST = "https://example.test/faces/orphan-pool.jpg";
const URL_ALICE_V1 = "https://example.test/faces/alice_v1.jpg";
const URL_ALICE_V2 = "https://example.test/faces/alice_v2.jpg";

const PCID_KEY_RE = /^pcid_[0-9a-f]{6}$/;

function normCharNameForMasterPool(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isHttpUrl(s) {
  return typeof s === "string" && /^https?:\/\//i.test(s.trim());
}

/** Raccoglie ricorsivamente stringhe URL master (http/https) — esclude sceneResults per policy test. */
function collectHttpUrls(value, acc, seen = new WeakSet()) {
  if (value == null) return;
  if (typeof value === "string") {
    if (isHttpUrl(value)) acc.add(value.trim());
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const x of value) collectHttpUrls(x, acc, seen);
    return;
  }
  for (const k of Object.keys(value)) {
    if (k === "sceneResults") continue;
    collectHttpUrls(value[k], acc, seen);
  }
}

function clipStub({ id, sceneId, charId }) {
  return {
    id,
    sceneId,
    status: "draft",
    dialogLines: [{ characterId: charId, text: "Una battuta di prova." }],
    dialogLineOrder: [charId],
    dialogFirstSpeakerId: charId,
  };
}

function chapterPayload({ char1Name, char2Name, url1, url2, scenePresentId, clipCharId }) {
  const base = {
    version: 1,
    plan: {
      characters: [
        { id: "char_1", name: char1Name, is_protagonist: true },
        { id: "char_2", name: char2Name, is_protagonist: false },
      ],
      scenes: [{ id: "scene_1", title_it: "Prova", characters_present: [scenePresentId] }],
    },
    masterImages: {
      char_1: url1,
      char_2: url2,
    },
    masterByCharName: {},
    projectCharacterMasters: {
      char_1: { characterId: "char_1", characterName: char1Name, masterImageUrl: url1, approved: false, source: "test" },
      char_2: { characterId: "char_2", characterName: char2Name, masterImageUrl: url2, approved: false, source: "test" },
    },
    characterApprovalMap: {},
    sceneVideoClips: [clipStub({ id: "vc_1", sceneId: "scene_1", charId: clipCharId })],
    characterVoiceMasters: {
      [clipCharId]: { voiceId: `voice_${clipCharId}`, label: "test" },
    },
  };
  return base;
}

/** Un solo slot senza nome (solo spazi / vuoto) per capitolo. */
function chapterPayloadUnnamedSlot({ charId, url, updatedAt }) {
  return {
    version: 1,
    plan: {
      characters: [{ id: charId, name: "   ", is_protagonist: true }],
      scenes: [{ id: "scene_1", title_it: "Senza nome", characters_present: [charId] }],
    },
    masterImages: { [charId]: url },
    masterByCharName: {},
    projectCharacterMasters: {
      [charId]: {
        characterId: charId,
        characterName: "",
        masterImageUrl: url,
        approved: false,
        source: "test",
        updatedAt: updatedAt || "2020-01-01T00:00:00.000Z",
      },
    },
    characterApprovalMap: {},
    sceneVideoClips: [clipStub({ id: "vc_1", sceneId: "scene_1", charId })],
    characterVoiceMasters: {
      [charId]: { voiceId: `voice_${charId}`, label: "unnamed" },
    },
  };
}

/** Due capitoli: stesso nome «Maria» su char_1, URL master diversi → MASTER URL COLLISION, stesso pcid. */
function buildMariaCollisionWorkspace() {
  return {
    workspaceVersion: 2,
    version: 1,
    chapters: [
      {
        id: "ch_m1",
        sortOrder: 0,
        chapterTitle: "Maria I",
        data: chapterPayload({
          char1Name: "Maria",
          char2Name: "Elena",
          url1: URL_M1,
          url2: URL_A,
          scenePresentId: "char_1",
          clipCharId: "char_1",
        }),
      },
      {
        id: "ch_m2",
        sortOrder: 1,
        chapterTitle: "Maria II",
        data: chapterPayload({
          char1Name: "Maria",
          char2Name: "Elena",
          url1: URL_M2,
          url2: URL_A,
          scenePresentId: "char_1",
          clipCharId: "char_1",
        }),
      },
    ],
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterApprovalMap: {},
    projectCharacterMasters: {},
  };
}

/** Alice in due capitoli: master diversi; il lock utente vince. */
function buildAliceLockCrossChapterWorkspace() {
  const dAlpha = chapterPayload({
    char1Name: "Alice",
    char2Name: "Elena",
    url1: URL_ALICE_V1,
    url2: URL_A,
    scenePresentId: "char_1",
    clipCharId: "char_1",
  });
  dAlpha.projectCharacterMasters.char_1 = {
    ...dAlpha.projectCharacterMasters.char_1,
    source: "test",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
  const dBeta = chapterPayload({
    char1Name: "Alice",
    char2Name: "Elena",
    url1: URL_ALICE_V2,
    url2: URL_A,
    scenePresentId: "char_1",
    clipCharId: "char_1",
  });
  dBeta.projectCharacterMasters.char_1 = {
    ...dBeta.projectCharacterMasters.char_1,
    source: PCM_SOURCE_USER_CANONICAL_LOCK,
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  return {
    workspaceVersion: 2,
    version: 1,
    chapters: [
      { id: "cap_alpha", sortOrder: 0, chapterTitle: "Alpha", data: dAlpha },
      { id: "cap_beta", sortOrder: 1, chapterTitle: "Beta", data: dBeta },
    ],
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterApprovalMap: {},
    projectCharacterMasters: {},
  };
}

/** Lock su alpha (URL vecchio) vs beta con updatedAt recente: vince il lock (policy lock > updatedAt). */
function buildAliceLockVsUpdatedAtWorkspace() {
  const dAlpha = chapterPayload({
    char1Name: "Alice",
    char2Name: "Elena",
    url1: URL_ALICE_V1,
    url2: URL_A,
    scenePresentId: "char_1",
    clipCharId: "char_1",
  });
  dAlpha.projectCharacterMasters.char_1 = {
    ...dAlpha.projectCharacterMasters.char_1,
    source: PCM_SOURCE_USER_CANONICAL_LOCK,
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  const dBeta = chapterPayload({
    char1Name: "Alice",
    char2Name: "Elena",
    url1: URL_ALICE_V2,
    url2: URL_A,
    scenePresentId: "char_1",
    clipCharId: "char_1",
  });
  dBeta.projectCharacterMasters.char_1 = {
    ...dBeta.projectCharacterMasters.char_1,
    source: "regenerated_master",
    updatedAt: "2025-06-01T12:00:00.000Z",
  };
  return {
    workspaceVersion: 2,
    version: 1,
    chapters: [
      { id: "cap_alpha", sortOrder: 0, chapterTitle: "Alpha", data: dAlpha },
      { id: "cap_beta", sortOrder: 1, chapterTitle: "Beta", data: dBeta },
    ],
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterApprovalMap: {},
    projectCharacterMasters: {},
  };
}

/** Alice: voci diverse tra capitoli → VOICE COLLISION, una sola voce canonica. */
function buildAliceVoiceCrossChapterWorkspace() {
  const dAlpha = chapterPayload({
    char1Name: "Alice",
    char2Name: "Elena",
    url1: URL_A,
    url2: URL_B,
    scenePresentId: "char_1",
    clipCharId: "char_1",
  });
  dAlpha.characterVoiceMasters.char_1 = {
    voiceId: "voice_A",
    voiceLabel: "A",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  const dBeta = chapterPayload({
    char1Name: "Alice",
    char2Name: "Elena",
    url1: URL_A,
    url2: URL_B,
    scenePresentId: "char_1",
    clipCharId: "char_1",
  });
  dBeta.characterVoiceMasters.char_1 = {
    voiceId: "voice_B",
    voiceLabel: "B",
    canonicalLock: true,
    updatedAt: "2019-01-01T00:00:00.000Z",
  };
  return {
    workspaceVersion: 2,
    version: 1,
    chapters: [
      { id: "cap_alpha", sortOrder: 0, chapterTitle: "Alpha", data: dAlpha },
      { id: "cap_beta", sortOrder: 1, chapterTitle: "Beta", data: dBeta },
    ],
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterApprovalMap: {},
    projectCharacterMasters: {},
  };
}

/** Due capitoli, stesso slot senza nome → due pcid distinti (Decisione 1). */
function buildUnnamedTwoChaptersWorkspace() {
  return {
    workspaceVersion: 2,
    version: 1,
    chapters: [
      {
        id: "ch_u1",
        sortOrder: 0,
        chapterTitle: "U1",
        data: chapterPayloadUnnamedSlot({
          charId: "char_1",
          url: URL_M1,
          updatedAt: "2021-01-01T00:00:00.000Z",
        }),
      },
      {
        id: "ch_u2",
        sortOrder: 1,
        chapterTitle: "U2",
        data: chapterPayloadUnnamedSlot({
          charId: "char_1",
          url: URL_M2,
          updatedAt: "2022-01-01T00:00:00.000Z",
        }),
      },
    ],
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterApprovalMap: {},
    projectCharacterMasters: {},
  };
}

/** Un capitolo: due slot con lo stesso nome normalizzato → stesso pcid, due voci legacy → VOICE COLLISION. */
function buildVoiceCollisionWorkspace() {
  return {
    workspaceVersion: 2,
    version: 1,
    chapters: [
      {
        id: "ch_voice",
        sortOrder: 0,
        chapterTitle: "Voice collision",
        data: (() => {
          const d = chapterPayload({
            char1Name: "Twin",
            char2Name: "Twin",
            url1: URL_A,
            url2: URL_A,
            scenePresentId: "char_1",
            clipCharId: "char_1",
          });
          d.plan.scenes[0].characters_present = ["char_1", "char_2"];
          d.sceneVideoClips.push(clipStub({ id: "vc_2", sceneId: "scene_1", charId: "char_2" }));
          d.characterVoiceMasters = {
            char_1: {
              voiceId: "voice_slot_1",
              voiceLabel: "older",
              updatedAt: "2020-01-01T00:00:00.000Z",
            },
            char_2: {
              voiceId: "voice_slot_2_canonical",
              voiceLabel: "newer",
              canonicalLock: true,
              updatedAt: "2025-06-01T12:00:00.000Z",
            },
          };
          return d;
        })(),
      },
    ],
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterApprovalMap: {},
    projectCharacterMasters: {},
  };
}

/** char_1 / char_2 invertiti tra capitoli (Alice/Bob) + pool orfano. */
function buildSwapWorkspace() {
  return {
    workspaceVersion: 2,
    version: 1,
    chapters: [
      {
        id: "ch_alpha",
        sortOrder: 0,
        chapterTitle: "Capitolo I",
        data: chapterPayload({
          char1Name: "Alice",
          char2Name: "Bob",
          url1: URL_A,
          url2: URL_B,
          scenePresentId: "char_1",
          clipCharId: "char_1",
        }),
      },
      {
        id: "ch_beta",
        sortOrder: 1,
        chapterTitle: "Capitolo II",
        data: chapterPayload({
          char1Name: "Bob",
          char2Name: "Alice",
          url1: URL_B,
          url2: URL_A,
          scenePresentId: "char_1",
          clipCharId: "char_1",
        }),
      },
    ],
    projectMasterImages: {},
    projectMasterByCharName: {},
    projectCharacterApprovalMap: {},
    projectCharacterMasters: {
      char_ghost: {
        characterId: "char_ghost",
        characterName: "Nessun piano",
        masterImageUrl: URL_GHOST,
        approved: false,
        source: "orphan_fixture",
      },
    },
  };
}

function countExpectedPcidsFromPlan(project) {
  const normNames = new Set();
  let unnamed = 0;
  for (const ch of project.chapters || []) {
    for (const c of ch.data?.plan?.characters || []) {
      const nt = String(c.name ?? "").trim();
      const nk = normCharNameForMasterPool(c.name);
      if (nt && nk) normNames.add(nk);
      else unnamed += 1;
    }
  }
  return { total: normNames.size + unnamed, normNames: normNames.size, unnamed };
}

function countPoolPcids(project) {
  return Object.keys(project.projectCharacterMasters || {}).filter((k) => PCID_KEY_RE.test(k)).length;
}

function migrateWithCapturedWarn(project) {
  const warns = [];
  const prev = console.warn;
  console.warn = (...args) => {
    warns.push(args.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    prev.apply(console, args);
  };
  try {
    const after = migrateProjectToPcidSchema(JSON.parse(JSON.stringify(project)));
    return { after, warns };
  } finally {
    console.warn = prev;
  }
}

function runCase(name, builder, opts = {}) {
  const { assertUrlInvariant = true, expectMasterCollisionLog = false, expectVoiceCollisionLog = false } = opts;
  const passed = [];
  let caseFailed = false;
  const fail = (msg) => {
    caseFailed = true;
    process.exitCode = 1;
    console.error(`ASSERT FAILED: ${msg}`);
  };

  console.log(`\n${"=".repeat(72)}\nCASE: ${name}\n${"=".repeat(72)}`);
  const before = builder();
  const urlsBefore = new Set();
  collectHttpUrls(before, urlsBefore);

  console.log("--- URL pre ---", [...urlsBefore].sort());

  const { after, warns } = migrateWithCapturedWarn(before);
  const urlsAfter = new Set();
  collectHttpUrls(after, urlsAfter);

  console.log("--- URL post ---", [...urlsAfter].sort());

  const same =
    urlsBefore.size === urlsAfter.size && [...urlsBefore].every((u) => urlsAfter.has(u));
  console.log("Set pre === Set post:", same);
  if (!assertUrlInvariant) {
    console.log("(invariante URL non richiesta: collisione master → URL canonico unico nel pool)");
  }

  const idem = migrateProjectToPcidSchema(after);
  console.log("Idempotenza (stesso ref):", idem === after);

  const exp = countExpectedPcidsFromPlan(before);
  const got = countPoolPcids(after);
  if (got !== exp.total) {
    fail(`Numero pcid nel pool (${got} vs atteso ${exp.total} = normName ${exp.normNames} + senza nome ${exp.unnamed})`);
  } else {
    passed.push(`Numero pcid nel pool = ${got} (= normName unici ${exp.normNames} + senza nome ${exp.unnamed})`);
  }

  const pbn = after.projectMasterByCharName || {};
  let flatOk = true;
  for (const k of Object.keys(pbn)) {
    if (k.includes("::")) {
      flatOk = false;
      fail(`projectMasterByCharName contiene chiave non flat: ${JSON.stringify(k)}`);
    }
  }
  if (flatOk) {
    passed.push("Chiavi projectMasterByCharName tutte pure: true");
  }

  if (idem !== after) {
    fail("Idempotenza: seconda migrazione ha clonato invece di restituire lo stesso ref");
  } else {
    passed.push("Idempotenza (stesso ref): true");
  }

  if (expectMasterCollisionLog) {
    const hit = warns.some((w) => w.includes("[PCID MIGRATION · MASTER URL COLLISION]"));
    if (!hit) {
      fail("atteso log [PCID MIGRATION · MASTER URL COLLISION]");
    } else {
      passed.push("Log [PCID MIGRATION · MASTER URL COLLISION] emesso: true");
      console.log("Log MASTER URL COLLISION presente:", warns.filter((w) => w.includes("MASTER URL COLLISION")).join("\n"));
    }
  }

  if (expectVoiceCollisionLog) {
    const hit = warns.some((w) => w.includes("[PCID MIGRATION · VOICE COLLISION]"));
    if (!hit) {
      fail("atteso log [PCID MIGRATION · VOICE COLLISION]");
    } else {
      passed.push("Log [PCID MIGRATION · VOICE COLLISION] emesso: true");
      console.log("Log VOICE COLLISION presente:", warns.filter((w) => w.includes("VOICE COLLISION")).join("\n"));
    }
  }

  if (name.startsWith("Global Maria")) {
    const keys = Object.keys(pbn).sort();
    console.log("projectMasterByCharName keys:", keys);
    const mariaPcid = pbn.maria;
    const ch1 = after.chapters[0].data.plan.characters.find((c) => c.id === "char_1")?.pcid;
    const ch2 = after.chapters[1].data.plan.characters.find((c) => c.id === "char_1")?.pcid;
    console.log("Maria (char_1) pcid cap1:", ch1, "cap2:", ch2, "pool maria:", mariaPcid);
    if (ch1 !== ch2 || ch1 !== mariaPcid) {
      fail("Maria deve avere un solo pcid tra capitoli e pool");
    } else {
      passed.push(`Maria stesso pcid tra capitoli: ${mariaPcid}`);
    }
    const row = after.projectCharacterMasters[mariaPcid];
    const mariaUrl = String(row?.masterImageUrl || "");
    if (!mariaUrl) {
      fail("Maria: master canonico assente");
    } else {
      const tail = mariaUrl.split("/").pop() || mariaUrl;
      passed.push(`URL canonico scelto per Maria: ${tail}`);
    }
  }

  if (name.startsWith("Alice lock") || name.startsWith("Alice voce")) {
    const keys = Object.keys(pbn).sort();
    console.log("projectMasterByCharName keys:", keys);
    const alicePcid = pbn.alice;
    const ch1 = after.chapters[0].data.plan.characters.find((c) => c.id === "char_1")?.pcid;
    const ch2 = after.chapters[1].data.plan.characters.find((c) => c.id === "char_1")?.pcid;
    console.log("Alice (char_1) pcid cap1:", ch1, "cap2:", ch2, "pool alice:", alicePcid);
    if (ch1 !== ch2 || ch1 !== alicePcid) {
      fail("Alice deve avere un solo pcid tra capitoli e pool");
    } else {
      passed.push(`Alice stesso pcid tra capitoli: ${alicePcid}`);
    }
  }

  if (name.startsWith("Alice lock cross-chapter")) {
    const alicePcid = after.projectMasterByCharName.alice;
    const row = after.projectCharacterMasters[alicePcid];
    if (String(row?.masterImageUrl || "") !== URL_ALICE_V2) {
      fail(`Alice lock cross-chapter: atteso URL alice_v2, got ${row?.masterImageUrl}`);
    } else if (row?.source !== PCM_SOURCE_USER_CANONICAL_LOCK) {
      fail(`Alice lock cross-chapter: attesa source user_canonical_lock, got ${row?.source}`);
    } else {
      passed.push("URL canonico Alice (cross su beta con lock): alice_v2.jpg + source user_canonical_lock");
    }
  }

  if (name.startsWith("Alice lock vs updatedAt")) {
    const alicePcid = after.projectMasterByCharName.alice;
    const row = after.projectCharacterMasters[alicePcid];
    const url = String(row?.masterImageUrl || "");
    const tail = url.split("/").pop() || url;
    if (url !== URL_ALICE_V1) {
      fail(`Alice lock vs updatedAt: atteso alice_v1 (lock su alpha), got ${url}`);
    } else if (row?.source !== PCM_SOURCE_USER_CANONICAL_LOCK) {
      fail(`Alice lock vs updatedAt: attesa source user_canonical_lock, got ${row?.source}`);
    } else {
      passed.push(
        `URL canonico scelto per Alice: ${tail} (atteso: con user_canonical_lock su cap_alpha, vince su updatedAt recente in beta)`,
      );
    }
  }

  if (name.startsWith("Alice voce")) {
    const alicePcid = after.projectMasterByCharName.alice;
    let voceOk = true;
    for (const ch of after.chapters) {
      const vm = ch.data?.characterVoiceMasters || {};
      const keys = Object.keys(vm).filter((k) => PCID_KEY_RE.test(k));
      if (keys.length !== 1 || keys[0] !== alicePcid) {
        fail(`Alice voce (${ch.id}): attesa una sola chiave pcid per voci, got ${keys.join(",")}`);
        voceOk = false;
        break;
      }
      if (String(vm[alicePcid]?.voiceId || "") !== "voice_B") {
        fail(`Alice voce (${ch.id}): attesa voce_B (canonicalLock), got ${vm[alicePcid]?.voiceId}`);
        voceOk = false;
        break;
      }
    }
    if (voceOk && !caseFailed) {
      passed.push("Alice voce canonica cross-chapter: voice_B con un solo pcid per capitolo");
    }
  }

  if (name.includes("Senza nome")) {
    const p1 = after.chapters[0].data.plan.characters[0].pcid;
    const p2 = after.chapters[1].data.plan.characters[0].pcid;
    console.log("Unnamed pcid ch1 / ch2:", p1, p2);
    if (!p1 || !p2 || p1 === p2) {
      fail("due slot senza nome in capitoli diversi devono avere pcid distinti");
    } else {
      passed.push(`Senza nome: pcid distinti per capitolo (${p1} vs ${p2})`);
    }
  }

  if (name.includes("VOICE COLLISION") && name.includes("capitolo unico")) {
    const vm = after.chapters[0].data.characterVoiceMasters;
    const keys = Object.keys(vm).filter((k) => PCID_KEY_RE.test(k));
    console.log("Voice master keys post-migrazione:", keys);
    if (keys.length !== 1) {
      fail(`Voice collision capitolo: atteso un solo pcid nel capitolo, got ${keys.length}`);
    } else {
      const v = vm[keys[0]];
      if (String(v?.voiceId || "") !== "voice_slot_2_canonical") {
        fail(`Voice collision capitolo: attesa voce_slot_2_canonical, got ${v?.voiceId}`);
      } else {
        passed.push("Twin same pcid + voce canonica voice_slot_2_canonical (canonicalLock)");
      }
    }
  }

  if (name.startsWith("Swap")) {
    const aliceP = pbn.alice;
    const bobP = pbn.bob;
    const ok =
      after.chapters[0].data.plan.characters.find((c) => c.name === "Alice")?.pcid === aliceP &&
      after.chapters[1].data.plan.characters.find((c) => c.name === "Alice")?.pcid === aliceP;
    if (!ok) {
      fail("Swap: Alice deve condividere lo stesso pcid tra capitoli");
    } else {
      passed.push(`Swap: Alice stesso pcid tra capitoli: ${aliceP}; Bob pool: ${bobP}`);
    }
  }

  if (assertUrlInvariant && !same) {
    fail("insieme URL pre/post diverso (invariante richiesta)");
  } else if (assertUrlInvariant) {
    passed.push("Set URL pre === post (invariante): true");
  } else if (!caseFailed) {
    passed.push("Set URL pre === post: non richiesto per questo caso");
  }

  console.log("--- JSON sintetico dopo ---");
  console.log(
    JSON.stringify(
      {
        projectSchemaVersion: after.projectSchemaVersion,
        projectMasterByCharName: after.projectMasterByCharName,
        chapters: after.chapters.map((c) => ({
          id: c.id,
          characters: c.data?.plan?.characters,
          voiceKeys: Object.keys(c.data?.characterVoiceMasters || {}),
        })),
      },
      null,
      2,
    ),
  );

  if (!caseFailed) {
    console.log("\n--- ASSERT PASSED ---");
    for (const line of passed) {
      console.log(`  • ${line}`);
    }
    console.log("--- Fine assert ---\n");
  } else {
    console.log("\n--- ASSERT PASSED: omesso (caso con fallimenti sopra) ---\n");
  }
}

function main() {
  console.log("=== PCID migration harness ===\n");
  runCase("Swap + orphan pool", buildSwapWorkspace);
  runCase("Global Maria MASTER URL COLLISION + pool normName", buildMariaCollisionWorkspace, {
    assertUrlInvariant: false,
    expectMasterCollisionLog: true,
  });
  runCase("Alice lock cross-chapter (user_canonical_lock)", buildAliceLockCrossChapterWorkspace, {
    assertUrlInvariant: false,
    expectMasterCollisionLog: true,
  });
  runCase("Alice lock vs updatedAt", buildAliceLockVsUpdatedAtWorkspace, {
    assertUrlInvariant: false,
    expectMasterCollisionLog: true,
  });
  runCase("Alice voce cross-chapter (VOICE COLLISION)", buildAliceVoiceCrossChapterWorkspace, {
    expectVoiceCollisionLog: true,
  });
  runCase("Senza nome due capitoli (pcid distinti)", buildUnnamedTwoChaptersWorkspace);
  runCase("VOICE COLLISION (canonicalLock) capitolo unico", buildVoiceCollisionWorkspace, {
    expectVoiceCollisionLog: true,
  });
  console.log("\n=== Fine harness ===");
}

main();
