# 職場デプロイ: AWS（Lambda/Fargate + S3 + RDS Postgres t4g.micro）
# state backend: S3 + DynamoDB ロック（標準）。CI=CodePipeline/CodeBuild（§5.2）。

terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      # version は terraform init で解決
    }
  }

  backend "s3" {
    bucket         = "mdcollab-tfstate-workplace"
    key            = "aws-workplace/terraform.tfstate"
    region         = "ap-northeast-1"
    dynamodb_table = "mdcollab-tflock"
    encrypt        = true
  }
}

provider "aws" {
  region = "ap-northeast-1"
  # 認証は CodeBuild サービスロール（長期キー不要・§5.2）
}

# TODO(Phase 0):
#   - aws_lambda_function / aws_apigatewayv2 (or App Runner/Fargate)  mdcollab-api
#   - aws_s3_bucket            mdcollab-docs-workplace
#   - aws_db_instance (Postgres, t4g.micro) もしくは aws_rds_cluster(Aurora SLv2)
#   - RDS は VPC 内 → マイグレーションは CodeBuild の VPC 接続 or Lambda ランナー
