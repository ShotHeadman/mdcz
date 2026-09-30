import { z } from "zod";

export const directorySourceSchema = z.object({
  kind: z.literal("directory"),
  scanDir: z.string().trim().min(1),
  recursive: z.boolean(),
});

export type DirectorySource = z.infer<typeof directorySourceSchema>;

export const directoryTaskScopeSchema = directorySourceSchema.extend({
  excludeDirPaths: z.array(z.string()),
  targetDir: z.string(),
});
export type DirectoryTaskScope = z.infer<typeof directoryTaskScopeSchema>;

export interface DiscoveryProgress {
  directories: number;
  candidates: number;
  skipped: number;
  elapsedMs: number;
  currentPath: string | null;
  warnings: string[];
}
