import { randomUUID } from "node:crypto";
import { copyFile, link, mkdir, rename, rm, symlink } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { pathExists } from "../utils/filesystem";
import { sanitizePathSegment } from "../utils/path";

interface ActorImageLogger {
  info(message: string): void;
}

const buildActorPhotoFileName = (actorName: string, extension: string): string => {
  const sanitizedName = sanitizePathSegment(actorName) || "actor";
  return `${sanitizedName}${extension}`;
};

export class ActorPhotoMaterializer {
  constructor(private readonly logger: ActorImageLogger) {}

  async materializeForMovie(
    movieDirectory: string,
    actorName: string,
    sourcePath: string,
  ): Promise<string | undefined> {
    if (!movieDirectory.trim() || !sourcePath.trim() || !(await pathExists(sourcePath))) {
      return undefined;
    }

    const extension = extname(sourcePath).toLowerCase() || ".jpg";
    const actorsDirectory = join(movieDirectory, ".actors");
    const targetFileName = buildActorPhotoFileName(actorName, extension);
    const targetPath = join(actorsDirectory, targetFileName);
    const temporaryPath = join(actorsDirectory, `.${basename(targetFileName)}.${randomUUID()}.tmp`);

    await mkdir(actorsDirectory, { recursive: true });

    try {
      await this.createTemporaryMaterialization(sourcePath, temporaryPath);
      await rename(temporaryPath, targetPath);
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      return undefined;
    }

    this.logger.info(`Materialized actor photo for ${actorName}: ${targetPath}`);
    return relative(movieDirectory, targetPath).replaceAll("\\", "/");
  }

  private async createTemporaryMaterialization(sourcePath: string, temporaryPath: string): Promise<void> {
    try {
      await link(sourcePath, temporaryPath);
      return;
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }

    try {
      await symlink(sourcePath, temporaryPath, "file");
      return;
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }

    await copyFile(sourcePath, temporaryPath);
  }
}
