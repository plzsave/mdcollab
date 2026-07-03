// AI レビューの eval ハーネス（手動・BYO-key / #83 で kb-bot 式に成熟化）。
//
// 目的: プロンプト・モデル・ツールを変えるときの回帰チェック。ケース（scripts/eval/cases.json）を
//       本番と同一経路（buildSystem + reviewPrompt + 本番ツール群）で実モデルにレビューさせ、
//       本文＋ツール呼び出しトレースで採点し、スコアカードと集約合格率ゲートで判定する。
//
// CI には載せない: API キーが要る・非決定的・課金。手元で明示的に回す。
// DB は pglite・GitHub/web は fixture＝ネットワークは LLM のみ（コストと分散を最小化）。
//
// 実行:
//   EVAL_MODEL=<model> ANTHROPIC_API_KEY=sk-... bun run scripts/eval-review.ts [cases.json]
//   EVAL_PROVIDER=openai EVAL_MODEL=<model> OPENAI_API_KEY=sk-... bun run scripts/eval-review.ts
// フラグ:
//   --gate-only          gate（安全）ケースだけ実行する短縮ラン（数円で安全確認）
//   --update-baseline    実行後に基準（baseline.json）を記録/更新する（フルラン時のみ）
// 環境変数:
//   EVAL_BAND  集約ゲートの許容幅（既定 0.10。ライブ複数 run の実測分散から較正する）
//   EVAL_MIN_N 集約ゲートの最小評価数（既定 20。未満なら集約判定なし＝安全ゲートのみ）
//
// exit code: 安全ゲート失敗 or 集約 FAIL（基準−band を下回る全体劣化）で 1。
//            個別 scored ケースの合否は exit を左右しない（単発 LLM 実行は非決定のため）。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createLlmClient } from "../src/llm/providers";
import {
  aggregateVerdict,
  buildScorecard,
  caseSetFingerprint,
  evaluatedScoredNames,
  exitPassed,
  formatAggregate,
  formatScorecard,
  overallPassed,
  parseBaseline,
  statusLabel,
  validateCases,
  type Case,
  type CaseResult,
  type RawCase,
} from "./eval/harness";
import { runCase, type CaseRun } from "./eval/run";

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

function fmtTokens(n: number | undefined): string {
  if (n == null) return "-";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function numEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  const gateOnly = args.includes("--gate-only");
  const updateBaseline = args.includes("--update-baseline");
  const casesPath = args.find((a) => !a.startsWith("--")) ?? join(import.meta.dirname, "eval", "cases.json");
  const baselinePath = join(dirname(casesPath), "baseline.json");

  const provider = process.env.EVAL_PROVIDER ?? "anthropic";
  const model = required("EVAL_MODEL");
  const apiKey = resolveApiKey(provider);
  const band = numEnv("EVAL_BAND", 0.1);
  const minN = numEnv("EVAL_MIN_N", 20);

  if (!existsSync(casesPath)) {
    console.error(`ケースファイルがありません: ${casesPath}`);
    process.exit(2);
  }
  // ケース読込＋実行前検証（不正な軸/フラグは黙って集計へ流さない）。
  const raw = JSON.parse(readFileSync(casesPath, "utf8")) as RawCase[];
  const errors = validateCases(raw);
  if (errors.length > 0) {
    console.error("ケース定義が不正です:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(2);
  }
  const allCases = raw as unknown as Case[];
  const cases = gateOnly ? allCases.filter((c) => c.gate === true) : allCases;
  if (cases.length === 0) {
    console.error(gateOnly ? "gate ケースがありません" : "ケースがありません");
    process.exit(2);
  }

  console.log(
    `# eval-review  provider=${provider} model=${model}  cases=${cases.length}${gateOnly ? "（gate のみ）" : ""}\n`,
  );

  const llm = createLlmClient();
  const results: CaseResult[] = [];
  let i = 0;
  for (const c of cases) {
    i++;
    const run: CaseRun = await runCase(llm, { provider, model, apiKey }, c);
    results.push(run.result);

    const totalIn =
      run.usage == null
        ? undefined
        : run.usage.inputTokens + run.usage.cacheReadInputTokens + run.usage.cacheCreationInputTokens;
    const tools = [...new Set(run.calls.map((x) => x.name))].join(",") || "-";
    console.log(
      `[${i}/${cases.length}] ${statusLabel(run.result.status, run.result.gate)}  ${c.name}` +
        `${run.result.monitor ? "（モニタ）" : ""}`,
    );
    console.log(
      `  tools: ${tools} / 入力 ${fmtTokens(totalIn)}（キャッシュ ${fmtTokens(run.usage?.cacheReadInputTokens)}）` +
        `・出力 ${fmtTokens(run.usage?.outputTokens)} / ${(run.ms / 1000).toFixed(1)}s${run.truncated ? " / truncated" : ""}`,
    );
    for (const f of run.result.fails) console.log(`    ✗ ${f}`);
    if (run.result.status !== "PASS") {
      console.log(`  --- レビュー先頭 ---\n${run.text.slice(0, 300).replace(/^/gm, "  | ")}`);
    }
    console.log("");
  }

  const sc = buildScorecard(results);
  console.log(formatScorecard(sc));

  if (gateOnly) {
    // 短縮ランは安全ゲートのみで判定（集約は母集団が違うので比較しない）。
    process.exit(overallPassed(sc) ? 0 : 1);
  }

  const names = evaluatedScoredNames(results);
  const baseline = existsSync(baselinePath)
    ? parseBaseline(JSON.parse(readFileSync(baselinePath, "utf8")))
    : null;
  const verdict = aggregateVerdict(sc, names, baseline, { band, minN });
  console.log(formatAggregate(verdict));

  if (updateBaseline) {
    const passRate = sc.total.evaluated > 0 ? sc.total.pass / sc.total.evaluated : 0;
    const next = {
      passRate,
      evaluated: sc.total.evaluated,
      caseSetHash: caseSetFingerprint(names),
      recordedAt: new Date().toISOString(),
      note: `provider=${provider} model=${model} band=${band}`,
    };
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\nbaseline を記録しました: ${baselinePath}（passRate=${(passRate * 100).toFixed(1)}%）`);
    console.log("※ band はライブ複数 run の実測分散から較正すること（1 run の記録は仮の基準）。");
  }

  process.exit(exitPassed(sc, verdict) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
