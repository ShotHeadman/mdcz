ALTER TABLE `library_item_assets` ADD COLUMN `published` integer NOT NULL DEFAULT 0 CHECK (`published` IN (0, 1));
--> statement-breakpoint
ALTER TABLE `library_item_assets` ADD COLUMN `historical` integer NOT NULL DEFAULT 0 CHECK (`historical` IN (0, 1));
--> statement-breakpoint
CREATE INDEX `library_item_assets_output_idx` ON `library_item_assets` (`root_id`, `relative_path`);
