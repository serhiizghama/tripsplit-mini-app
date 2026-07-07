PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`type` text NOT NULL,
	`payer_id` integer,
	`status` text DEFAULT 'paid' NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`rate_to_base` real NOT NULL,
	`rate_overridden` integer DEFAULT 0 NOT NULL,
	`amount_base_minor` integer NOT NULL,
	`description` text,
	`category` text,
	`split_mode` text DEFAULT 'equal' NOT NULL,
	`spent_on` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expenses_type_check" CHECK("__new_expenses"."type" IN ('expense','settlement')),
	CONSTRAINT "expenses_split_mode_check" CHECK("__new_expenses"."split_mode" IN ('equal','custom','solo')),
	CONSTRAINT "expenses_status_check" CHECK("__new_expenses"."status" IN ('planned','paid')),
	CONSTRAINT "expenses_planned_payer_check" CHECK(("__new_expenses"."status" = 'paid' AND "__new_expenses"."payer_id" IS NOT NULL) OR ("__new_expenses"."status" = 'planned' AND "__new_expenses"."payer_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_expenses`("id", "trip_id", "type", "payer_id", "amount_minor", "currency", "rate_to_base", "rate_overridden", "amount_base_minor", "description", "category", "split_mode", "spent_on", "created_by", "created_at", "updated_at", "deleted_at") SELECT "id", "trip_id", "type", "payer_id", "amount_minor", "currency", "rate_to_base", "rate_overridden", "amount_base_minor", "description", "category", "split_mode", "spent_on", "created_by", "created_at", "updated_at", "deleted_at" FROM `expenses`;--> statement-breakpoint
DROP TABLE `expenses`;--> statement-breakpoint
ALTER TABLE `__new_expenses` RENAME TO `expenses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;