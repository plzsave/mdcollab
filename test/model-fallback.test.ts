import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeHarness, seedMember, textTurn, type Harness } from "./helpers/harness";
import { isModelNotFoundError, pickFallbackModel } from "../src/ai/modelFallback";
import * as schema from "../src/db/schema";

// #81: モデル退役フォールバック（kb-bot 逆輸入）。
// 保存済みモデルが 404（退役）でも、現存モデル一覧から近縁を選んで一度だけ再試行し完走させる。

describe("isModelNotFoundError", () => {
  it("providers.ts のエラー文（failed: 404）を退役と判定する", () => {
    expect(
      isModelNotFoundError(
        new Error(
          'LLM https://api.anthropic.com/v1/messages failed: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-old"}}',
        ),
      ),
    ).toBe(true);
    expect(
      isModelNotFoundError(
        new Error(
          'LLM https://api.openai.com/v1/chat/completions failed: 404 {"error":{"message":"The model `gpt-old` does not exist","code":"model_not_found"}}',
        ),
      ),
    ).toBe(true);
  });

  it("SDK 形式（status/code プロパティ）と退役系メッセージも判定する", () => {
    expect(isModelNotFoundError({ status: 404 })).toBe(true);
    expect(isModelNotFoundError({ code: 404 })).toBe(true);
    expect(isModelNotFoundError(new Error("The model has been deprecated"))).toBe(true);
  });

  it("退役以外のエラー（429/500/ネットワーク）は判定しない", () => {
    expect(isModelNotFoundError(new Error("LLM https://x/v1/messages failed: 429 rate limited"))).toBe(false);
    expect(isModelNotFoundError(new Error("LLM https://x/v1/messages failed: 500 boom"))).toBe(false);
    expect(isModelNotFoundError(new Error("fetch failed"))).toBe(false);
    expect(isModelNotFoundError(null)).toBe(false);
    expect(isModelNotFoundError("404")).toBe(false);
  });
});

describe("pickFallbackModel", () => {
  it("最長共通接頭辞の現存モデルを選ぶ（同系統・同ファミリー優先）", () => {
    expect(
      pickFallbackModel("claude-sonnet-4-20250514", ["o4-mini", "claude-opus-9", "claude-sonnet-9"]),
    ).toBe("claude-sonnet-9");
  });

  it("同点なら短い id（派生より基準モデル）を選ぶ", () => {
    expect(pickFallbackModel("gpt-4o", ["gpt-4o-mini-2024", "gpt-4o-mini"])).toBe("gpt-4o-mini");
  });

  it("チャット用途でないモデル（embedding/tts 等）は候補から外す", () => {
    expect(pickFallbackModel("gpt-4o", ["gpt-4o-mini-tts", "gpt-4o-transcribe", "gpt-4o-mini"])).toBe(
      "gpt-4o-mini",
    );
  });

  it("近縁が居ない（共通接頭辞 3 文字未満）・空一覧・自分自身のみは null", () => {
    expect(pickFallbackModel("o3", ["claude-x", "gemini-y"])).toBeNull();
    expect(pickFallbackModel("claude-old", [])).toBeNull();
    expect(pickFallbackModel("claude-old", ["claude-old"])).toBeNull();
  });
});

// メンバー + 退役モデルの AI 設定 + 本文付き文書。
async function setupRetired(): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  const key = await h.store.put("d1", 1, "# 文書\n本文です");
  await h.db
    .insert(schema.documents)
    .values({ id: "d1", title: "Doc", storageKey: key, version: 1, createdBy: "u@example.com" });
  await h.req("/api/ai/settings", {
    as: "u@example.com",
    method: "PUT",
    body: JSON.stringify({ provider: "anthropic", model: "claude-retired", apiKey: "sk-test" }),
  });
  return h;
}

// fake llm を「claude-retired だけ 404 を投げる」ように包む。
function retireModel(h: Harness, retired: string, alive: string[]) {
  const orig = h.llm.converse.bind(h.llm);
  h.llm.converse = async (input) => {
    if (input.model === retired) {
      throw new Error(
        `LLM https://api.anthropic.com/v1/messages failed: 404 {"type":"error","error":{"type":"not_found_error","message":"model: ${retired}"}}`,
      );
    }
    return orig(input);
  };
  h.llm.listModels = async () => alive;
}

describe("POST /api/documents/:id/review のモデル退役フォールバック", () => {
  it("退役モデルでも近縁の現存モデルで完走し、履歴・応答・イベントに記録される", async () => {
    const h = await setupRetired();
    retireModel(h, "claude-retired", ["gpt-x", "claude-alive"]);
    h.llm.script.push(textTurn("指摘: OK"));

    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { review: string; model: string; fellBack: boolean };
    expect(body.review).toBe("指摘: OK");
    expect(body.model).toBe("claude-alive"); // 実際に使ったモデルを返す
    expect(body.fellBack).toBe(true);

    // 履歴も実際に使ったモデルで保存される
    const [saved] = await h.db.select().from(schema.reviews).where(eq(schema.reviews.documentId, "d1"));
    expect(saved!.model).toBe("claude-alive");

    // content-free の運用イベントに model_fallback が残る
    const events = await h.db.select().from(schema.aiReviewEvents);
    expect(events.map((e) => e.action)).toContain("model_fallback");
  });

  it("現役モデルなら従来どおり（フォールバックせず fellBack=false）", async () => {
    const h = await setupRetired();
    // 退役させない（そのまま）。設定モデル claude-retired で普通に応答する。
    h.llm.script.push(textTurn("指摘: OK"));
    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { model: string; fellBack: boolean };
    expect(body.model).toBe("claude-retired");
    expect(body.fellBack).toBe(false);
    const events = await h.db.select().from(schema.aiReviewEvents);
    expect(events).toHaveLength(0);
  });

  it("近縁の現存モデルが無ければ元のエラーのまま失敗する（設定し直しを促す）", async () => {
    const h = await setupRetired();
    retireModel(h, "claude-retired", ["gpt-x", "o4-mini"]); // claude 系が居ない
    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
  });

  it("退役以外のエラー（500 等）はフォールバックせずそのまま失敗する", async () => {
    const h = await setupRetired();
    h.llm.converse = async () => {
      throw new Error("LLM https://api.anthropic.com/v1/messages failed: 500 boom");
    };
    let listed = 0;
    h.llm.listModels = async () => {
      listed++;
      return ["claude-alive"];
    };
    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
    expect(listed).toBe(0); // 一覧取得すら行わない
  });
});
