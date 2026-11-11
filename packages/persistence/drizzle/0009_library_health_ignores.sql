CREATE TABLE `library_health_ignores` (
  `item_id` text NOT NULL REFERENCES `library_items`(`id`) ON DELETE CASCADE,
  `issue` text NOT NULL,
  PRIMARY KEY(`item_id`, `issue`)
) STRICT;
