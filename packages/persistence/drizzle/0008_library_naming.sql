ALTER TABLE `media_libraries` ADD `asset_naming` text DEFAULT 'fixed' NOT NULL;
--> statement-breakpoint
ALTER TABLE `media_libraries` ADD `nfo_naming` text DEFAULT 'both' NOT NULL;
