import type { DocumentStore } from "./types";

// (B)ハイブリッド: 本体を Google Drive に残置。ref = drive_file_id。
// Phase 0 で A/B を確定してから実装（Drive API: files.get?alt=media / files.update）。
// 職場は業務 md が Workspace 管理のため温存に実利あり（§6.0）。
export interface DriveConfig {
  backend: "drive";
  // 認証(サービスアカウント/ドメイン委任 or per-user OAuth) は Phase 0 で確定
}

const NOT_IMPL = "DriveStorage は Phase 0 (B) 確定後に実装する（移行計画 §6.2）";

export class DriveStorage implements DocumentStore {
  readonly backend = "drive" as const;

  constructor(private cfg: DriveConfig) {
    void this.cfg;
  }

  async get(_ref: string): Promise<string> {
    throw new Error(NOT_IMPL);
  }

  async put(_documentId: string, _version: number, _content: string): Promise<string> {
    throw new Error(NOT_IMPL);
  }

  async remove(_ref: string): Promise<void> {
    throw new Error(NOT_IMPL);
  }
}
