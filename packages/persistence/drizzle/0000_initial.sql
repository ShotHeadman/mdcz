CREATE TABLE `media_roots` (
  `id` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL,
  `host_path` text NOT NULL,
  `root_type` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `deleted` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_records` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `root_id` text NOT NULL,
  `status` text NOT NULL,
  `summary` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `started_at` integer,
  `completed_at` integer,
  `error_message` text,
  `video_count` integer NOT NULL DEFAULT 0,
  `directory_count` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `task_events` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `type` text NOT NULL,
  `message` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scan_results` (
  `task_id` text NOT NULL,
  `root_id` text NOT NULL,
  `relative_path` text NOT NULL,
  `size` integer NOT NULL,
  `modified_at` integer
);
