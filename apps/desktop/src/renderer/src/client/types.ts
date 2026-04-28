import type { Configuration } from "@mdcz/shared/config";

export type ConfigOutput = Configuration;

export interface UpdateConfigData {
  body?: Record<string, unknown>;
}

export interface CreateSoftlinksBody {
  source_dir: string;
  dest_dir: string;
  copy_files: boolean;
}

export interface ScrapeFileBody {
  path: string;
  url?: string;
}

export interface FileItem {
  type: "file" | "directory";
  path: string;
  name: string;
  size?: number;
  last_modified?: string | null;
}
