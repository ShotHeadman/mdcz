DELETE FROM `task_events`
WHERE `task_id` IN (
  SELECT `id` FROM `task_records` WHERE `kind` <> 'scan'
);
--> statement-breakpoint
DELETE FROM `scan_results`
WHERE `task_id` IN (
  SELECT `id` FROM `task_records` WHERE `kind` <> 'scan'
);
--> statement-breakpoint
DELETE FROM `task_records` WHERE `kind` <> 'scan';
--> statement-breakpoint
DROP TABLE `scrape_results`;
--> statement-breakpoint
DROP TABLE `scrape_outputs`;
--> statement-breakpoint
DROP TABLE `library_entries`;
--> statement-breakpoint
DROP TABLE `maintenance_previews`;
--> statement-breakpoint
DROP TABLE `maintenance_apply_log`;
--> statement-breakpoint
DELETE FROM `scan_results`
WHERE EXISTS (
  SELECT 1
  FROM `scan_results` AS newer
  WHERE newer.`task_id` = `scan_results`.`task_id`
    AND newer.`root_id` = `scan_results`.`root_id`
    AND newer.`relative_path` = `scan_results`.`relative_path`
    AND (
      COALESCE(newer.`modified_at`, -1) > COALESCE(`scan_results`.`modified_at`, -1)
      OR (
        COALESCE(newer.`modified_at`, -1) = COALESCE(`scan_results`.`modified_at`, -1)
        AND newer.rowid > `scan_results`.rowid
      )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `scan_results_task_root_path_idx` ON `scan_results` (`task_id`, `root_id`, `relative_path`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_records_queue_idx` ON `task_records` (`kind`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_records_kind_created_at_idx` ON `task_records` (`kind`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_events_task_created_at_idx` ON `task_events` (`task_id`, `created_at`);
--> statement-breakpoint
ALTER TABLE `library_items` RENAME COLUMN `source_task_id` TO `source_run_id`;
--> statement-breakpoint
ALTER TABLE `library_items` RENAME COLUMN `scrape_output_id` TO `source_outcome_id`;
--> statement-breakpoint
UPDATE `library_items` SET `source_run_id` = NULL, `source_outcome_id` = NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `library_items_source_run_idx` ON `library_items` (`source_run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `library_items_created_at_idx` ON `library_items` (`created_at`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `library_item_files_root_path_idx` ON `library_item_files` (`root_id`, `root_relative_path`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `library_item_files_item_idx` ON `library_item_files` (`item_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `library_item_assets_item_idx` ON `library_item_assets` (`item_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_roots_state_idx` ON `media_roots` (`deleted`, `enabled`);
--> statement-breakpoint
ALTER TABLE `task_records` ADD `execution_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `scrape_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `root_id` text NOT NULL,
  `output_root_id` text,
  `execution_mode` text NOT NULL CHECK (`execution_mode` IN ('single', 'batch')),
  `retry_of_run_id` text REFERENCES `scrape_runs`(`id`),
  `created_at` integer NOT NULL,
  `started_at` integer,
  `completed_at` integer,
  `disposition` text CHECK (`disposition` IS NULL OR `disposition` IN ('completed', 'failed', 'stopped', 'interrupted')),
  `error_message` text
);
--> statement-breakpoint
CREATE INDEX `scrape_runs_created_at_idx` ON `scrape_runs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `scrape_runs_retry_of_run_idx` ON `scrape_runs` (`retry_of_run_id`);
--> statement-breakpoint
CREATE TABLE `scrape_run_items` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL REFERENCES `scrape_runs`(`id`),
  `ordinal` integer NOT NULL CHECK (`ordinal` >= 0),
  `root_id` text NOT NULL,
  `relative_path` text NOT NULL,
  `manual_url` text,
  `uncensored_choice` text CHECK (`uncensored_choice` IS NULL OR `uncensored_choice` IN ('umr', 'leak', 'uncensored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_run_items_run_ordinal_idx` ON `scrape_run_items` (`run_id`, `ordinal`);
--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_run_items_run_root_path_idx` ON `scrape_run_items` (`run_id`, `root_id`, `relative_path`);
--> statement-breakpoint
CREATE TABLE `scrape_item_outcomes` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL REFERENCES `scrape_run_items`(`id`),
  `outcome` text NOT NULL CHECK (`outcome` IN ('success', 'failed', 'skipped')),
  `error_message` text,
  `crawler_data_json` text,
  `nfo_root_id` text,
  `nfo_relative_path` text,
  `output_root_id` text,
  `output_relative_path` text,
  `uncensored_ambiguous` integer NOT NULL DEFAULT 0,
  `size` integer NOT NULL DEFAULT 0 CHECK (`size` >= 0),
  `modified_at` integer,
  `completed_at` integer NOT NULL,
  UNIQUE (`item_id`)
);
--> statement-breakpoint
CREATE TABLE `library_repair_issues` (
  `id` text PRIMARY KEY NOT NULL,
  `operation_id` text NOT NULL,
  `operation_type` text NOT NULL CHECK (`operation_type` IN ('scrape', 'maintenance')),
  `root_id` text NOT NULL,
  `relative_path` text NOT NULL,
  `error_message` text NOT NULL,
  `detected_at` integer NOT NULL,
  `resolved_at` integer,
  UNIQUE (`operation_id`, `root_id`, `relative_path`)
);
--> statement-breakpoint
CREATE INDEX `library_repair_issues_unresolved_idx` ON `library_repair_issues` (`resolved_at`, `detected_at`);
--> statement-breakpoint
CREATE INDEX `library_repair_issues_operation_idx` ON `library_repair_issues` (`operation_id`, `operation_type`);
