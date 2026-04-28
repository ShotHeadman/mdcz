CREATE TABLE `media_roots` (
  `id` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL,
  `host_path` text NOT NULL,
  `root_type` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_records` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `summary` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `started_at` integer,
  `completed_at` integer,
  `error_message` text
);
