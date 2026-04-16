/**
 * STEP 4 — lookup UI / master per pcid (con fallback char_N).
 *   cd ai-studio-app && node test-pcid-ui-lookup.mjs
 */

import {
  __resetPcidLookupFallbackWarnForTests,
  findPlanCharacterByPresentRef,
  getDisplayMasterUrl,
  resolveMasterUrlForPlanChar,
} from "./src/services/scenografiePcidLookup.js";

function assert(cond, msg) {
  if (!cond) {
    console.error("ASSERT FAILED:", msg);
    process.exit(1);
  }
}

const URL_ALICE = "https://example.test/alice-master.jpg";
const URL_BOB = "https://example.test/bob-master.jpg";
const PCID_ALICE = "pcid_aaa001";
const PCID_BOB = "pcid_bbb002";

console.log("--- resolveMasterUrlForPlanChar: masterImages per pcid, non char_N ---");
{
  __resetPcidLookupFallbackWarnForTests();
  const charAlice = { id: "char_1", pcid: PCID_ALICE, name: "Alice" };
  const plan = { characters: [charAlice, { id: "char_2", pcid: PCID_BOB, name: "Bob" }] };
  const masterImages = { [PCID_ALICE]: URL_ALICE, char_1: "https://wrong.example/old.jpg" };
  const u = resolveMasterUrlForPlanChar(charAlice, masterImages, {});
  assert(u === URL_ALICE, `expected Alice URL by pcid, got ${u}`);
  console.log("ASSERT PASSED: resolveMasterUrlForPlanChar usa masterImages[pcid]");
}

console.log("--- resolveMasterUrlForPlanChar: masterByCharName con valore pcid ---");
{
  __resetPcidLookupFallbackWarnForTests();
  const charAlice = { id: "char_1", pcid: PCID_ALICE, name: "Alice" };
  const masterImages = { [PCID_ALICE]: URL_ALICE };
  const masterByCharName = { alice: PCID_ALICE };
  const u = resolveMasterUrlForPlanChar(charAlice, masterImages, masterByCharName);
  assert(u === URL_ALICE, `expected URL da mbn pcid → masterImages, got ${u}`);
  console.log("ASSERT PASSED: masterByCharName risolve pcid → URL");
}

console.log("--- getDisplayMasterUrl: projectCharacterMasters keyed by pcid ---");
{
  __resetPcidLookupFallbackWarnForTests();
  const charBob = { id: "char_2", pcid: PCID_BOB, name: "Bob" };
  const pcm = { [PCID_BOB]: { masterImageUrl: URL_BOB }, char_2: { masterImageUrl: "https://wrong.example/x.jpg" } };
  const u = getDisplayMasterUrl(charBob, pcm);
  assert(u === URL_BOB, `expected pcm[pcid], got ${u}`);
  console.log("ASSERT PASSED: getDisplayMasterUrl preferisce riga pcm[pcid]");
}

console.log("--- findPlanCharacterByPresentRef: ref pcid e ref char_N ---");
{
  __resetPcidLookupFallbackWarnForTests();
  const plan = {
    characters: [
      { id: "char_1", pcid: PCID_ALICE, name: "Alice" },
      { id: "char_2", name: "NoPcid" },
    ],
  };
  const a = findPlanCharacterByPresentRef(plan, PCID_ALICE);
  assert(a?.name === "Alice", "lookup by pcid");
  const b = findPlanCharacterByPresentRef(plan, "char_2");
  assert(b?.name === "NoPcid", "lookup by char_N");
  console.log("ASSERT PASSED: findPlanCharacterByPresentRef pcid e id locale");
}

console.log("--- tutti i test pcid-ui-lookup OK ---");
