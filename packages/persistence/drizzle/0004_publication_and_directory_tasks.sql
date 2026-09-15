ALTER TABLE `library_item_assets` ADD COLUMN `published` integer NOT NULL DEFAULT 0 CHECK (`published` IN (0, 1));
--> statement-breakpoint
ALTER TABLE `library_item_assets` ADD COLUMN `historical` integer NOT NULL DEFAULT 0 CHECK (`historical` IN (0, 1));
--> statement-breakpoint
CREATE INDEX `library_item_assets_output_idx` ON `library_item_assets` (`root_id`, `relative_path`);
--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `directory_scope_json` text;
--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `configuration_json` text;
--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `manifest_fixed_at` integer;
--> statement-breakpoint
ALTER TABLE `scrape_runs` ADD `discovery_json` text;
--> statement-breakpoint
CREATE TABLE `maintenance_directory_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `snapshot_json` text NOT NULL,
  `configuration_json` text NOT NULL,
  `updated_at` integer NOT NULL
);
