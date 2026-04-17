/**
 * STEP 3 — merge / reconcile / lookup pcid-first.
 *   cd ai-studio-app && node test-pcid-merge.mjs
 */

import {
  mergeChapterDataWithProjectCharacterPool,
  reconcileCharacterMasterMaps,
  migrateLegacyToProjectCharacterMasters,
  mergeProjectCharacterMastersFromLegacy,
  syncLegacyMapsFromCanonicalPlan,
  SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID,
} from "./src/services/scenografieProjectPersistence.js";

const URL_MARIA = "https://example.test/maria.jpg";
const URL_GIUSEPPE = "https://example.test/giuseppe.jpg";
const URL_ALICE = "https://example.test/alice.jpg";
const URL_BOB = "https://example.test/bob.jpg";

const PCID_MARIA = "pcid_aaaa01";
const PCID_GIUSEPPE = "pcid_bbbb02";
const PCID_ALICE = "pcid_cccc03";
const PCID_BOB = "pcid_dddd04";

function assert(cond, msg) {
  if (!cond) {
    console.error("ASSERT FAILED:", msg);
    process.exit(1);
  }
}

function assertHttpUrl(s) {
  assert(typeof s === "string" && /^https?:\/\//i.test(s.trim()), `expected HTTP URL, got ${JSON.stringify(s)}`);
}

function collectWarn(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => {
    lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    orig(...a);
  };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return lines;
}

function workspacePoolV2({ pbn, pcm, pm, pam }) {
  return {
    workspaceVersion: 1,
    chapters: [],
    projectSchemaVersion: SCENOGRAFIA_PROJECT_SCHEMA_VERSION_PCID,
    projectMasterImages: pm || {},
    projectMasterByCharName: pbn || {},
    projectCharacterApprovalMap: pam || {},
    projectCharacterMasters: pcm || {},
  };
}

console.log("--- Caso base: 2 capitoli schema 2, merge per pcid ---");
{
  const pool = workspacePoolV2({
    pbn: { maria: PCID_MARIA, giuseppe: PCID_GIUSEPPE },
    pm: { [PCID_MARIA]: URL_MARIA, [PCID_GIUSEPPE]: URL_GIUSEPPE },
    pcm: {
      [PCID_MARIA]: {
        characterId: "char_1",
        characterName: "Maria",
        masterImageUrl: URL_MARIA,
        approved: true,
        source: "test",
      },
      [PCID_GIUSEPPE]: {
        characterId: "char_2",
        characterName: "Giuseppe",
        masterImageUrl: URL_GIUSEPPE,
        approved: false,
        source: "test",
      },
    },
  });
  const chapter = {
    plan: {
      characters: [
        { id: "char_1", name: "Maria", pcid: PCID_MARIA },
        { id: "char_2", name: "Giuseppe", pcid: PCID_GIUSEPPE },
      ],
    },
    masterImages: { [PCID_MARIA]: URL_MARIA },
    masterByCharName: { maria: PCID_MARIA },
    projectCharacterMasters: {
      [PCID_MARIA]: { characterId: "char_1", characterName: "Maria", masterImageUrl: URL_MARIA, source: "ch" },
    },
    characterApprovalMap: {},
  };
  const merged = mergeChapterDataWithProjectCharacterPool(chapter, pool);
  assert(merged.masterByCharName.maria === PCID_MARIA, "mbn maria -> pcid");
  assertHttpUrl(merged.masterImages[PCID_MARIA]);
  assertHttpUrl(merged.masterImages[PCID_GIUSEPPE]);
  assert(merged.projectCharacterMasters[PCID_GIUSEPPE]?.masterImageUrl === URL_GIUSEPPE, "pool pcm giuseppe");
  console.log("ASSERT PASSED: caso base merge pcid");
}

console.log("--- Capitolo nuovo senza pcid: merge assegna pcid dal pool (nome) ---");
{
  const pool = workspacePoolV2({
    pbn: { alice: PCID_ALICE },
    pm: { [PCID_ALICE]: URL_ALICE },
    pcm: {
      [PCID_ALICE]: {
        characterId: "char_9",
        characterName: "Alice",
        masterImageUrl: URL_ALICE,
        approved: true,
        source: "test",
      },
    },
  });
  const chapter = {
    plan: {
      characters: [{ id: "char_1", name: "Alice" }],
    },
    masterImages: { char_1: URL_ALICE },
    masterByCharName: {},
    projectCharacterMasters: {
      char_1: { characterId: "char_1", characterName: "Alice", masterImageUrl: URL_ALICE, source: "legacy" },
    },
    characterApprovalMap: {},
  };
  const merged = mergeChapterDataWithProjectCharacterPool(chapter, pool);
  assert(merged.plan.characters[0].pcid === PCID_ALICE, "pcid assegnato da pool");
  assertHttpUrl(merged.masterImages[PCID_ALICE]);
  assert(!merged.masterImages.char_1 || merged.masterImages.char_1 === undefined, "char_1 key rimossa da masterImages");
  console.log("ASSERT PASSED: capitolo senza pcid");
}

console.log("--- Mismatch pcid-nome: pool ha precedenza ---");
{
  const pool = workspacePoolV2({
    pbn: { bob: PCID_BOB },
    pm: { [PCID_BOB]: URL_BOB },
    pcm: {
      [PCID_BOB]: {
        characterId: "char_x",
        characterName: "Bob",
        masterImageUrl: URL_BOB,
        approved: false,
        source: "test",
      },
    },
  });
  const wrongPcid = "pcid_eeee05";
  const chapter = {
    plan: {
      characters: [{ id: "char_1", name: "Bob", pcid: wrongPcid }],
    },
    masterImages: { [wrongPcid]: URL_BOB },
    masterByCharName: { bob: PCID_BOB },
    projectCharacterMasters: {
      [wrongPcid]: { characterId: "char_1", characterName: "Bob", masterImageUrl: URL_BOB, source: "ch" },
    },
    characterApprovalMap: {},
  };
  const warns = collectWarn(() => {
    mergeChapterDataWithProjectCharacterPool(chapter, pool);
  });
  assert(chapter.plan.characters[0].pcid === PCID_BOB, "chapter pcid allineato al pool");
  assert(warns.some((w) => w.includes("pcid mismatch") && w.includes("poolPcid")), "expected pool precedence warn");
  console.log("ASSERT PASSED: mismatch pcid-nome pool vince");
}

console.log("--- Post-migrazione Maria/Giuseppe: niente id_map_overwritten_from_name_pool con pcid come URL ---");
{
  const pool = workspacePoolV2({
    pbn: { maria: PCID_MARIA, giuseppe: PCID_GIUSEPPE },
    pm: {
      [PCID_MARIA]: URL_MARIA,
      [PCID_GIUSEPPE]: URL_GIUSEPPE,
    },
    pcm: {
      [PCID_MARIA]: {
        characterId: "char_1",
        characterName: "Maria",
        masterImageUrl: URL_MARIA,
        source: "test",
      },
      [PCID_GIUSEPPE]: {
        characterId: "char_2",
        characterName: "Giuseppe",
        masterImageUrl: URL_GIUSEPPE,
        source: "test",
      },
    },
  });
  const chapter = {
    plan: {
      characters: [
        { id: "char_1", name: "Maria", pcid: PCID_MARIA },
        { id: "char_2", name: "Giuseppe", pcid: PCID_GIUSEPPE },
      ],
    },
    masterImages: {
      [PCID_MARIA]: URL_MARIA,
      [PCID_GIUSEPPE]: URL_GIUSEPPE,
    },
    masterByCharName: {
      maria: PCID_MARIA,
      giuseppe: PCID_GIUSEPPE,
    },
    projectCharacterMasters: {
      [PCID_MARIA]: { characterId: "char_1", characterName: "Maria", masterImageUrl: URL_MARIA, source: "ch" },
      [PCID_GIUSEPPE]: { characterId: "char_2", characterName: "Giuseppe", masterImageUrl: URL_GIUSEPPE, source: "ch" },
    },
    characterApprovalMap: {},
  };
  const warns = collectWarn(() => {
    mergeChapterDataWithProjectCharacterPool(chapter, pool);
  });
  const bad = warns.filter(
    (w) =>
      w.includes("id_map_overwritten_from_name_pool") ||
      (w.includes("master riallineati") && w.includes("masterByCharNameUrl") && w.includes("pcid_")),
  );
  assert(bad.length === 0, `unexpected legacy URL/pcid bug logs: ${JSON.stringify(bad)}`);
  for (const v of Object.values(chapter.masterImages)) {
    if (v) assertHttpUrl(String(v));
  }
  console.log("ASSERT PASSED: nessun log bug pcid-in-URL");
}

console.log("--- syncLegacyMapsFromCanonicalPlan + migrate pcm keys ---");
{
  const plan = {
    characters: [{ id: "char_1", name: "Alice", pcid: PCID_ALICE }],
  };
  const pcm = {
    [PCID_ALICE]: {
      characterId: "char_1",
      characterName: "Alice",
      masterImageUrl: URL_ALICE,
      approved: true,
      source: "test",
    },
  };
  const sync = syncLegacyMapsFromCanonicalPlan(plan, pcm);
  assert(sync.masterByCharName.alice === PCID_ALICE, "mbn value is pcid");
  assertHttpUrl(sync.masterImages[PCID_ALICE]);
  const filled = migrateLegacyToProjectCharacterMasters(plan, sync.masterImages, sync.masterByCharName, {}, pcm, {
    forcePcidMode: true,
  });
  assert(filled[PCID_ALICE]?.masterImageUrl === URL_ALICE, "filled keyed by pcid");
  const merged = mergeProjectCharacterMastersFromLegacy(plan, {}, sync.masterImages, sync.masterByCharName, {}, {
    forcePcidMode: true,
  });
  assert(merged[PCID_ALICE]?.masterImageUrl === URL_ALICE, "mergePCM keyed by pcid");
  console.log("ASSERT PASSED: sync + migrate + mergePCM");
}

console.log("--- reconcileCharacterMasterMaps pcid: mismatch usa pool ---");
{
  const wrongBobPcid = "pcid_feed99";
  const plan = {
    characters: [{ id: "char_1", name: "Bob", pcid: wrongBobPcid }],
  };
  const mi = { [wrongBobPcid]: URL_BOB, [PCID_BOB]: URL_BOB };
  const mbn = { bob: PCID_BOB };
  const pcm = {
    [PCID_BOB]: { masterImageUrl: URL_BOB, source: "test" },
  };
  const r = reconcileCharacterMasterMaps(plan, mi, mbn, pcm, { forcePcidMode: true });
  assert(plan.characters[0].pcid === PCID_BOB, "plan pcid aggiornato");
  assert(r.masterByCharName.bob === PCID_BOB, "mbn bob");
  assertHttpUrl(r.masterImages[PCID_BOB]);
  const idMapFix = r.mismatches.filter((m) => m.fix === "id_map_overwritten_from_name_pool");
  assert(idMapFix.length === 0, "no legacy id_map fix in pcid mode");
  assert(r.mismatches.some((m) => m.fix === "pcid_realigned_from_name_pool"), "expected pcid realign mismatch");
  console.log("ASSERT PASSED: reconcile pcid");
}

console.log("");
console.log("ALL ASSERT PASSED — test-pcid-merge.mjs");
