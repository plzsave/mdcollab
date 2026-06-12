import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ApiError } from "../api/client";
import {
  useAiModels,
  useAiSettings,
  useDeleteAiKey,
  useSaveAiSettings,
  useSaveGithubRepo,
} from "../api/hooks";

export const Route = createFileRoute("/settings/ai")({ component: AiSettingsView });

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (GPT)" },
];

function AiSettingsView() {
  const { data: settings, isLoading } = useAiSettings();
  const save = useSaveAiSettings();
  const delKey = useDeleteAiKey();
  const saveRepo = useSaveGithubRepo();

  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [repo, setRepo] = useState("");
  const [wantModels, setWantModels] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // 初回ロード時にサーバ値で初期化（プロバイダ/モデル/repo）。
  useEffect(() => {
    if (!settings) return;
    if (settings.provider) setProvider(settings.provider);
    setModel(settings.model ?? "");
    setRepo(settings.githubRepo ?? "");
  }, [settings]);

  const hasKey = !!settings?.keys[provider];
  const models = useAiModels(provider, wantModels && hasKey);

  if (isLoading) return <p className="text-sm text-slate-400">読み込み中…</p>;

  const flash = (m: string) => {
    setSavedMsg(m);
    setTimeout(() => setSavedMsg(null), 2500);
  };

  const onSave = () => {
    save.mutate(
      { provider, model: model.trim() || undefined, apiKey: apiKey.trim() || undefined },
      {
        onSuccess: () => {
          setApiKey("");
          flash("保存しました");
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">AI 設定</h1>

      <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">プロバイダとモデル</h2>

        <label className="block text-xs font-medium text-slate-500">プロバイダ</label>
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setWantModels(false);
          }}
          className="w-full rounded border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>

        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-500">
            API キー
            {hasKey && (
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                設定済み
              </span>
            )}
          </label>
          {hasKey && (
            <button
              onClick={() => delKey.mutate(provider)}
              className="text-[11px] text-red-500 hover:text-red-700"
            >
              キーを削除
            </button>
          )}
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKey ? "（変更する場合のみ入力）" : "sk-… / 新しいキー"}
          autoComplete="off"
          className="w-full rounded border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />

        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-500">モデル</label>
          <button
            onClick={() => setWantModels(true)}
            disabled={!hasKey}
            title={!hasKey ? "先にキーを保存してください" : ""}
            className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 dark:text-slate-100 disabled:opacity-40"
          >
            候補を取得
          </button>
        </div>
        <input
          list="ai-model-list"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="例: claude-opus-4-8 / gpt-4o"
          className="w-full rounded border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
        />
        <datalist id="ai-model-list">
          {models.data?.models.map((m) => <option key={m} value={m} />)}
        </datalist>
        {models.isLoading && <p className="text-[11px] text-slate-400">モデル取得中…</p>}
        {models.error && (
          <p className="text-[11px] text-red-600 dark:text-red-400">
            モデル取得失敗: {models.error instanceof ApiError ? models.error.message : "エラー"}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={onSave}
            disabled={save.isPending}
            className="rounded-md bg-slate-800 dark:bg-slate-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-40"
          >
            {save.isPending ? "保存中…" : "保存"}
          </button>
          {save.error && (
            <span className="text-xs text-red-600 dark:text-red-400">
              {save.error instanceof ApiError ? save.error.message : "保存に失敗しました"}
            </span>
          )}
          {savedMsg && <span className="text-xs text-emerald-600">{savedMsg}</span>}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">GitHub リポジトリ（レビュー参照）</h2>
        <p className="text-xs text-slate-400">
          「リポジトリ参照を含める」レビューでプロンプトに添えるリポジトリ（owner/repo）。
        </p>
        <div className="flex gap-2">
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo"
            className="flex-1 rounded border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
          />
          <button
            onClick={() => saveRepo.mutate(repo.trim(), { onSuccess: () => flash("リポジトリを保存しました") })}
            disabled={saveRepo.isPending}
            className="rounded-md border border-slate-300 dark:border-slate-600 px-4 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </section>
    </div>
  );
}
