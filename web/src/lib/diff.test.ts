import { describe, expect, it } from "vitest";
import { lineDiff } from "./diff";

describe("lineDiff", () => {
  it("追加行を add として検出する", () => {
    const rows = lineDiff("a\nb", "a\nb\nc");
    expect(rows).toEqual([
      { t: "ctx", text: "a" },
      { t: "ctx", text: "b" },
      { t: "add", text: "c" },
    ]);
  });

  it("削除行を del として検出する", () => {
    const rows = lineDiff("a\nb\nc", "a\nc");
    expect(rows).toEqual([
      { t: "ctx", text: "a" },
      { t: "del", text: "b" },
      { t: "ctx", text: "c" },
    ]);
  });

  it("変更行は del + add の組になる", () => {
    const rows = lineDiff("a\nold\nz", "a\nnew\nz");
    expect(rows).toEqual([
      { t: "ctx", text: "a" },
      { t: "del", text: "old" },
      { t: "add", text: "new" },
      { t: "ctx", text: "z" },
    ]);
  });

  it("同一テキストは全行 ctx", () => {
    const rows = lineDiff("a\nb", "a\nb");
    expect(rows?.every((r) => r.t === "ctx")).toBe(true);
  });

  it("空 → 本文 は全行 add、本文 → 空 は全行 del（空行1行分の ctx/組を含む）", () => {
    // "" は split で [""]（空1行）になるため、完全な add/del とはならず組が混ざる
    const added = lineDiff("", "x\ny");
    expect(added?.filter((r) => r.t === "add").map((r) => r.text)).toEqual(["x", "y"]);
    const deleted = lineDiff("x\ny", "");
    expect(deleted?.filter((r) => r.t === "del").map((r) => r.text)).toEqual(["x", "y"]);
  });

  it("行の再掲（移動）でも LCS として妥当な差分になる", () => {
    const rows = lineDiff("a\nb\nc", "b\nc\na");
    // LCS は "b\nc"（長さ2）: a が del → ctx b,c → a が add
    expect(rows).toEqual([
      { t: "del", text: "a" },
      { t: "ctx", text: "b" },
      { t: "ctx", text: "c" },
      { t: "add", text: "a" },
    ]);
  });

  it("巨大入力（行数の積が上限超え）は null を返す", () => {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
    expect(lineDiff(big, `${big}\nx`)).toBeNull();
  });

  it("null/undefined 相当の入力でも例外を投げない", () => {
    expect(lineDiff(null as unknown as string, "a")).not.toBeNull();
    expect(lineDiff("a", undefined as unknown as string)).not.toBeNull();
  });
});
