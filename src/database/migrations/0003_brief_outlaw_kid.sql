CREATE TABLE "recipe_item_period_quantities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_item_id" uuid NOT NULL,
	"meal_period_id" uuid NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_item_period_quantity_non_negative" CHECK ("recipe_item_period_quantities"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "recipe_item_period_quantities" ADD CONSTRAINT "recipe_item_period_quantities_recipe_item_id_recipe_items_id_fk" FOREIGN KEY ("recipe_item_id") REFERENCES "public"."recipe_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_item_period_quantities" ADD CONSTRAINT "recipe_item_period_quantities_meal_period_id_meal_periods_id_fk" FOREIGN KEY ("meal_period_id") REFERENCES "public"."meal_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_item_period_key" ON "recipe_item_period_quantities" USING btree ("recipe_item_id","meal_period_id");--> statement-breakpoint
CREATE INDEX "recipe_item_period_item_idx" ON "recipe_item_period_quantities" USING btree ("recipe_item_id");