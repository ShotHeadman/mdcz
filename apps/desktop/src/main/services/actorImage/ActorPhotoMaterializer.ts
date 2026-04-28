import { copyFile, link, mkdir, rm, symlink } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { pathExists } from "@main/utils/file";
import { sanitizePathSegment } from "@main/utils/path";

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

    await mkdir(actorsDirectory, { recursive: true });
    await rm(targetPath, { force: true });

    try {
      await link(sourcePath, targetPath);
    } catch {
      try {
        await symlink(sourcePath, targetPath, "file");
      } catch {
        try {
          await copyFile(sourcePath, targetPath);
        } catch {
          await rm(targetPath, { force: true }).catch(() => undefined);
          return undefined;
        }
      }
    }

    this.logger.info(`Materialized actor photo for ${actorName}: ${targetPath}`);
    return relative(movieDirectory, targetPath).replaceAll("\\", "/");
  }
}
