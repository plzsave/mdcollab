# cf-personal を Terraform(OpenTofu) に import する手順

対象: **R2 バケット**と **Hyperdrive 設定**のみ（Worker は wrangler のまま）。
ツール: OpenTofu（`tofu`。`~/.local/bin/tofu` に導入済み）。

> 秘密（API トークン・Neon パスワード）は**自分の端末で**設定・実行してください
> （会話ログに残さないため）。

## 0. 前提

```bash
# tofu に PATH を通す（未設定なら）
export PATH="$HOME/.local/bin:$PATH"
tofu version   # OpenTofu v1.12.x
cd infra/envs/mdcollab-cf-personal
```

## 1. Cloudflare API トークンを作る（ダッシュボード）

My Profile → API Tokens → Create Token → **Custom token**：
- Permissions:
  - Account · **Workers R2 Storage** · Edit
  - Account · **Hyperdrive** · Edit
  - Account · **Account Settings** · Read
- Account Resources: Include · 自分のアカウント
- 作成後、トークン文字列をコピー。

```bash
export CLOUDFLARE_API_TOKEN='＜作ったトークン＞'
```

## 2. Neon パスワードを渡す

Hyperdrive の origin に使っている Neon 接続パスワード（作成時の `postgres://USER:＜ここ＞@...`）。

```bash
export TF_VAR_neon_password='＜Neon のパスワード＞'
# もしくは terraform.tfvars.example をコピーして terraform.tfvars に記入（gitignore 済み）
```

## 3. init（未実施なら）

```bash
tofu init -input=false
```

## 4. 既存リソースを import

```bash
ACC=4d9f47fbb96473f1fb10e509ace25cd7

tofu import cloudflare_r2_bucket.docs "$ACC/mdcollab-docs-personal/default"
tofu import cloudflare_hyperdrive_config.neon "$ACC/b682f4dcc5944f72995071cb3353f975"
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
R2(S3互換) backend へ移行する（`main.tf` のコメント参照）。個人運用なら当面ローカルで可。
