import type { DocumentStore } from "./types";
import { S3Storage, type S3Config } from "./s3";
import { DriveStorage, type DriveConfig } from "./drive";

export type StorageConfig = S3Config | DriveConfig;

// デプロイ設定で本体ストアを選ぶ。(A)→s3 / (B)→drive（§6.0）。
export function createStore(cfg: StorageConfig): DocumentStore {
  switch (cfg.backend) {
    case "s3":
      return new S3Storage(cfg);
    case "drive":
      return new DriveStorage(cfg);
  }
}

export type { DocumentStore } from "./types";
export type { S3Config } from "./s3";
export type { DriveConfig } from "./drive";
