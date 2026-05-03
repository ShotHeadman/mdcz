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
--> statement-breakpoint
CREATE TABLE `scrape_outputs` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text,
  `root_id` text,
  `output_directory` text,
  `file_count` integer NOT NULL DEFAULT 0,
  `total_bytes` integer NOT NULL DEFAULT 0,
  `completed_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scrape_results` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `root_id` text NOT NULL,
  `relative_path` text NOT NULL,
  `status` text NOT NULL,
  `error_message` text,
  `crawler_data_json` text,
  `nfo_relative_path` text,
  `output_relative_path` text,
  `manual_url` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `root_id` text NOT NULL,
  `root_relative_path` text NOT NULL,
  `file_name` text NOT NULL,
  `directory` text NOT NULL,
  `size` integer NOT NULL DEFAULT 0,
  `modified_at` integer,
  `source_task_id` text,
  `scrape_output_id` text,
  `title` text,
  `number` text,
  `actors_json` text NOT NULL DEFAULT '[]',
  `thumbnail_path` text,
  `last_known_path` text,
  `indexed_at` integer NOT NULL,
  UNIQUE(`root_id`, `root_relative_path`)
);
--> statement-breakpoint
CREATE TABLE `library_items` (
  `id` text PRIMARY KEY NOT NULL,
  `media_identity` text,
  `crawler_data_json` text,
  `source_task_id` text,
  `scrape_output_id` text,
  `title` text,
  `number` text,
  `actors_json` text NOT NULL DEFAULT '[]',
  `indexed_at` integer NOT NULL,
  `last_refreshed_at` integer
);
--> statement-breakpoint
CREATE TABLE `library_item_files` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL,
  `root_id` text NOT NULL,
  `root_relative_path` text NOT NULL,
  `file_name` text NOT NULL,
  `directory` text NOT NULL,
  `size` integer NOT NULL DEFAULT 0,
  `modified_at` integer,
  `last_known_path` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE(`item_id`, `root_id`, `root_relative_path`)
);
--> statement-breakpoint
CREATE TABLE `library_item_assets` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL,
  `kind` text NOT NULL,
  `uri` text NOT NULL,
  `root_id` text,
  `relative_path` text,
  `created_at` integer NOT NULL
);
