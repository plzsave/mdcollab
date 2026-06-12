import { eq } from "drizzle-orm";
import type { Deps } from "../env";
import { aiKeys, aiSettings } from "../db/schema";

// AI 設定ビュー（秘密は真偽/スコープのみ・平文は絶対に含めない・§6.5）。
// ai ルートと state ルート（束ね込み）で共有する。
export const GITHUB_PREFIX = "github:";

export interface AiSettingsView {
  provider: string | null;
  model: string | null;
  githubRepo: string | null;
  keys: Record<string, boolean>;
  githubPats: string[];
}

export async function loadAiSettings(deps: Deps, email: string): Promise<AiSettingsView> {
  const [settingsRow] = await deps.db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.email, email))
    .limit(1);
  const keyRows = await deps.db.select().from(aiKeys).where(eq(aiKeys.email, email));

  const keys: Record<string, boolean> = {};
  const githubPats: string[] = [];
  for (const k of keyRows) {
    if (k.provider.startsWith(GITHUB_PREFIX)) {
      githubPats.push(k.provider.slice(GITHUB_PREFIX.length));
    } else {
      keys[k.provider] = true;
    }
  }
  return {
    provider: settingsRow?.provider ?? null,
    model: settingsRow?.model ?? null,
    githubRepo: settingsRow?.githubRepo ?? null,
    keys,
    githubPats,
  };
}
