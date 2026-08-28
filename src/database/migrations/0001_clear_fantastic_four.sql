ALTER TABLE "items" ADD COLUMN "safety_stock" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD COLUMN "moq" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD COLUMN "pack_size" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "supplier_items" ADD COLUMN "lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD COLUMN "last_price_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_safety_stock_non_negative" CHECK ("items"."safety_stock" >= 0);--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_moq_non_negative" CHECK ("supplier_items"."moq" >= 0);--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_pack_size_positive" CHECK ("supplier_items"."pack_size" is null or "supplier_items"."pack_size" > 0);--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_lead_time_non_negative" CHECK ("supplier_items"."lead_time_days" is null or "supplier_items"."lead_time_days" >= 0);--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_conversion_positive" CHECK ("supplier_items"."purchase_conversion" is null or "supplier_items"."purchase_conversion" > 0);--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_last_price_non_negative" CHECK ("supplier_items"."last_price" is null or "supplier_items"."last_price" >= 0);