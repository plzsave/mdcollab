import { describe, expect, it, beforeEach } from "vitest";
import { clearDraft, loadDraft, saveDraft } from "./draft";

describe("draft store", () => {
  beforeEach(() => localStorage.clear());

  it("保存した下書きを読み戻せる", () => {
    saveDraft("doc1", { content: "# wip", baseVersion: 2, savedAt: 123 });
    expect(loadDraft("doc1")).toEqual({ content: "# wip", baseVersion: 2, savedAt: 123 });
  });

  it("存在しない場合は null", () => {
    expect(loadDraft("none")).toBeNull();
  });

  it("clear で消える", () => {
    saveDraft("doc1", { content: "x", baseVersion: 1, savedAt: 0 });
    clearDraft("doc1");
    expect(loadDraft("doc1")).toBeNull();
  });

  it("壊れた JSON は null を返す", () => {
    localStorage.setItem("mdcollab:draft:doc1", "{not json");
    expect(loadDraft("doc1")).toBeNull();
  });
});
