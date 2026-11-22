CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"object_type" text,
	"object_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_type_check" CHECK (actor_type IN ('user', 'admin', 'system'))
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_email_lower_check" CHECK (email = lower(email)),
	CONSTRAINT "email_suppressions_reason_check" CHECK (reason IN ('bounce', 'complaint'))
);
--> statement-breakpoint
CREATE INDEX "audit_log_shop_created_idx" ON "audit_log" USING btree ("shop_id","created_at");