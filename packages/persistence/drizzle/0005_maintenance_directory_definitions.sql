CREATE TABLE `maintenance_directory_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `root_id` text NOT NULL,
  `output_root_id` text NOT NULL,
  `output_relative_directory` text NOT NULL,
  `preset_id` text NOT NULL,
  `scope_json` text NOT NULL,
  `configuration_json` text NOT NULL,
  `status` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
) STRICT;
