// ローカル検証用シード。member(あなた) + status + folder + document(本体を S3 へ) を投入。
// これで /api/state, /api/folders, /api/documents の GET/PUT（競合更新）を実機で叩ける。
// 実行: SEED_EMAIL=you@example.com make seed   （.dev.vars を source 済みなら SEED_EMAIL だけでOK）
import { createDb } from "../src/db/client";
import { createStore } from "../src/storage";
import {
  members,
  statuses,
  folders,
  documents,
  documentVersions,
} from "../src/db/schema";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const email = required("SEED_EMAIL");
const db = createDb(required("DATABASE_URL"));
const store = createStore({
  backend: "s3",
  endpoint: required("S3_ENDPOINT"),
  bucket: required("S3_BUCKET"),
  region: process.env.S3_REGION ?? "us-east-1",
  accessKeyId: required("S3_ACCESS_KEY_ID"),
  secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
});

const FOLDER_ID = "seed-folder";
const DOC_ID = "seed-doc";
const INITIAL = `# Seed ドキュメント\n\nこれはローカル検証用のシードです。\n\n- GET /api/documents/${DOC_ID}\n- PUT /api/documents/${DOC_ID} （If-Match で競合検知）\n`;

async function main() {
  await db
    .insert(members)
    .values({ email, displayName: email.split("@")[0] ?? email, role: "owner", addedBy: "seed" })
    .onConflictDoNothing();

  await db
    .insert(statuses)
    .values({ id: "draft", label: "Draft", sortOrder: 0 })
    .onConflictDoNothing();

  await db
    .insert(folders)
    .values({ id: FOLDER_ID, name: "Seed Folder", createdBy: email })
    .onConflictDoNothing();

  // 本体を S3 へ（version 1）→ storage_key を取得
  const storageKey = await store.put(DOC_ID, 1, INITIAL);

  await db
    .insert(documents)
    .values({
      id: DOC_ID,
      folderId: FOLDER_ID,
      title: "Seed ドキュメント",
      storageKey,
      version: 1,
      statusId: "draft",
      createdBy: email,
    })
    .onConflictDoNothing();

  await db
    .insert(documentVersions)
    .values({ documentId: DOC_ID, version: 1, storageKey, createdBy: email })
    .onConflictDoNothing();

  console.log(`seeded: member=${email}, folder=${FOLDER_ID}, doc=${DOC_ID} (storage_key=${storageKey})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
