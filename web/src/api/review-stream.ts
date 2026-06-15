import { ApiError } from "./client";

// レビュー 1 回のトークン使用量（コスト可観測性）。inputTokens は新規入力（キャッシュ未ヒット分）。
export interface ReviewUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ReviewDone {
  id: string;
  provider: string;
  model: string;
  repo?: string;
  toolsUsed?: string[];
  truncated?: boolean;
  usage?: ReviewUsage;
}

// エージェントが呼んだツール（透明性表示用）。data は reviewAgent の onEvent("tool") に対応。
export interface ReviewToolEvent {
  name: string;
  arg: Record<string, unknown>;
}

interface StreamHandlers {
  onDelta: (text: string) => void;
  onTool?: (tool: ReviewToolEvent) => void;
  onDone: (meta: ReviewDone) => void;
}

// AI レビューの SSE ストリーム（POST + ?stream=1）。EventSource は GET 専用なので
// fetch のボディを手動で SSE パースする。hono streamSSE の `event:`/`data:` 形式に対応。
export async function streamReview(
  documentId: string,
  opts: { instructions?: string; repo?: boolean },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const path = opts.repo
    ? `/api/documents/${documentId}/review-repo?stream=1`
    : `/api/documents/${documentId}/review?stream=1`;

  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ instructions: opts.instructions }),
    signal,
  });

  if (!res.ok || !res.body) {
    let code = "ERROR";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* 非 JSON はそのまま */
    }
    throw new ApiError(res.status, code, message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let sep: number;
    // SSE イベントは空行（\n\n）区切り。
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);

      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      const data = dataLines.join("\n");

      if (event === "delta") handlers.onDelta(data);
      else if (event === "tool") handlers.onTool?.(JSON.parse(data || "{}") as ReviewToolEvent);
      else if (event === "done") handlers.onDone(JSON.parse(data || "{}") as ReviewDone);
      else if (event === "error") {
        // ループ途中の失敗（converse throw 等）。SSE 開始後なので HTTP 500 は返せず error イベントで通知される。
        const msg = (JSON.parse(data || "{}") as { message?: string }).message;
        throw new ApiError(500, "STREAM_ERROR", msg || "レビューに失敗しました");
      }
    }
  }
}
