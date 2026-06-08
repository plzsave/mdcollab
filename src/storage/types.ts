// 本体(.md)の置き場所を隠蔽するプラガブルインターフェイス（移行計画 §6.2）。
// (A)フル移行 = S3Storage(R2/S3/GCS) / (B)ハイブリッド = DriveStorage。
// デプロイ設定で実装を切替え、(A)/(B) をフォークにしない。
export type StorageBackend = "s3" | "drive";

export interface DocumentStore {
  readonly backend: StorageBackend;
  /** ref を読む。s3=storage_key / drive=drive_file_id */
  get(ref: string): Promise<string>;
  /** 本体を書き、DB に保持する ref を返す（新 version で書く＝§6.3） */
  put(documentId: string, version: number, content: string): Promise<string>;
  /** ref を削除（冪等） */
  remove(ref: string): Promise<void>;
}
