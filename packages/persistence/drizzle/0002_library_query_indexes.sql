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
CREATE INDEX `maintenance_previews_task_path_idx` ON `maintenance_previews` (`task_id`, `relative_path`);
--> statement-breakpoint
CREATE INDEX `maintenance_apply_log_task_applied_at_idx` ON `maintenance_apply_log` (`task_id`, `applied_at`);
--> statement-breakpoint
CREATE INDEX `library_items_source_task_idx` ON `library_items` (`source_task_id`);
--> statement-breakpoint
CREATE INDEX `library_items_created_at_idx` ON `library_items` (`created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `library_item_files_root_path_idx` ON `library_item_files` (`root_id`, `root_relative_path`);
--> statement-breakpoint
CREATE INDEX `library_item_files_item_idx` ON `library_item_files` (`item_id`);
--> statement-breakpoint
CREATE INDEX `library_item_assets_item_idx` ON `library_item_assets` (`item_id`);
