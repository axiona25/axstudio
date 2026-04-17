/**
 * STEP 4 — scena / cover: characters_present e masterImages per pcid.
 *   cd ai-studio-app && node test-pcid-pipeline-scene.mjs
 */

import { __resetPcidLookupFallbackWarnForTests } from "./src/services/scenografiePcidLookup.js";
import { pickChapterRepresentativeThumbnailUrl } from "./src/services/scenografieChapterCover.js";

function assert(cond, msg) {
  if (!cond) {
    console.error("ASSERT FAILED:", msg);
    process.exit(1);
  }
}

const URL_PCID = "https://example.test/face-pcid.jpg";
const URL_CHAR_LEGACY = "https://example.test/face-char-wrong.jpg";
const PCID_ALICE = "pcid_aaa001";

console.log("--- pickChapterRepresentativeThumbnailUrl: masterImages[pcid] con characters_present pcid ---");
{
  __resetPcidLookupFallbackWarnForTests();
  const chapterData = {
    plan: {
      summary_it: "Alice entra nella stanza",
      characters: [{ id: "char_1", pcid: PCID_ALICE, name: "Alice", is_protagonist: true }],
      scenes: [
        {
          id: "sc_1",
          title_it: "Sala",
          summary_it: "Alice osserva",
          characters_present: [PCID_ALICE],
        },
      ],
    },
    sceneResults: [],
    masterImages: {
      [PCID_ALICE]: URL_PCID,
      char_1: URL_CHAR_LEGACY,
    },
  };
  const url = pickChapterRepresentativeThumbnailUrl(chapterData, { chapterOrdinal: 1 });
  assert(url === URL_PCID, `expected master URL per pcid, got ${url}`);
  console.log("ASSERT PASSED: cover/thumbnail usa masterImages[pcid] (non char_N errato)");
}

console.log("--- pickChapterRepresentativeThumbnailUrl: solo chiave legacy char_N se pcid assente ---");
{
  __resetPcidLookupFallbackWarnForTests();
  const chapterData = {
    plan: {
      summary_it: "Bob",
      characters: [{ id: "char_1", name: "Bob" }],
      scenes: [{ id: "sc_1", title_it: "X", characters_present: ["char_1"] }],
    },
    sceneResults: [],
    masterImages: { char_1: URL_CHAR_LEGACY },
  };
  const url = pickChapterRepresentativeThumbnailUrl(chapterData, {});
  assert(url === URL_CHAR_LEGACY, `fallback char_N atteso, got ${url}`);
  console.log("ASSERT PASSED: fallback masterImages[char_N] se niente pcid");
}

console.log("--- tutti i test pcid-pipeline-scene OK ---");
