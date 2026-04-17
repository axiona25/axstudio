import {
  HOME_SHELF_GRID_NORMAL,
  HOME_SHELF_GRID_COMPACT,
  computeShelfGridMetrics,
  shelfGridContentMinHeight,
} from "./shelfGridMetrics.js";

describe("computeShelfGridMetrics", () => {
  test("normal 4×4: cell height = (H − 3*gap) / 4", () => {
    const m = computeShelfGridMetrics(400, 500, HOME_SHELF_GRID_NORMAL);
    expect(m.columns).toBe(4);
    expect(m.visibleRows).toBe(4);
    expect(m.gap).toBe(10);
    const rowGaps = 3 * 10;
    expect(m.cellHeight).toBeCloseTo((500 - rowGaps) / 4, 10);
    const colGaps = 3 * 10;
    expect(m.cellWidth).toBe(Math.floor((400 - colGaps) / 4));
  });

  test("compact 8×8: cell height = (H − 7*gap) / 8", () => {
    const m = computeShelfGridMetrics(800, 600, HOME_SHELF_GRID_COMPACT);
    expect(m.columns).toBe(8);
    expect(m.visibleRows).toBe(8);
    expect(m.gap).toBe(6);
    const rowGaps = 7 * 6;
    expect(m.cellHeight).toBeCloseTo((600 - rowGaps) / 8, 10);
  });
});

describe("shelfGridContentMinHeight", () => {
  test("0 items → 0 (no fake row height)", () => {
    expect(shelfGridContentMinHeight(0, 4, 100, 10)).toBe(0);
  });

  test("16 items, 4 cols, 4 rows worth of content — no extra row vs viewport", () => {
    const gap = 10;
    const cellH = 100;
    const h = shelfGridContentMinHeight(16, 4, cellH, gap);
    expect(h).toBe(4 * cellH + 3 * gap);
  });

  test("17 items needs 5 rows", () => {
    const gap = 10;
    const cellH = 100;
    const h = shelfGridContentMinHeight(17, 4, cellH, gap);
    expect(h).toBe(5 * cellH + 4 * gap);
  });

  test("64 items compact 8 cols", () => {
    const h = shelfGridContentMinHeight(64, 8, 50, 6);
    expect(h).toBe(8 * 50 + 7 * 6);
  });

  test("65 items compact needs 9 rows", () => {
    const h = shelfGridContentMinHeight(65, 8, 50, 6);
    expect(h).toBe(9 * 50 + 8 * 6);
  });
});
