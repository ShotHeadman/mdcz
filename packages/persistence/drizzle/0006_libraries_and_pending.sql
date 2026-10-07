CREATE TABLE `media_libraries` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `source_path` text NOT NULL,
  `output_path` text NOT NULL,
  `folder_template` text NOT NULL,
  `file_template` text NOT NULL,
  `placement` text NOT NULL,
  `automation` text NOT NULL,
  `discovery` text NOT NULL,
  `cloud_path` text NOT NULL,
  `scan_interval_minutes` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `library_watch_snapshots` (
  `library_id` text PRIMARY KEY NOT NULL REFERENCES `media_libraries`(`id`) ON DELETE CASCADE,
  `file_keys_json` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `site_results` (
  `number` text NOT NULL,
  `site` text NOT NULL,
  `status` text NOT NULL,
  `reason` text,
  `skip_reason` text,
  `detail` text,
  `http_status` integer,
  `elapsed_ms` integer NOT NULL,
  `data_json` text,
  `source_url` text,
  `updated_at` integer NOT NULL,
  PRIMARY KEY(`number`, `site`),
  CHECK (`status` IN ('success', 'failed', 'skipped'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `pending_items` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('no_number', 'not_found', 'ambiguous', 'failed', 'uncensored', 'new_file')),
  `root_id` text NOT NULL REFERENCES `media_roots`(`id`) ON DELETE CASCADE,
  `relative_path` text NOT NULL,
  `library_id` text REFERENCES `media_libraries`(`id`) ON DELETE SET NULL,
  `movie_id` text REFERENCES `library_items`(`id`) ON DELETE CASCADE,
  `number` text,
  `detail` text,
  `candidates_json` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_items_file_idx` ON `pending_items` (`root_id`, `relative_path`);
--> statement-breakpoint
CREATE INDEX `pending_items_updated_at_idx` ON `pending_items` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `api_keys` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `prefix` text NOT NULL,
  `key_hash` text NOT NULL UNIQUE,
  `created_at` integer NOT NULL,
  `last_used_at` integer
) STRICT;
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD COLUMN `library_id` text;
--> statement-breakpoint
ALTER TABLE `library_item_files` ADD COLUMN `retained_source_identity` text;
--> statement-breakpoint
CREATE INDEX `library_item_files_retained_source_idx` ON `library_item_files` (`retained_source_identity`);
--> statement-breakpoint
ALTER TABLE `library_items` DROP COLUMN `uncensored_ambiguous`;
