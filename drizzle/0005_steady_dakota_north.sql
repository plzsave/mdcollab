CREATE TABLE "ai_review_events" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
