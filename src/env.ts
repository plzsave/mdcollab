import type { Database } from "./db/client";
import type { DocumentStore } from "./storage";

export interface AppConfig {
  baseUrl: string;
  sessionSecret: string;
  google: { clientId: string; clientSecret: string };
  /** Workspace ドメイン制限（§7.2 の `access: DOMAIN` 代替・hd クレーム検査）。未設定なら制限なし */
  allowedDomain?: string;
}

// ランタイム非依存のコアへ渡す依存束。アダプタ(§adapters)が環境ごとに組み立てる。
export interface Deps {
  db: Database;
  store: DocumentStore;
  config: AppConfig;
}
