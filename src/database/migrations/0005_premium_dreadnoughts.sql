ALTER TABLE "stock_issue_items" ADD COLUMN "unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_issues" ADD COLUMN "meal_period_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_meal_period_id_meal_periods_id_fk" FOREIGN KEY ("meal_period_id") REFERENCES "public"."meal_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_issue_items" ADD CONSTRAINT "stock_issue_items_cost_non_negative" CHECK ("stock_issue_items"."unit_cost" >= 0);