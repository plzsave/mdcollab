import { AwsClient } from "aws4fetch";
import type { DocumentStore } from "./types";

// aws4fetch（Web標準 fetch ベース・Workers/Node/Lambda 共通）で S3 互換 API を叩く。
// R2 / S3 / GCS(S3互換モード) を同一コードでカバー＝§5.1「安いポータビリティ」。
export interface S3Config {
  backend: "s3";
  endpoint: string; // 例: https://<acct>.r2.cloudflarestorage.com / https://s3.<region>.amazonaws.com
  bucket: string;
  region: string; // R2 は "auto"
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3Storage implements DocumentStore {
  readonly backend = "s3" as const;
  private client: AwsClient;

  constructor(private cfg: S3Config) {
    this.client = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: cfg.region,
      service: "s3",
    });
  }

  private url(key: string): string {
    return `${this.cfg.endpoint}/${this.cfg.bucket}/${key}`;
  }

  private keyFor(documentId: string, version: number): string {
    return `docs/${documentId}/${version}.md`;
  }

  async get(ref: string): Promise<string> {
    const res = await this.client.fetch(this.url(ref));
    if (!res.ok) throw new Error(`S3 get failed: ${res.status}`);
    return res.text();
  }

  async put(documentId: string, version: number, content: string): Promise<string> {
    const key = this.keyFor(documentId, version);
    const res = await this.client.fetch(this.url(key), {
      method: "PUT",
      body: content,
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
    if (!res.ok) throw new Error(`S3 put failed: ${res.status}`);
    return key;
  }

  async remove(ref: string): Promise<void> {
    const res = await this.client.fetch(this.url(ref), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed: ${res.status}`);
  }
}
