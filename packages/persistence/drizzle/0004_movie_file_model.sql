ALTER TABLE `scrape_runs` ADD `directory_scope_json` text;
--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `configuration_json` text;
--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `manifest_fixed_at` integer;
--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `discovery_json` text;
--> statement-breakpoint
DROP TABLE `library_item_assets`;
--> statement-breakpoint
DROP TABLE `library_item_files`;
--> statement-breakpoint
DROP TABLE `library_items`;
--> statement-breakpoint
CREATE TABLE `library_items` (
  `id` text PRIMARY KEY NOT NULL,
  `media_identity` text,
  `crawler_data_json` text,
  `title` text,
  `number` text,
  `actors_json` text NOT NULL DEFAULT '[]',
  `created_at` integer NOT NULL,
  `last_refreshed_at` integer,
  `hidden_from_recent_at` integer
) STRICT;
--> statement-breakpoint
CREATE TABLE `library_item_files` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL REFERENCES `library_items`(`id`) ON DELETE CASCADE,
  `root_id` text NOT NULL REFERENCES `media_roots`(`id`) ON DELETE RESTRICT,
  `root_relative_path` text NOT NULL,
  `file_name` text NOT NULL,
  `directory` text NOT NULL,
  `size` integer NOT NULL DEFAULT 0,
  `modified_at` integer,
  `last_known_path` text,
  `part_number` integer CHECK (`part_number` IS NULL OR `part_number` >= 1),
  `part_suffix` text,
  `resolution` text,
  `source_outcome_id` text REFERENCES `scrape_item_outcomes`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE (`item_id`, `id`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `library_item_assets` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL REFERENCES `library_items`(`id`) ON DELETE CASCADE,
  `file_id` text,
  `kind` text NOT NULL,
  `uri` text NOT NULL,
  `root_id` text REFERENCES `media_roots`(`id`) ON DELETE RESTRICT,
  `relative_path` text,
  `published` integer NOT NULL DEFAULT 0 CHECK (`published` IN (0, 1)),
  `historical` integer NOT NULL DEFAULT 0 CHECK (`historical` IN (0, 1)),
  `created_at` integer NOT NULL,
  CHECK ((`root_id` IS NULL) = (`relative_path` IS NULL)),
  CHECK ((`kind` IN ('strm', 'subtitle')) = (`file_id` IS NOT NULL)),
  FOREIGN KEY (`item_id`, `file_id`) REFERENCES `library_item_files` (`item_id`, `id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE INDEX `library_items_created_at_idx` ON `library_items` (`created_at`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_item_files_root_path_idx` ON `library_item_files` (`root_id`, `root_relative_path`);
--> statement-breakpoint
CREATE INDEX `library_item_files_source_outcome_idx` ON `library_item_files` (`source_outcome_id`);
--> statement-breakpoint
CREATE INDEX `library_item_assets_item_idx` ON `library_item_assets` (`item_id`);
--> statement-breakpoint
CREATE INDEX `library_item_assets_file_idx` ON `library_item_assets` (`file_id`);
--> statement-breakpoint
CREATE INDEX `library_item_assets_output_idx` ON `library_item_assets` (`root_id`, `relative_path`);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_item_assets_public_scope_idx`
ON `library_item_assets` (`item_id`, `kind`, ifnull(`root_id`, ''), ifnull(`relative_path`, `uri`))
WHERE `file_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `library_item_assets_file_scope_idx`
ON `library_item_assets` (`item_id`, `file_id`, `kind`, ifnull(`root_id`, ''), ifnull(`relative_path`, `uri`))
WHERE `file_id` IS NOT NULL;
