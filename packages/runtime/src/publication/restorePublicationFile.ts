import { observePublicationFile } from "./preflight";
import type { PublicationFileIdentity, PublicationFileSystem } from "./types";

export const restorePublicationFile = async (
  fileSystem: PublicationFileSystem,
  item: {
    sourcePath?: string;
    staged?: PublicationFileIdentity;
    recovering?: boolean;
    targetPath: string;
    temporaryPath: string;
    backupPath: string | null;
    targetExisted: boolean;
  },
  restoreTarget = true,
): Promise<void> => {
  const backupExists = item.backupPath ? (await observePublicationFile(fileSystem, item.backupPath)).exists : false;
  const target = item.recovering ? await observePublicationFile(fileSystem, item.targetPath) : undefined;
  let recoverableTarget = restoreTarget && (!item.targetExisted || backupExists);
  if (item.recovering && target?.exists && recoverableTarget) {
    const current = await fileSystem.stat(item.targetPath);
    const staged = item.staged;
    recoverableTarget = Boolean(
      staged &&
        current.size === staged.size &&
        current.mtimeMs === staged.mtimeMs &&
        current.ino === staged.ino &&
        current.dev === staged.dev,
    );
  }
  if (item.sourcePath && !(await observePublicationFile(fileSystem, item.sourcePath)).exists) {
    const temporaryExists = (await observePublicationFile(fileSystem, item.temporaryPath)).exists;
    if (!temporaryExists && !recoverableTarget) {
      throw new Error(`Pending publication is missing its source: ${item.sourcePath}`);
    }
    // Restore the only copy before replacing or deleting any publication target.
    await fileSystem.rename(temporaryExists ? item.temporaryPath : item.targetPath, item.sourcePath);
  }
  if (!restoreTarget) return;
  if (item.recovering && target?.exists && !recoverableTarget && (!item.targetExisted || backupExists)) {
    throw new Error(`Pending publication target is not the staged file: ${item.targetPath}`);
  }
  if (backupExists && item.backupPath) {
    await fileSystem.rename(item.backupPath, item.targetPath);
  } else if (item.targetExisted) {
    if (!(await observePublicationFile(fileSystem, item.targetPath)).exists) {
      throw new Error(`Pending publication is missing both backup and target: ${item.targetPath}`);
    }
  } else {
    await fileSystem.rm(item.targetPath, { force: true });
  }
};
