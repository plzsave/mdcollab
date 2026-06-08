# デプロイ実体は repo スクリプトに集約し、CI エンジン(個人=GitHub Actions / 職場=CodePipeline)は
# 「これを呼ぶだけ」にする＝CI エンジンを差し替え可能に（移行計画 §5.2）。

.PHONY: install typecheck test check dev migrate deploy-cf deploy-aws

install:
	bun install

typecheck:
	bun run typecheck

test:
	bun run test

check: typecheck test

dev:
	bun run dev

migrate:
	bun run db:migrate

deploy-cf:
	./scripts/deploy-cf.sh

deploy-aws:
	./scripts/deploy-aws.sh
