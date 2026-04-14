import {
  resolveVideoPresetFromImageMeta,
  resolveVideoPresetFromStyleId,
  resolveVideoPresetsFromStyleIds,
  resolveVideoPresetFromFilename,
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

  // ── promptKeyword fallback (step 3) ──

  it("detects 'anime' keyword in promptEN when no selectedStyles", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "anime character with sword in the rain",
    });
    expect(r).toEqual({ presetId: "anime", confidence: "medium", source: "promptKeyword" });
  });

  it("detects 'anime' keyword in userIdea (Italian) when no selectedStyles", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      userIdea: "personaggio anime con spada sotto la pioggia",
    });
    expect(r).toEqual({ presetId: "anime", confidence: "medium", source: "promptKeyword" });
  });

  it("detects 'comic book' multi-word keyword in prompt", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "a comic book hero fighting villains",
    });
    expect(r).toEqual({ presetId: "comic", confidence: "medium", source: "promptKeyword" });
  });

  it("detects 'cel shading' keyword in prompt", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "a warrior in cel shading style, dramatic pose",
    });
    expect(r).toEqual({ presetId: "anime", confidence: "medium", source: "promptKeyword" });
  });

  it("detects 'claymation' keyword in prompt", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "claymation figure walking through a forest",
    });
    expect(r).toEqual({ presetId: "clay", confidence: "medium", source: "promptKeyword" });
  });

  it("detects 'cartoon' keyword in prompt", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "a cartoon rabbit running in a field",
    });
    expect(r).toEqual({ presetId: "cartoon", confidence: "medium", source: "promptKeyword" });
  });

  it("detects 'realistic' in prompt when no style selected", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "a realistic portrait of a woman in studio light",
    });
    expect(r).toEqual({ presetId: "realistic", confidence: "medium", source: "promptKeyword" });
  });

  it("does NOT match 'anime' when part of a longer word", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "inanimate object on a shelf",
    });
    expect(r).toBeNull();
  });

  it("does NOT match blocklisted generic words like 'photo'", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "a photo of a cat sitting on a windowsill",
    });
    expect(r).toBeNull();
  });

  it("selectedStyles still takes priority over prompt keyword", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: ["realistic"],
      prompt: "anime character jumping over a building",
    });
    expect(r).toEqual({ presetId: "realistic", confidence: "high", source: "selectedStyles" });
  });

  it("@tag still takes priority over prompt keyword", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "an @fumetto style anime hero",
    });
    expect(r).toEqual({ presetId: "comic", confidence: "medium", source: "promptTag" });
  });

  // ── promptFull fallback (step 5) ──

  it("falls back to promptFull when prompt and userIdea have no style keywords", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "A mountain landscape with sunset sky",
      userIdea: "paesaggio montano con cielo al tramonto",
      promptFull: "A mountain landscape with sunset sky, watercolor wash, soft pastel palette, delicate brushstrokes",
    });
    expect(r).toEqual({ presetId: "watercolor", confidence: "low", source: "promptFullKeyword" });
  });

  it("promptFull is NOT used if prompt already matched", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "anime warrior in a forest",
      promptFull: "anime warrior in a forest, watercolor wash, soft pastel palette",
    });
    expect(r).toEqual({ presetId: "anime", confidence: "medium", source: "promptKeyword" });
  });

  it("promptFull detects painting style from injected style prefix", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "A serene lake surrounded by trees",
      promptFull: "A serene lake surrounded by trees, oil painting, old master aesthetic, classical painting style, rich color palette",
    });
    expect(r).toEqual({ presetId: "painting", confidence: "low", source: "promptFullKeyword" });
  });

  it("promptFull returns null when only generic words present", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      prompt: "A beautiful sunset",
      promptFull: "A beautiful sunset, RAW photograph, natural skin texture, photorealistic, highly detailed, 8K",
    });
    expect(r).not.toBeNull();
    expect(r.source).toBe("promptFullKeyword");
  });

  // ── template fallback (step 2) ──

  it("resolves template if it matches an alias", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      template: "noir",
      prompt: "A mysterious figure in an alley",
    });
    expect(r).toEqual({ presetId: "noir", confidence: "medium", source: "template" });
  });

  it("ignores unrecognized template", () => {
    const r = resolveVideoPresetFromImageMeta({
      selectedStyles: [],
      template: "outdoor",
      prompt: "A meadow with flowers",
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

// ─────────────────────────────────────────────────────────
// resolveVideoPresetFromFilename
// ─────────────────────────────────────────────────────────
describe("resolveVideoPresetFromFilename", () => {
  it("returns null for null/undefined/empty", () => {
    expect(resolveVideoPresetFromFilename(null)).toBeNull();
    expect(resolveVideoPresetFromFilename(undefined)).toBeNull();
    expect(resolveVideoPresetFromFilename("")).toBeNull();
  });

  it("returns null for short or generic filenames", () => {
    expect(resolveVideoPresetFromFilename("a.png")).toBeNull();
    expect(resolveVideoPresetFromFilename("photo.jpg")).toBeNull();
    expect(resolveVideoPresetFromFilename("IMG_2024.png")).toBeNull();
  });

  it("detects anime from filename", () => {
    const r = resolveVideoPresetFromFilename("my_anime_girl.png");
    expect(r).not.toBeNull();
    expect(r.presetId).toBe("anime");
    expect(r.confidence).toBe("medium");
  });

  it("detects comic from filename", () => {
    expect(resolveVideoPresetFromFilename("comic-book-hero.jpg").presetId).toBe("comic");
    expect(resolveVideoPresetFromFilename("fumetto_style.png").presetId).toBe("comic");
  });

  it("detects realistic from filename", () => {
    expect(resolveVideoPresetFromFilename("realistic_portrait.png").presetId).toBe("realistic");
    expect(resolveVideoPresetFromFilename("photoreal_scene.jpg").presetId).toBe("realistic");
  });

  it("detects cartoon from filename", () => {
    expect(resolveVideoPresetFromFilename("cartoon_character.png").presetId).toBe("cartoon");
  });

  it("detects clay from filename", () => {
    expect(resolveVideoPresetFromFilename("claymation-figure.png").presetId).toBe("clay");
  });

  it("detects cyberpunk from filename", () => {
    expect(resolveVideoPresetFromFilename("cyberpunk_city.jpg").presetId).toBe("cyberpunk");
  });

  it("detects fantasy from filename", () => {
    expect(resolveVideoPresetFromFilename("fantasy_dragon.png").presetId).toBe("fantasy");
  });

  it("is case insensitive", () => {
    expect(resolveVideoPresetFromFilename("ANIME_Hero.PNG").presetId).toBe("anime");
  });

  it("strips extension before matching", () => {
    expect(resolveVideoPresetFromFilename("test.anime.png").presetId).toBe("anime");
  });
});
