import { runReviewAgent, type RunReviewAgentOpts, type RunReviewAgentResult } from "./reviewAgent";

// モデル退役フォールバック（#81・kb-bot 逆輸入）。
// メンバーが AI 設定に保存したモデル名は、稼働中に退役して 404 を返し始めることがある。
// その場合に「本人のキーで取得した現存モデル一覧」から退役モデルに最も近いものを選び、
// 一度だけ再試行してレビュー/改稿を完走させる。
// 既定モデルのハードコードは持たない: モデル ID は動的情報なので、一覧から都度選ぶ＝自己更新。

// LLM 呼び出しが「指定モデルが存在しない/退役した」で失敗したかの判定（プロバイダ非依存）。
// providers.ts は fetch 失敗を Error("LLM <url> failed: <status> <body>") で投げるため、
// 第一義はメッセージ中の HTTP 404（エンドポイントは固定なので converse の 404 ≒ モデル不明）。
// 保険としてプロバイダのエラー本文（anthropic: not_found_error / openai: model_not_found,
// "does not exist"）と、SDK 形式のオブジェクト（status/code プロパティ）も見る。
export function isModelNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (e.status === 404 || e.code === 404) return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (!msg) return false;
  if (/\bfailed: 404\b/.test(msg)) return true;
  return (
    msg.includes("not_found") ||
    msg.includes("does not exist") ||
    (msg.includes("model") && (msg.includes("deprecat") || msg.includes("retired")))
  );
}

// チャット用途でない OpenAI モデル（embedding/音声/画像等）は候補から外す。
// 能力名はモデルのバージョンと違い安定しているため、小さな除外リストで足りる。
const NON_CHAT_RE = /(embed|whisper|tts|audio|realtime|image|dall-e|moderation|transcribe)/i;

// 退役モデルの代替を現存一覧から選ぶ:
//   最長共通接頭辞（同系統・同ファミリーほど長い）→ 短い id（派生より基準モデル）→ 一覧順。
// 共通接頭辞が 3 文字未満しかない（＝近縁が居ない）場合は null（呼び出し側で元エラーのまま返し、
// ユーザーに設定し直しを促す）。
export function pickFallbackModel(failed: string, available: string[]): string | null {
  const lcp = (a: string, b: string): number => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };
  let best: { id: string; prefix: number; order: number } | null = null;
  for (const [order, id] of available.entries()) {
    if (id === failed || NON_CHAT_RE.test(id)) continue;
    const prefix = lcp(failed, id);
    if (prefix < 3) continue;
    if (
      !best ||
      prefix > best.prefix ||
      (prefix === best.prefix && id.length < best.id.length) ||
      (prefix === best.prefix && id.length === best.id.length && order < best.order)
    ) {
      best = { id, prefix, order };
    }
  }
  return best?.id ?? null;
}

export interface FallbackRun {
  result: RunReviewAgentResult;
  /** 実際にレビューを完走したモデル（フォールバック時は代替モデル）。 */
  modelUsed: string;
  fellBack: boolean;
}

// runReviewAgent を実行し、指定モデルが存在しない/退役なら代替モデルで一度だけ再試行する。
// 代替が見つからない・代替でも失敗する場合はそのまま投げる（呼び出し側の通常エラー処理へ）。
export async function runReviewAgentWithModelFallback(
  opts: RunReviewAgentOpts,
): Promise<FallbackRun> {
  try {
    return { result: await runReviewAgent(opts), modelUsed: opts.model, fellBack: false };
  } catch (e) {
    if (!isModelNotFoundError(e)) throw e;
    const available = await opts.llm.listModels(opts.provider, opts.apiKey).catch(() => []);
    const fallback = pickFallbackModel(opts.model, available);
    if (!fallback) throw e;
    console.warn(
      `[model-fallback] model=${opts.model} が利用不可（退役の可能性）。${fallback} で再試行します。`,
    );
    const result = await runReviewAgent({ ...opts, model: fallback });
    return { result, modelUsed: fallback, fellBack: true };
  }
}
