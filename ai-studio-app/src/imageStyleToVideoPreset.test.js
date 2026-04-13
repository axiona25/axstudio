import {
  resolveVideoPresetFromImageMeta,
  resolveVideoPresetFromStyleId,
  resolveVideoPresetsFromStyleIds,
  VALID_VIDEO_PRESET_IDS,
  ALIAS_MAP,
  normalizeKey,
  resolveOne,
} from "./imageStyleToVideoPreset";

// ─────────────────────────────────────────────────────────
// normalizeKey
// ─────────────────────────────────────────────────────────
describe("normalizeKey", () => {
  it("lowercases and trims", () => {
    expect(normalizeKey("  Realistic ")).toBe("realistic");
  });
  it("replaces hyphens and underscores with spaces", () => {
    expect(normalizeKey("comic-book")).toBe("comic book");
    expect(normalizeKey("comic_book")).toBe("comic book");
  });
  it("collapses multiple spaces", () => {
    expect(normalizeKey("cel   anime")).toBe("cel anime");
  });
});

// ─────────────────────────────────────────────────────────
// resolveOne — direct ID
// ─────────────────────────────────────────────────────────
describe("resolveOne — direct IDs", () => {
  for (const id of VALID_VIDEO_PRESET_IDS) {
    it(`maps direct ID "${id}" with high confidence`, () => {
      const r = resolveOne(id);
      expect(r).toEqual({ presetId: id, confidence: "high" });
    });
  }
});

// ─────────────────────────────────────────────────────────
// resolveOne — aliases (sinonimi espliciti dal task)
// ─────────────────────────────────────────────────────────
describe("resolveOne — required alias groups", () => {
  const cases = [
    // comic group
    ["comic-book", "comic"],
    ["comic", "comic"],
    ["graphic novel", "comic"],
    ["fumetto", "comic"],

    // anime group
    ["anime", "anime"],
    ["manga anime", "anime"],
    ["cel anime", "anime"],

    // cartoon group
    ["cartoon", "cartoon"],
    ["3d cartoon", "cartoon"],
    ["animated", "cartoon"],

    // realistic group
    ["realistic", "realistic"],
    ["photoreal", "realistic"],
    ["cinematic realism", "realistic"],
    ["photorealistic", "realistic"],

    // clay group
    ["clay", "clay"],
    ["claymation", "clay"],
    ["plasticine", "clay"],
    ["stop-motion", "clay"],
  ];

  it.each(cases)('"%s" → "%s"', (input, expected) => {
    const r = resolveOne(input);
    expect(r).not.toBeNull();
    expect(r.presetId).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────
// resolveOne — tag con @
// ─────────────────────────────────────────────────────────
describe("resolveOne — @ tags", () => {
  it("@realistico → realistic", () => {
    expect(resolveOne("@realistico")).toEqual({ presetId: "realistic", confidence: "high" });
  });
  it("@fumetto → comic", () => {
    expect(resolveOne("@fumetto")).toEqual({ presetId: "comic", confidence: "high" });
  });
  it("@anime → anime", () => {
    expect(resolveOne("@anime")).toEqual({ presetId: "anime", confidence: "high" });
  });
});

// ─────────────────────────────────────────────────────────
// resolveOne — null per input sconosciuti
// ─────────────────────────────────────────────────────────
describe("resolveOne — unknown / null", () => {
  it("returns null for empty string", () => {
    expect(resolveOne("")).toBeNull();
  });
  it("returns null for null", () => {
    expect(resolveOne(null)).toBeNull();
  });
  it("returns null for unrecognized style", () => {
    expect(resolveOne("totally_unknown_style_xyz")).toBeNull();
  });
  it("returns null for number", () => {
    expect(resolveOne(42)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
// resolveVideoPresetFromImageMeta
// ─────────────────────────────────────────────────────────
describe("resolveVideoPresetFromImageMeta", () => {
  it("returns null for null/undefined metadata", () => {
    expect(resolveVideoPresetFromImageMeta(null)).toBeNull();
    expect(resolveVideoPresetFromImageMeta(undefined)).toBeNull();
  });

  it("returns null for empty metadata", () => {
    expect(resolveVideoPresetFromImageMeta({})).toBeNull();
  });

  it("resolves from selectedStyles (priority 1)", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: ["anime"],
      prompt: "a warrior in @realistic style",
    });
    expect(r).toEqual({ presetId: "anime", confidence: "high", source: "selectedStyles" });
  });

  it("skips unknown styles and resolves next", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: ["totally_unknown", "comic"],
    });
    expect(r).toEqual({ presetId: "comic", confidence: "high", source: "selectedStyles" });
  });

  it("falls back to prompt tag if selectedStyles empty", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "a hero in @fumetto style battling villains",
    });
    expect(r).toEqual({ presetId: "comic", confidence: "medium", source: "promptTag" });
  });

  it("falls back to userIdea tag", () => {
    const r = resolveVideoPresetFromImageMeta({
      userIdea: "disegno @anime di un samurai",
    });
    expect(r).toEqual({ presetId: "anime", confidence: "medium", source: "promptTag" });
  });

  it("returns null when no signal is available", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "a beautiful landscape with mountains",
    });
    expect(r).toBeNull();
  });

  it("returns null when selectedStyles are all unrecognized and no tags", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: ["xxx", "yyy"],
      prompt: "something without tags",
    });
    expect(r).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
// resolveVideoPresetFromStyleId
// ─────────────────────────────────────────────────────────
describe("resolveVideoPresetFromStyleId", () => {
  it("resolves direct id", () => {
    expect(resolveVideoPresetFromStyleId("clay")).toEqual({ presetId: "clay", confidence: "high" });
  });
  it("resolves alias", () => {
    expect(resolveVideoPresetFromStyleId("claymation")).toEqual({ presetId: "clay", confidence: "high" });
  });
  it("returns null for unknown", () => {
    expect(resolveVideoPresetFromStyleId("unicorn_dream")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
// resolveVideoPresetsFromStyleIds — batch
// ─────────────────────────────────────────────────────────
describe("resolveVideoPresetsFromStyleIds", () => {
  it("maps multiple IDs and deduplicates", () => {
    const r = resolveVideoPresetsFromStyleIds(["anime", "cel anime", "comic"]);
    expect(r).toHaveLength(2);
    expect(r[0].presetId).toBe("anime");
    expect(r[1].presetId).toBe("comic");
  });

  it("returns empty for empty input", () => {
    expect(resolveVideoPresetsFromStyleIds([])).toEqual([]);
  });

  it("returns empty for non-array", () => {
    expect(resolveVideoPresetsFromStyleIds("anime")).toEqual([]);
  });

  it("skips unmappable and keeps mappable", () => {
    const r = resolveVideoPresetsFromStyleIds(["unknown", "realistic", "also_unknown"]);
    expect(r).toHaveLength(1);
    expect(r[0].presetId).toBe("realistic");
  });
});

// ─────────────────────────────────────────────────────────
// ALIAS_MAP integrity — ogni alias punta a un preset valido
// ─────────────────────────────────────────────────────────
describe("ALIAS_MAP integrity", () => {
  it("all alias values are valid video preset IDs", () => {
    for (const [alias, target] of Object.entries(ALIAS_MAP)) {
      expect(VALID_VIDEO_PRESET_IDS.has(target)).toBe(true);
    }
  });

  it("all canonical IDs have at least themselves as alias", () => {
    for (const id of VALID_VIDEO_PRESET_IDS) {
      expect(ALIAS_MAP[id]).toBe(id);
    }
  });
});
