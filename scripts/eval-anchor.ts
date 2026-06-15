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
import { readdirSync, readFileSync } from "node:fs";
import { createLlmClient } from "../src/llm/providers";
import { anchorQuote, isHighlightable, parseFindings } from "../src/ai/findings";

interface Doc {
  name: string;
  body: string;
}

// scripts/eval-fixtures/ の *.md（README.md を除く）をゴールデン文書として読み込む。
// フィクスチャは「意図的に問題を仕込んだ検証用 MD」。増減はファイルを足し引きするだけ。
const FIXT_DIR = new URL("./eval-fixtures/", import.meta.url);
const DOCS: Doc[] = readdirSync(FIXT_DIR)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort()
  .map((f) => ({ name: f, body: readFileSync(new URL(f, FIXT_DIR), "utf8") }));

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
  "quote は本文に現れる文字列をそのまま正確にコピーすること（言い換え・要約は禁止）。" +
  "さらに quote は本文の【地の文（散文）】から選ぶこと。コードや表のセル・見出し・` で囲った部分・**強調**を" +
  "またぐ引用は避け、装飾を含まない連続した文の一部を選ぶ（指摘対象がコード/表なら、その近くの説明文を quote にする）。";

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
  let highlightable = 0; // 描画後の単一テキストノードに収まり、現状の web ハイライトで光る件数

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
      const hl = isHighlightable(d.body, f.quote); // 描画後に光るか
      if (hl) highlightable++;
      const hlMark = hl ? "💡光る" : "・光らない";
      if (!a) {
        failed++;
        console.log(`  ✗ 失敗  ${hlMark}  quote=「${f.quote.slice(0, 40)}」`);
      } else {
        if (a.kind === "exact") exact++;
        else normalized++;
        if (a.ambiguous) ambiguous++;
        console.log(`  ✓ ${a.kind}${a.ambiguous ? "・曖昧" : ""}  ${hlMark}  anchor=「${a.anchorText.slice(0, 40)}」`);
      }
    }
    console.log("");
  }

  const hit = exact + normalized;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  console.log("──────── 集計 ────────");
  console.log(`指摘総数: ${total}`);
  console.log(`生本文アンカー成功: ${hit} (${pct(hit)}%)  ［exact ${exact} / normalized ${normalized} / 失敗 ${failed}］`);
  console.log(`★描画後ハイライト可能: ${highlightable} (${pct(highlightable)}%)  ← ① で実際に光る率（本番の数字）`);
  console.log(`曖昧(複数箇所に一致): ${ambiguous}`);
  console.log(
    "\n判断目安: ★描画後ハイライト可能率が実用上の指標。" +
      "高ければ ① は有望。低ければ『散文引用の誘導強化／位置特定できない指摘は文書全体スレッドに退避』を検討。",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
