# infra/modules

クラウド共通の「リソース形状」を表す Terraform モジュール置き場。
`envs/*` から provider を変えて呼び出す（§5.2）。

想定モジュール（Phase 0 で実体化）:

| モジュール | 役割 | CF | AWS | GCP |
|---|---|---|---|---|
| `api` | API ランタイム | Workers | Lambda/Fargate | Cloud Run |
| `db` | Postgres | Hyperdrive(→Neon) | RDS `t4g.micro` | Cloud SQL |
| `object-store` | 本体 `.md` | R2 | S3 | GCS |
| `dns` | ドメイン | — | Route53 | Cloud DNS |

方針:
- provider 差は `envs/*` 側に閉じ込め、モジュール I/F（入力変数・出力）は揃える。
- 本体ストアは S3 互換 API に寄せるため `object-store` の出力（endpoint/bucket/keys）は3クラウドで同形。
