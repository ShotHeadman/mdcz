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
  `updated_at` integer NOT NULL,
  PRIMARY KEY(`number`, `site`),
  CHECK (`status` IN ('success', 'failed', 'skipped'))
);
