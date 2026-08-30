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
CREATE TABLE `media_roots_new` (
  `id` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL,
  `host_path` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `media_roots_new` (`id`, `display_name`, `host_path`, `created_at`, `updated_at`)
SELECT `id`, `display_name`, `host_path`, `created_at`, `updated_at` FROM `media_roots`;
--> statement-breakpoint
DROP TABLE `media_roots`;
--> statement-breakpoint
ALTER TABLE `media_roots_new` RENAME TO `media_roots`;
--> statement-breakpoint
ALTER TABLE `library_items` RENAME COLUMN `source_task_id` TO `source_run_id`;
--> statement-breakpoint
ALTER TABLE `library_items` RENAME COLUMN `scrape_output_id` TO `source_outcome_id`;
--> statement-breakpoint
UPDATE `library_items` SET `source_run_id` = NULL, `source_outcome_id` = NULL;
--> statement-breakpoint
CREATE TABLE `scan_tasks_new` (
  `id` text PRIMARY KEY NOT NULL,
  `root_id` text NOT NULL,
  `status` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `started_at` integer,
  `completed_at` integer,
  `error_message` text,
  `video_count` integer NOT NULL DEFAULT 0,
  `directory_count` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO `scan_tasks_new` (
  `id`, `root_id`, `status`, `created_at`, `updated_at`, `started_at`, `completed_at`, `error_message`, `video_count`, `directory_count`
)
SELECT
  `id`, `root_id`, `status`, `created_at`, `updated_at`, `started_at`, `completed_at`, `error_message`, `video_count`, `directory_count`
FROM `task_records`;
--> statement-breakpoint
DROP TABLE `task_records`;
--> statement-breakpoint
ALTER TABLE `scan_tasks_new` RENAME TO `scan_tasks`;
--> statement-breakpoint
ALTER TABLE `task_events` RENAME TO `scan_task_events`;
--> statement-breakpoint
CREATE TABLE `scrape_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `root_id` text NOT NULL,
  `output_root_id` text,
  `execution_mode` text NOT NULL CHECK (`execution_mode` IN ('single', 'batch')),
  `created_at` integer NOT NULL,
  `started_at` integer,
  `completed_at` integer,
  `disposition` text CHECK (`disposition` IS NULL OR `disposition` IN ('completed', 'failed', 'stopped', 'interrupted')),
  `error_message` text
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
CREATE TABLE `scrape_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL REFERENCES `scrape_run_items`(`id`) ON DELETE CASCADE,
  `attempt` integer NOT NULL CHECK (`attempt` >= 1),
  `admitted_at` integer NOT NULL,
  UNIQUE (`item_id`, `attempt`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `scrape_item_outcomes` (
  `id` text PRIMARY KEY NOT NULL,
  `attempt_id` text NOT NULL REFERENCES `scrape_attempts`(`id`) ON DELETE CASCADE,
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
  UNIQUE (`attempt_id`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `publication_journal` (
  `operation_id` text PRIMARY KEY NOT NULL,
  `operation_type` text NOT NULL,
  `state` text NOT NULL CHECK (`state` IN ('pending', 'committed')),
  `manifest_json` text NOT NULL,
  `created_at` integer NOT NULL
) STRICT;
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
CREATE TABLE `library_items_new` (
  `id` text PRIMARY KEY NOT NULL,
  `media_identity` text,
  `crawler_data_json` text,
  `source_run_id` text,
  `source_outcome_id` text,
  `title` text,
  `number` text,
  `actors_json` text NOT NULL DEFAULT '[]',
  `created_at` integer NOT NULL,
  `last_refreshed_at` integer,
  `hidden_from_recent_at` integer
) STRICT;
--> statement-breakpoint
INSERT INTO `library_items_new` (
  `id`, `media_identity`, `crawler_data_json`, `source_run_id`, `source_outcome_id`, `title`, `number`, `actors_json`, `created_at`, `last_refreshed_at`, `hidden_from_recent_at`
)
SELECT
  `id`, `media_identity`, `crawler_data_json`, `source_run_id`, `source_outcome_id`, `title`, `number`, `actors_json`, `created_at`, `last_refreshed_at`, `hidden_from_recent_at`
FROM `library_items`;
--> statement-breakpoint
CREATE TABLE `library_item_files_new` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL REFERENCES `library_items_new`(`id`) ON DELETE CASCADE,
  `root_id` text NOT NULL REFERENCES `media_roots`(`id`) ON DELETE RESTRICT,
  `root_relative_path` text NOT NULL,
  `file_name` text NOT NULL,
  `directory` text NOT NULL,
  `size` integer NOT NULL DEFAULT 0,
  `modified_at` integer,
  `last_known_path` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
INSERT INTO `library_item_files_new` (
  `id`, `item_id`, `root_id`, `root_relative_path`, `file_name`, `directory`, `size`, `modified_at`, `last_known_path`, `created_at`, `updated_at`
)
SELECT
  `id`, `item_id`, `root_id`, `root_relative_path`, `file_name`, `directory`, `size`, `modified_at`, `last_known_path`, `created_at`, `updated_at`
FROM `library_item_files`;
--> statement-breakpoint
CREATE TABLE `library_item_assets_new` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL REFERENCES `library_items_new`(`id`) ON DELETE CASCADE,
  `kind` text NOT NULL,
  `uri` text NOT NULL,
  `root_id` text REFERENCES `media_roots`(`id`) ON DELETE RESTRICT,
  `relative_path` text,
  `created_at` integer NOT NULL,
  CHECK ((`root_id` IS NULL) = (`relative_path` IS NULL))
) STRICT;
--> statement-breakpoint
INSERT INTO `library_item_assets_new` (`id`, `item_id`, `kind`, `uri`, `root_id`, `relative_path`, `created_at`)
SELECT `id`, `item_id`, `kind`, `uri`, `root_id`, `relative_path`, `created_at`
FROM `library_item_assets`;
--> statement-breakpoint
DROP TABLE `library_item_assets`;
--> statement-breakpoint
DROP TABLE `library_item_files`;
--> statement-breakpoint
DROP TABLE `library_items`;
--> statement-breakpoint
ALTER TABLE `library_items_new` RENAME TO `library_items`;
--> statement-breakpoint
ALTER TABLE `library_item_files_new` RENAME TO `library_item_files`;
--> statement-breakpoint
ALTER TABLE `library_item_assets_new` RENAME TO `library_item_assets`;
--> statement-breakpoint
CREATE UNIQUE INDEX `scan_results_task_root_path_idx` ON `scan_results` (`task_id`, `root_id`, `relative_path`);
--> statement-breakpoint
CREATE INDEX `scan_tasks_queue_idx` ON `scan_tasks` (`status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `scan_tasks_created_at_idx` ON `scan_tasks` (`created_at`);
--> statement-breakpoint
CREATE INDEX `scan_task_events_task_created_at_idx` ON `scan_task_events` (`task_id`, `created_at`);
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
CREATE INDEX `library_repair_issues_unresolved_idx` ON `library_repair_issues` (`resolved_at`, `detected_at`);
--> statement-breakpoint
CREATE INDEX `library_repair_issues_operation_idx` ON `library_repair_issues` (`operation_id`, `operation_type`);
