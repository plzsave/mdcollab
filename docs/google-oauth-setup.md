# Google OAuth クライアントの作り方（任意）

ローカル検証は `DEV_AUTH=1` の dev ログインで OAuth 無しに進められる。
**本物の Google ログインを試したくなったとき**だけ、この手順でクライアントを作る。

## 1. プロジェクトと同意画面

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成 or 選択。
2. **APIs & Services → OAuth consent screen**:
   - 個人の Google アカウントで試す → **External**。後述のテストユーザーに自分を追加。
   - Workspace アカウント → **Internal**（同一ドメインのみ・審査不要）。
   - スコープは `openid` / `email` / `profile` の3つだけ（非機微・Google 審査不要）。

## 2. OAuth クライアント ID

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**。
2. **Application type: Web application**。
3. **Authorized redirect URIs** に正確に追加（末尾までに一致が必要）:
   ```
   http://localhost:8787/api/auth/callback
   ```
   （`localhost` は Google が HTTPS 例外にしているので http のままで可）
4. （任意）**Authorized JavaScript origins**: `http://localhost:8787`
5. 作成すると **Client ID** と **Client Secret** が出る。

## 3. アプリへ設定

`.dev.vars` に貼る:
```
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx
# 特定のドメインに絞るなら:
# ALLOWED_DOMAIN=your-workspace-domain.com
DEV_AUTH=0   # 本物の OAuth を試すときは抜け道を切る
```

## 4. ログインの流れ

1. `bun run dev` 起動後、ブラウザで `http://localhost:8787/api/auth/login` を開く。
2. Google で同意 → `/api/auth/callback` に戻り、セッション Cookie が入る。
3. その後 `/api/state` などが叩ける（※その email が `members` に居ること。居なければ 403 → seed で追加）。

## デプロイ時

- 各環境（例: Cloudflare / AWS）の `BASE_URL` に対応する redirect URI を**それぞれ追加**する
  （例: `https://mdcollab.example.workers.dev/api/auth/callback`）。
- Client Secret はリポジトリに置かず、各プラットフォームのシークレット管理へ（§5.2）。
