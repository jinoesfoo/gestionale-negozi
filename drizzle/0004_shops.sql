CREATE TABLE "platform_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"vat_number" text,
	"tax_code" text,
	"sdi_code" text,
	"pec" text,
	"address" jsonb,
	"subdomain" text NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grace_started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"trial_inactivity_warned_at" timestamp with time zone,
	"is_test" boolean DEFAULT false NOT NULL,
	"purge_requested_at" timestamp with time zone,
	"purge_notice_sent_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shops_subdomain_unique" UNIQUE("subdomain"),
	CONSTRAINT "shops_name_length_check" CHECK (char_length(name) BETWEEN 2 AND 120),
	CONSTRAINT "shops_vat_number_check" CHECK (vat_number ~ '^[0-9]{11}$'),
	CONSTRAINT "shops_tax_code_check" CHECK (tax_code ~ '^[A-Z0-9]{16}$' OR tax_code ~ '^[0-9]{11}$'),
	CONSTRAINT "shops_sdi_code_check" CHECK (sdi_code ~ '^[A-Z0-9]{7}$'),
	CONSTRAINT "shops_pec_check" CHECK (pec = lower(pec) AND pec ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
	CONSTRAINT "shops_address_check" CHECK (jsonb_typeof(address) = 'object'),
	CONSTRAINT "shops_subdomain_format_check" CHECK (subdomain ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
	CONSTRAINT "shops_subdomain_reserved_check" CHECK (subdomain NOT IN ('admin', 'app', 'clienti', 'www', 'api', 'mail', 'status', 'test', 'static', 'cdn', 'n')),
	CONSTRAINT "shops_status_check" CHECK (status IN ('trial', 'active', 'payment_processing', 'payment_failed', 'suspended', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;