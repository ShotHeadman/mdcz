import { glob, rename, rm } from "node:fs/promises";
import { join, parse } from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import { type RuntimeLogger, runtimeLoggerService, toErrorMessage } from "../shared";
import { assertMoveTargetAbsent, PARKED_SOURCE_PREFIX } from "./MoveOutput";

const PARKED_SOURCE_NAME = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-(.+)$/;

export const recoverInterruptedPublications = async (
  roots: readonly Pick<MediaRoot, "hostPath">[],
  logger: Pick<RuntimeLogger, "warn"> = runtimeLoggerService.getLogger("PublicationRecovery"),
): Promise<void> => {
  for (const root of roots) {
    try {
      const staging: string[] = [];
      const parked: string[] = [];
      for await (const entry of glob(
        ["**/.mdcz-staging-*", "**/*.mdcz-staging-*.part", `**/${PARKED_SOURCE_PREFIX}*`],
        { cwd: root.hostPath, withFileTypes: true },
      )) {
        (entry.name.startsWith(PARKED_SOURCE_PREFIX) ? parked : staging).push(join(entry.parentPath, entry.name));
      }
      staging.sort((left, right) => right.length - left.length);
      for (const candidate of staging) {
        try {
          await rm(candidate, { recursive: true, force: true });
        } catch (error) {
          logger.warn(`Failed to remove publication staging path ${candidate}: ${toErrorMessage(error)}`);
        }
      }
      // A crash between parking and relocating a source hides the video behind a dot-prefixed name.
      for (const candidate of parked) {
        const entry = parse(candidate);
        const originalName = entry.base.slice(PARKED_SOURCE_PREFIX.length).match(PARKED_SOURCE_NAME)?.[1];
        if (!originalName) continue;
        const originalPath = join(entry.dir, originalName);
        try {
          await assertMoveTargetAbsent(originalPath);
          await rename(candidate, originalPath);
        } catch (error) {
          logger.warn(`Failed to restore parked source ${candidate} to ${originalPath}: ${toErrorMessage(error)}`);
        }
      }
    } catch (error) {
      logger.warn(`Failed to recover publications under ${root.hostPath}: ${toErrorMessage(error)}`);
    }
  }
};
