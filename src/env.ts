import type { Database } from "./db/client";
import type { DocumentStore } from "./storage";
import type { LlmClient } from "./llm/types";
import type { GithubClient } from "./github/types";

export interface AppConfig {
  baseUrl: string;
  sessionSecret: string;
  /** AI キー/PAT の保存時暗号化に使う鍵（§6.5）。SHA-256 で AES-GCM 鍵に導出する。 */
  encryptionKey: string;
  google: { clientId: string; clientSecret: string };
  /** Workspace ドメイン制限（§7.2 の `access: DOMAIN` 代替・hd クレーム検査）。未設定なら制限なし */
  allowedDomain?: string;
  /**
   * ローカル検証用の dev ログイン抜け道を有効化（Google OAuth 不要）。
   * ⚠ 本番では絶対に true にしない。node アダプタが DEV_AUTH=1 のときだけ立てる。
   */
  devAuth?: boolean;
}

// ランタイム非依存のコアへ渡す依存束。アダプタ(§adapters)が環境ごとに組み立てる。
export interface Deps {
  db: Database;
  store: DocumentStore;
  llm: LlmClient;
  github: GithubClient;
  config: AppConfig;
}
