CREATE TABLE `trip_chats` (
	`trip_id` text NOT NULL,
	`chat_id` integer NOT NULL,
	`chat_title` text,
	`linked_by` integer NOT NULL,
	`linked_at` text NOT NULL,
	PRIMARY KEY(`trip_id`, `chat_id`),
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
