import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeFakeLlm, makeHarness, seedMember, textTurn, toolTurn, withUsage, type Harness } from "./helpers/harness";
import { runReviewAgentWithEscalation } from "../src/ai/modelFallback";
import * as schema from "../src/db/schema";

// #84: truncated 昇格（B経路・kb-bot 逆輸入）。
// レビューがターン/ツール上限で打ち切られた時だけ、設定済みの昇格先モデルで一度だけ再実行して救済する。

// MAX_TURNS=6 を使い切らせる: 毎ターン tool_use を返し続けると truncated になる。
function sixToolTurns(name = "get_doc_threads") {
  return Array.from({ length: 6 }, () => toolTurn({ name, input: {} }));
}

const baseOpts = (llm: ReturnType<typeof makeFakeLlm>) => ({
  llm,
  provider: "anthropic",
  model: "base-m",
  apiKey: "k",
  system: "sys",
  initialPrompt: "doc",
  tools: [],
  onEvent: () => {},
});

describe("runReviewAgentWithEscalation（orchestration 単体）", () => {
  it("truncated 時のみ昇格先で一度だけ再実行し、usage は両ティア合算になる", async () => {
    const llm = makeFakeLlm();
    llm.script.push(
      // 1回目（base-m）: 6 ターン全部 tool_use → truncated
      withUsage(toolTurn({ name: "x", input: {} }), {
        inputTokens: 10,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      }),
      ...sixToolTurns("x").slice(1),
      // 2回目（hard-m）: 完走
      withUsage(textTurn("完走したレビュー"), {
        inputTokens: 20,
        outputTokens: 5,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 0,
      }),
    );
    const escalateCalls: string[] = [];
    const run = await runReviewAgentWithEscalation({
      ...baseOpts(llm),
      modelHard: "hard-m",
      onEscalate: (to) => {
        escalateCalls.push(to);
      },
    });
    expect(run.escalated).toBe(true);
    expect(run.modelUsed).toBe("hard-m");
    expect(run.result.truncated).toBe(false);
    expect(run.result.text).toBe("完走したレビュー");
    expect(escalateCalls).toEqual(["hard-m"]);
    // 1回目 6 ターン（base-m）＋ 2回目 1 ターン（hard-m）
    const models = llm.converseCalls.map((c) => c.model);
    expect(models).toEqual([...Array(6).fill("base-m"), "hard-m"]);
    // usage は両 run の合算（実際に支払ったコスト）
    expect(run.result.usage).toEqual({
      inputTokens: 30,
      outputTokens: 6,
      cacheReadInputTokens: 3,
      cacheCreationInputTokens: 0,
    });
  });

  it("truncated でなければ昇格しない（modelHard 設定済みでも）", async () => {
    const llm = makeFakeLlm();
    llm.script.push(textTurn("一発で完了"));
    const run = await runReviewAgentWithEscalation({ ...baseOpts(llm), modelHard: "hard-m" });
    expect(run.escalated).toBe(false);
    expect(run.modelUsed).toBe("base-m");
    expect(llm.converseCalls).toHaveLength(1);
  });

  it("modelHard 未設定・空・基本モデルと同一なら truncated でも昇格しない", async () => {
    for (const modelHard of [undefined, null, "", "base-m"]) {
      const llm = makeFakeLlm();
      llm.script.push(...sixToolTurns("x"));
      const run = await runReviewAgentWithEscalation({ ...baseOpts(llm), modelHard });
      expect(run.escalated).toBe(false);
      expect(run.result.truncated).toBe(true);
      expect(llm.converseCalls).toHaveLength(6); // 再実行なし
    }
  });

  it("昇格先の実行が失敗したら基本モデルの truncated 結果を返す（部分結果を失わない）", async () => {
    const llm = makeFakeLlm();
    llm.script.push(...sixToolTurns("x"));
    const orig = llm.converse.bind(llm);
    llm.converse = async (input) => {
      if (input.model === "hard-m") throw new Error("hard boom");
      return orig(input);
    };
    const run = await runReviewAgentWithEscalation({ ...baseOpts(llm), modelHard: "hard-m" });
    expect(run.escalated).toBe(false);
    expect(run.modelUsed).toBe("base-m");
    expect(run.result.truncated).toBe(true);
  });
});

// メンバー + AI 設定（modelHard 込み）+ 文書。
async function setup(modelHard?: string): Promise<Harness> {
  const h = await makeHarness();
  await seedMember(h, "u@example.com", "member");
  const key = await h.store.put("d1", 1, "# 文書\n本文です");
  await h.db
    .insert(schema.documents)
    .values({ id: "d1", title: "Doc", storageKey: key, version: 1, createdBy: "u@example.com" });
  await h.req("/api/ai/settings", {
    as: "u@example.com",
    method: "PUT",
    body: JSON.stringify({
      provider: "anthropic",
      model: "base-m",
      apiKey: "sk-test",
      ...(modelHard ? { modelHard } : {}),
    }),
  });
  return h;
}

describe("AI 設定の modelHard（#84）", () => {
  it("PUT で保存・GET で返り、空文字/null でクリアできる", async () => {
    const h = await setup("hard-m");
    const got = (await (await h.req("/api/ai/settings", { as: "u@example.com" })).json()) as {
      modelHard: string | null;
    };
    expect(got.modelHard).toBe("hard-m");

    // 空文字 → null（昇格なし）へ正規化
    const cleared = (await (
      await h.req("/api/ai/settings", {
        as: "u@example.com",
        method: "PUT",
        body: JSON.stringify({ provider: "anthropic", modelHard: "" }),
      })
    ).json()) as { modelHard: string | null; model: string | null };
    expect(cleared.modelHard).toBeNull();
    expect(cleared.model).toBe("base-m"); // 他フィールドは維持（read-merge-write）

    // modelHard を省略した PUT では既存値を消さない
    await h.req("/api/ai/settings", {
      as: "u@example.com",
      method: "PUT",
      body: JSON.stringify({ provider: "anthropic", modelHard: "hard-m" }),
    });
    const kept = (await (
      await h.req("/api/ai/settings", {
        as: "u@example.com",
        method: "PUT",
        body: JSON.stringify({ provider: "anthropic", model: "base-m2" }),
      })
    ).json()) as { modelHard: string | null };
    expect(kept.modelHard).toBe("hard-m");
  });
});

describe("POST /api/documents/:id/review の truncated 昇格", () => {
  it("上限到達 → 昇格先で完走し、応答・履歴・イベントに昇格が記録される", async () => {
    const h = await setup("hard-m");
    h.llm.script.push(...sixToolTurns(), textTurn("昇格後の完全なレビュー"));

    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      review: string;
      model: string;
      escalated: boolean;
      truncated: boolean;
    };
    expect(body.review).toBe("昇格後の完全なレビュー");
    expect(body.model).toBe("hard-m");
    expect(body.escalated).toBe(true);
    expect(body.truncated).toBe(false);

    const [saved] = await h.db.select().from(schema.reviews).where(eq(schema.reviews.documentId, "d1"));
    expect(saved!.model).toBe("hard-m");

    const events = await h.db.select().from(schema.aiReviewEvents);
    expect(events.map((e) => e.action)).toContain("model_escalated");
  });

  it("modelHard 未設定なら従来どおり truncated の部分結果を保存する（挙動不変）", async () => {
    const h = await setup();
    h.llm.script.push(...sixToolTurns());

    const res = await h.req("/api/documents/d1/review", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { model: string; escalated: boolean; truncated: boolean };
    expect(body.escalated).toBe(false);
    expect(body.truncated).toBe(true);
    expect(body.model).toBe("base-m");
    expect(h.llm.converseCalls).toHaveLength(6); // 再実行なし
    const events = await h.db.select().from(schema.aiReviewEvents);
    expect(events).toHaveLength(0);
  });

  it("SSE: 昇格時に escalate イベントが流れ、done に escalated が乗る", async () => {
    const h = await setup("hard-m");
    h.llm.script.push(...sixToolTurns(), textTurn("昇格後レビュー"));

    const res = await h.req("/api/documents/d1/review?stream=1", {
      as: "u@example.com",
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: escalate");
    expect(text).toContain('{"to":"hard-m"}');
    expect(text).toContain('"escalated":true');
  });
});
