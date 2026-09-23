import { glob, rm } from "node:fs/promises";
import { join } from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import { type RuntimeLogger, runtimeLoggerService, toErrorMessage } from "../shared";

export const cleanupPublicationStaging = async (
  roots: readonly Pick<MediaRoot, "hostPath">[],
  logger: Pick<RuntimeLogger, "warn"> = runtimeLoggerService.getLogger("PublicationCleanup"),
): Promise<void> => {
  for (const root of roots) {
    try {
      const paths: string[] = [];
      for await (const entry of glob(["**/.mdcz-staging-*", "**/*.mdcz-staging-*.part"], {
        cwd: root.hostPath,
        withFileTypes: true,
      })) {
        paths.push(join(entry.parentPath, entry.name));
      }
      paths.sort((left, right) => right.length - left.length);
      for (const candidate of paths) {
        try {
          await rm(candidate, { recursive: true, force: true });
        } catch (error) {
          logger.warn(`Failed to remove publication staging path ${candidate}: ${toErrorMessage(error)}`);
        }
      }
    } catch (error) {
      logger.warn(`Failed to sweep publication staging under ${root.hostPath}: ${toErrorMessage(error)}`);
    }
  }
};
