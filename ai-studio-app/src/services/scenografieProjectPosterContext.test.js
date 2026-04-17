import { derivePosterVisualStyleLock } from "./scenografieProjectPosterContext.js";

describe("derivePosterVisualStyleLock", () => {
  it("embeds full stylePrompt and does not rely on a generic cinematic default", () => {
    const lock = derivePosterVisualStyleLock({
      presetId: "cinematic",
      label: "Cinematico",
      stylePrompt: "photorealistic 35mm film, natural skin texture, restrained grade",
      plannerVisualNotes: "Cold coastal drama",
      isAnimated: false,
    });
    expect(lock.styleLockBlock).toContain("photorealistic 35mm film");
    expect(lock.styleLockBlock).toContain("Cold coastal drama");
    expect(lock.hasFullStylePrompt).toBe(true);
  });

  it("marks animated projects explicitly", () => {
    const lock = derivePosterVisualStyleLock({
      presetId: "disney",
      label: "Disney",
      stylePrompt: "stylized 3d animation",
      plannerVisualNotes: "",
      isAnimated: true,
    });
    expect(lock.styleLockBlock.toLowerCase()).toContain("animated");
  });

  it("supportingOnly softens single-source phrasing for scene-locked posters", () => {
    const primary = derivePosterVisualStyleLock({
      presetId: "cinematic",
      label: "Cinematic",
      stylePrompt: "bold grade",
      isAnimated: false,
    });
    const supporting = derivePosterVisualStyleLock(
      {
        presetId: "cinematic",
        label: "Cinematic",
        stylePrompt: "bold grade",
        isAnimated: false,
      },
      { supportingOnly: true },
    );
    expect(primary.styleLockBlock).toContain("single source of truth");
    expect(supporting.styleLockBlock).toContain("supporting refinement");
    expect(supporting.styleLockBlock).not.toContain("single source of truth");
    expect(supporting.styleLockBlock).toContain("must NOT contradict");
  });
});
