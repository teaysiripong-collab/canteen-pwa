CREATE TYPE "public"."menu_plan_status" AS ENUM('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "menu_plan_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"planned_servings" numeric(18, 4) DEFAULT '1' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_plan_template_items_servings_positive" CHECK ("menu_plan_template_items"."planned_servings" > 0)
);
--> statement-breakpoint
CREATE TABLE "menu_plan_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name_th" text NOT NULL,
	"location_id" uuid,
	"meal_period_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menu_plans" ADD COLUMN "status" "menu_plan_status" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_plans" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "menu_plans" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "menu_plan_template_items" ADD CONSTRAINT "menu_plan_template_items_template_id_menu_plan_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."menu_plan_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_plan_template_items" ADD CONSTRAINT "menu_plan_template_items_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_plan_templates" ADD CONSTRAINT "menu_plan_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_plan_templates" ADD CONSTRAINT "menu_plan_templates_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_plan_templates" ADD CONSTRAINT "menu_plan_templates_meal_period_id_meal_periods_id_fk" FOREIGN KEY ("meal_period_id") REFERENCES "public"."meal_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_plan_templates" ADD CONSTRAINT "menu_plan_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "menu_plan_template_items_key" ON "menu_plan_template_items" USING btree ("template_id","menu_id");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_plan_templates_org_name_key" ON "menu_plan_templates" USING btree ("organization_id","name_th");--> statement-breakpoint
CREATE INDEX "menu_plan_templates_org_idx" ON "menu_plan_templates" USING btree ("organization_id","is_active");--> statement-breakpoint
ALTER TABLE "menu_plans" ADD CONSTRAINT "menu_plans_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_plans_status_idx" ON "menu_plans" USING btree ("organization_id","status","plan_date");