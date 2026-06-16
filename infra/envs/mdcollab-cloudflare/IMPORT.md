# cloudflare env を Terraform(OpenTofu) に import する手順

対象: **R2 バケット**と **Hyperdrive 設定**のみ（Worker は wrangler のまま）。
ツール: OpenTofu（`tofu`。`~/.local/bin/tofu` に導入済み）。

> 秘密はリポジトリに置かず、direnv と tfvars 経由で**自動ロード**する（どちらも gitignore 済み）:
> - `CLOUDFLARE_API_TOKEN` → このディレクトリの `.env`（`.envrc` の `dotenv` が cd 時に読む）
> - `neon_password` / `account_id` / `zone_id` / `r2_bucket_name` / `neon_host` → `terraform.tfvars`（tofu が自動で読む）
>
> 初回だけこのディレクトリで `direnv allow`。以後はここへ cd するだけで export 不要・tofu が通る
> （ディレクトリ名を変えた直後も `direnv allow` を打ち直すこと）。

## 0. 前提

```bash
# tofu に PATH を通す（未設定なら）
export PATH="$HOME/.local/bin:$PATH"
tofu version   # OpenTofu v1.12.x
cd infra/envs/mdcollab-cloudflare
```

## 1. Cloudflare API トークンを作る（ダッシュボード）

My Profile → API Tokens → Create Token → **Custom token**：
- Permissions:
  - Account · **Workers R2 Storage** · Edit
  - Account · **Hyperdrive** · Edit
  - Account · **Account Settings** · Read
- Account Resources: Include · 自分のアカウント
- 作成後、トークン文字列をこのディレクトリの `.env` に置く（`.envrc` の `dotenv` が自動ロード・gitignore 済み）:

```bash
# infra/envs/mdcollab-cloudflare/.env
CLOUDFLARE_API_TOKEN=＜作ったトークン＞
```

初回のみこのディレクトリで `direnv allow`。以後は cd するだけで export される。

## 2. terraform.tfvars に値を入れる

`terraform.tfvars.example` をコピーして `terraform.tfvars`（gitignore 済み）に実値を記入する。
tofu が自動で読むので export は不要:

- `neon_password` … Hyperdrive の origin に使っている Neon 接続パスワード（`postgres://USER:＜ここ＞@...`）
- `account_id` / `r2_bucket_name` / `neon_host` / `zone_id` … 自分のアカウント値

> リポジトリにはプレースホルダの `.example` だけが入る（実値はコミットしない）。

## 3. init（未実施なら）

```bash
tofu init -input=false
```

## 4. 既存リソースを import

```bash
ACC=<YOUR_ACCOUNT_ID>
BUCKET=<YOUR_R2_BUCKET>       # terraform.tfvars の r2_bucket_name と一致させる
HID=<YOUR_HYPERDRIVE_ID>      # wrangler hyperdrive list / ダッシュボードで確認

tofu import cloudflare_r2_bucket.docs "$ACC/$BUCKET/default"
tofu import cloudflare_hyperdrive_config.neon "$ACC/$HID"
```

## 5. 差分確認

```bash
tofu plan
```

- 期待: **No changes**（または Hyperdrive の password 書き込みのみ）。
- もし password が毎回差分に出る場合は、`hyperdrive.tf` の resource に以下を足す:

  ```hcl
  lifecycle {
    ignore_changes = [origin.password]
  }
  ```

- それ以外の差分（location/scheme 等）が出たら、その出力を貼ってください。`.tf` を実態へ合わせます。

## 6. 反映するものは無い

import は「既存を Terraform 管理下に置く」だけ。`apply` で新規作成は起きない想定
（plan が No changes なら apply 不要）。以後の変更は `.tf` 編集 → `tofu plan/apply`。

## state について

いまは**ローカル state**（`terraform.tfstate`・gitignore 済み）。チーム共有や CI で使うなら
R2(S3互換) backend へ移行する（`main.tf` のコメント参照）。小規模運用なら当面ローカルで可。
