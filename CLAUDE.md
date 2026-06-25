# mdcollab — プロジェクト指針

## docs は参考・真実はコード/設定（最重要）
`docs/` や `*/IMPORT.md` 等は陳腐化しうる。手順・秘密・設定を扱うときは **docs を鵜呑みにせず実ファイルで裏を取る**。docs が実態とズレていたら、その場で docs を実態に合わせて直す（古い手順をそのまま実行しない）。

## source of truth（迷ったらここを見る）
- **wrangler 設定**: `wrangler.toml` は生成物。真実は `wrangler.template.toml` + `.env` / GitHub Variables（`scripts/gen-wrangler.sh` が生成）。`wrangler.toml` は直接編集しない。
- **インフラの秘密配線**（cloudflare env）: `infra/envs/mdcollab-cloudflare/.envrc` = `dotenv` が同ディレクトリの gitignore 済み `.env`（`CLOUDFLARE_API_TOKEN`）を direnv で自動 export。`terraform.tfvars`（gitignore 済み）に `neon_password` / `account_id` / `zone_id` / `r2_bucket_name` / `neon_host` → tofu が自動で読む。**都度 export ではない**（その dir に cd・初回 `direnv allow`）。非対話シェル（`!` 経由）では direnv が発火しない点に注意。
- **アプリ実行の秘密**: `.dev.vars`（`.envrc` の `dotenv_if_exists` が読む）。
- **DB スキーマ**: `src/db/schema.ts` + `drizzle/`（マイグレーションは生成物）。
- **進捗 / 残タスク**: GitHub issues（`docs/archive/` は役目を終えた歴史記録）。

## 運用
- `main` は保護（PR + `check` 必須）。直 push 不可 → ブランチ + PR。
- テスト / 型: `bun run test`（pglite・docker 不要） / `bun run typecheck`。
- 依存追加は `bun add`（`package.json` にバージョンを手書きしない）。

## 開発手法 = cc-sdd（Kiro式 Spec-Driven Development）
本リポジトリは cc-sdd（`bunx cc-sdd@latest --claude-skills --lang ja`、導入時 v3.0.2）を採用。スキルは `.claude/skills/kiro-*`、spec/steering は `.kiro/` に格納し、いずれも git 管理する。各機能は issue → `/kiro-spec-init` で spec 化し、要件→設計→タスク→実装の各フェーズを人間承認で進める。詳細は下記「Agentic SDLC and Spec-Driven Development」を参照。

<!-- 以下は cc-sdd が生成する標準ブロック（原文のまま・再生成時に上書きされうる）。上の mdcollab 固有指針が優先。 -->

---

# Agentic SDLC and Spec-Driven Development

Kiro-style Spec-Driven Development on an agentic SDLC

## Project Context

### Paths
- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications
- Check `.kiro/specs/` for active specifications
- Use `/kiro-spec-status [feature-name]` to check progress

## Development Guidelines
- Think in English, generate responses in Japanese. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Minimal Workflow
- Phase 0 (optional): `/kiro-steering`, `/kiro-steering-custom`
- Discovery: `/kiro-discovery "idea"` — determines action path, writes brief.md + roadmap.md for multi-spec projects
- Phase 1 (Specification):
  - Single spec: `/kiro-spec-quick {feature} [--auto]` or step by step:
    - `/kiro-spec-init "description"`
    - `/kiro-spec-requirements {feature}`
    - `/kiro-validate-gap {feature}` (optional: for existing codebase)
    - `/kiro-spec-design {feature} [-y]`
    - `/kiro-validate-design {feature}` (optional: design review)
    - `/kiro-spec-tasks {feature} [-y]`
  - Multi-spec: `/kiro-spec-batch` — creates all specs from roadmap.md in parallel by dependency wave
- Phase 2 (Implementation): `/kiro-impl {feature} [tasks]`
  - Without task numbers: autonomous mode (subagent per task + independent review + final validation)
  - With task numbers: manual mode (selected tasks in main context, still reviewer-gated before completion)
  - `/kiro-validate-impl {feature}` (standalone re-validation)
- Progress check: `/kiro-spec-status {feature}` (use anytime)

## Skills Structure
Skills are located in `.claude/skills/kiro-*/SKILL.md`
- Each skill is a directory with a `SKILL.md` file
- Skills run inline with access to conversation context
- Skills may delegate parallel research to subagents for efficiency
- Additional files (templates, examples) can be added to skill directories
- `kiro-review` — task-local adversarial review protocol used by reviewer subagents
- `kiro-debug` — root-cause-first debug protocol used by debugger subagents
- `kiro-verify-completion` — fresh-evidence gate before success or completion claims
- **If there is even a 1% chance a skill applies to the current task, invoke it.** Do not skip skills because the task seems simple.

## Development Rules
- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `/kiro-spec-status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration
- Load entire `.kiro/steering/` as project memory
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/kiro-steering-custom`)
