// ① 指摘のコメントスレッド化：アンカー当たり率のスパイク計測（手動・BYO-key・CI 非搭載）。
//
// 目的: 「AI に本文から逐語引用させ、その quote を本文中の実スパンへアンカーできるか」の
//       当たり率（exact / 空白正規化 / 失敗 / 曖昧）を実モデルで実測し、① の go/no-go を数字で判断する。
//       ライブのレビュー経路・web・スキーマは一切触らない（純粋な検証スパイク）。
//
// 実行:
//   EVAL_MODEL=claude-opus-4-8 ANTHROPIC_API_KEY=sk-... bun run eval:anchor
//   EVAL_PROVIDER=openai EVAL_MODEL=gpt-4o OPENAI_API_KEY=sk-... bun run eval:anchor
//
// 注: web のハイライトはレンダリング後テキストへ indexOf で当てる（web/src/lib/highlight.ts）。
//     本スパイクは「逐語スパンを再現できるか」を生 Markdown 本文に対して測る一次指標。
//     高ければ次段で『レンダリング後テキストへの対応づけ』を詰める。低ければ ① は要再設計。
import { createLlmClient } from "../src/llm/providers";
import { anchorQuote, parseFindings } from "../src/ai/findings";

interface Doc {
  name: string;
  body: string;
}

// 既知の問題を仕込んだゴールデン文書（逐語引用しやすいよう、本文に固有語を含める）。
const DOCS: Doc[] = [
  {
    name: "API ガイド（事実誤り）",
    body: "# API ガイド\n\n本 API は成功時に HTTP 200 を返します。なお 200 はリクエスト失敗を表すため、クライアントは 200 を受け取ったら必ずリトライしてください。タイムアウトは 30 秒です。\n",
  },
  {
    name: "設計メモ（曖昧・受動態）",
    body: "# 設計メモ\n\nデータは適切に処理されます。エラーは必要に応じて対応されます。キャッシュは十分な期間保持され、パフォーマンスは確保されています。\n",
  },
  {
    name: "手順書（用語ゆれ・壊れたリンク）",
    body: "# セットアップ手順\n\nまず利用者はアカウントを作成します。次にユーザは API キーを発行します。詳細は [こちら](http:// を参照してください。最後にユーザーは疎通確認を行います。\n",
  },
];

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env ${name}`);
    process.exit(2);
  }
  return v;
}

function resolveApiKey(provider: string): string {
  if (process.env.EVAL_API_KEY) return process.env.EVAL_API_KEY;
  if (provider === "anthropic") return required("ANTHROPIC_API_KEY");
  if (provider === "openai") return required("OPENAI_API_KEY");
  return required("EVAL_API_KEY");
}

const SYSTEM =
  "あなたはテクニカルライティングのレビュアーです。指摘を JSON 配列だけで返します（前後の説明やコードフェンスは付けない）。" +
  '各要素は {"quote": 本文からの逐語引用(5〜15語程度), "comment": 指摘, "severity": "info"|"warn"}。' +
  "quote は本文に現れる文字列をそのまま正確にコピーすること（言い換え・要約は禁止）。";

async function main() {
  const provider = process.env.EVAL_PROVIDER ?? "anthropic";
  const model = required("EVAL_MODEL");
  const apiKey = resolveApiKey(provider);
  const llm = createLlmClient();

  console.log(`# eval-anchor  provider=${provider} model=${model}  docs=${DOCS.length}\n`);

  let total = 0;
  let exact = 0;
  let normalized = 0;
  let failed = 0;
  let ambiguous = 0;

  for (const d of DOCS) {
    let raw = "";
    try {
      raw = await llm.complete({ provider, model, apiKey, system: SYSTEM, prompt: `# 文書\n${d.body}` });
    } catch (e) {
      console.log(`## ${d.name}\n  ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
      continue;
    }
    const findings = parseFindings(raw);
    console.log(`## ${d.name}  （指摘 ${findings.length} 件）`);
    if (findings.length === 0) console.log(`  ⚠ JSON をパースできず: ${raw.slice(0, 120).replace(/\n/g, " ")}…`);

    for (const f of findings) {
      total++;
      const a = anchorQuote(d.body, f.quote);
      if (!a) {
        failed++;
        console.log(`  ✗ 失敗  quote=「${f.quote.slice(0, 40)}」`);
      } else {
        if (a.kind === "exact") exact++;
        else normalized++;
        if (a.ambiguous) ambiguous++;
        console.log(`  ✓ ${a.kind}${a.ambiguous ? "・曖昧" : ""}  anchor=「${a.anchorText.slice(0, 40)}」`);
      }
    }
    console.log("");
  }

  const hit = exact + normalized;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  console.log("──────── 集計 ────────");
  console.log(`指摘総数: ${total}`);
  console.log(`アンカー成功: ${hit} (${pct(hit)}%)  ［exact ${exact} / normalized ${normalized}］`);
  console.log(`失敗: ${failed} (${pct(failed)}%)`);
  console.log(`曖昧(複数箇所に一致): ${ambiguous}`);
  console.log(
    "\n判断目安: 成功率が高く失敗・曖昧が少なければ ① は有望。" +
      "失敗が多ければ『逐語引用の指示強化／レンダリング後テキストへの対応づけ／位置特定できない指摘はドキュメント全体スレッドに退避』を検討。",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
