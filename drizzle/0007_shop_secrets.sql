CREATE TABLE "shop_secrets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "shop_secrets_shop_id_name_unique" UNIQUE("shop_id","name"),
	CONSTRAINT "shop_secrets_name_format_check" CHECK (name ~ '^[a-z0-9_.]{1,64}$'),
	CONSTRAINT "shop_secrets_ciphertext_length_check" CHECK (octet_length(ciphertext) >= 28)
);
--> statement-breakpoint
ALTER TABLE "shop_secrets" ADD CONSTRAINT "shop_secrets_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;