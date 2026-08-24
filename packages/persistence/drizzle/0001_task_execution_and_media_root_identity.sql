ALTER TABLE `scrape_results` ADD `nfo_root_id` text;
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
CREATE UNIQUE INDEX `scan_results_task_root_path_idx` ON `scan_results` (`task_id`, `root_id`, `relative_path`);
--> statement-breakpoint
CREATE INDEX `task_records_queue_idx` ON `task_records` (`kind`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `task_records_kind_created_at_idx` ON `task_records` (`kind`, `created_at`);
--> statement-breakpoint
CREATE INDEX `task_events_task_created_at_idx` ON `task_events` (`task_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `scrape_outputs_completed_at_idx` ON `scrape_outputs` (`completed_at`);
--> statement-breakpoint
CREATE INDEX `scrape_results_task_path_idx` ON `scrape_results` (`task_id`, `relative_path`);
--> statement-breakpoint
ALTER TABLE `library_items` RENAME COLUMN `source_task_id` TO `source_run_id`;
--> statement-breakpoint
ALTER TABLE `library_items` RENAME COLUMN `scrape_output_id` TO `source_outcome_id`;
--> statement-breakpoint
UPDATE `library_items`
SET
  `source_run_id` = NULL,
  `source_outcome_id` = NULL;
--> statement-breakpoint
CREATE INDEX `library_items_source_run_idx` ON `library_items` (`source_run_id`);
--> statement-breakpoint
CREATE INDEX `library_items_created_at_idx` ON `library_items` (`created_at`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_item_files_root_path_idx` ON `library_item_files` (`root_id`, `root_relative_path`);
--> statement-breakpoint
CREATE INDEX `library_item_files_item_idx` ON `library_item_files` (`item_id`);
--> statement-breakpoint
CREATE INDEX `library_item_assets_item_idx` ON `library_item_assets` (`item_id`);
--> statement-breakpoint
CREATE INDEX `media_roots_state_idx` ON `media_roots` (`deleted`, `enabled`);
--> statement-breakpoint
ALTER TABLE `task_records` ADD `execution_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `media_roots`
SET
  `enabled` = 0,
  `deleted` = 1,
  `updated_at` = unixepoch() * 1000
WHERE `id` <> 'mdcz-metadata-output'
  AND `id` NOT LIKE 'path-%';
--> statement-breakpoint
DROP TABLE `maintenance_previews`;
--> statement-breakpoint
DROP TABLE `maintenance_apply_log`;
--> statement-breakpoint
CREATE TABLE `scrape_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `root_id` text NOT NULL,
  `output_root_id` text,
  `execution_mode` text NOT NULL CHECK (`execution_mode` IN ('single', 'batch')),
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scrape_runs_created_at_idx` ON `scrape_runs` (`created_at`);
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
  `run_id` text NOT NULL REFERENCES `scrape_runs`(`id`),
  `item_id` text NOT NULL REFERENCES `scrape_run_items`(`id`),
  `attempt` integer NOT NULL CHECK (`attempt` > 0),
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
  `completed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_item_outcomes_item_attempt_idx` ON `scrape_item_outcomes` (`item_id`, `attempt`);
--> statement-breakpoint
CREATE INDEX `scrape_item_outcomes_run_item_idx` ON `scrape_item_outcomes` (`run_id`, `item_id`, `attempt`);
--> statement-breakpoint
CREATE TABLE `scrape_run_summaries` (
  `run_id` text PRIMARY KEY NOT NULL REFERENCES `scrape_runs`(`id`),
  `disposition` text NOT NULL CHECK (`disposition` IN ('completed', 'failed', 'stopped')),
  `started_at` integer,
  `completed_at` integer NOT NULL,
  `success_count` integer NOT NULL CHECK (`success_count` >= 0),
  `failed_count` integer NOT NULL CHECK (`failed_count` >= 0),
  `skipped_count` integer NOT NULL CHECK (`skipped_count` >= 0),
  `total_bytes` integer NOT NULL CHECK (`total_bytes` >= 0),
  `output_root_id` text,
  `output_directory` text,
  `error_message` text
);
--> statement-breakpoint
CREATE INDEX `scrape_run_summaries_completed_at_idx` ON `scrape_run_summaries` (`completed_at`);
