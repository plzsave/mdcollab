ALTER TABLE "reviews" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "tools_used" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "truncated" boolean DEFAULT false NOT NULL;