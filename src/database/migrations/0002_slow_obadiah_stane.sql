CREATE TYPE "public"."stock_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
ALTER TYPE "public"."inventory_transaction_type" ADD VALUE 'OPENING_BALANCE';--> statement-breakpoint
ALTER TYPE "public"."inventory_transaction_type" ADD VALUE 'REVERSAL';--> statement-breakpoint
CREATE TABLE "inventory_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"reference_type" "reference_type" NOT NULL,
	"reference_id" uuid,
	"reference_number" text,
	"reversal_of_posting_id" uuid,
	"posted_by" uuid,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "posting_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "direction" "stock_direction" NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "reversal_of_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_postings" ADD CONSTRAINT "inventory_postings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_postings" ADD CONSTRAINT "inventory_postings_reversal_of_posting_id_inventory_postings_id_fk" FOREIGN KEY ("reversal_of_posting_id") REFERENCES "public"."inventory_postings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_postings" ADD CONSTRAINT "inventory_postings_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_postings_idempotency_key" ON "inventory_postings" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_postings_reversal_key" ON "inventory_postings" USING btree ("reversal_of_posting_id");--> statement-breakpoint
CREATE INDEX "inventory_postings_reference_idx" ON "inventory_postings" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "inventory_postings_posted_idx" ON "inventory_postings" USING btree ("organization_id","posted_at");--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_posting_id_inventory_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."inventory_postings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reversal_of_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("reversal_of_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_transactions_posting_idx" ON "inventory_transactions" USING btree ("posting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_transactions_reversal_key" ON "inventory_transactions" USING btree ("reversal_of_transaction_id");--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_cost_non_negative" CHECK ("inventory_transactions"."unit_cost" >= 0);