import type { MediaLibraryRecord } from "@mdcz/persistence";
import type { PublicationTarget } from "@mdcz/shared/mediaLibrary";
import type { MaintenancePresetId } from "@mdcz/shared/types";
import { toPublicationTarget } from "../library/mediaLibraryService";
import type { ConfiguredMediaRootService } from "../library/mediaRootService";
import { getMaintenancePreset } from "./presets";

/**
 * Moving presets organize files already in a library under its output directory and templates. Only libraries that
 * place videos there can be organized: the others leave videos at their source, which organizing would move.
 */
export const resolveMaintenanceTarget = async (
  presetId: MaintenancePresetId,
  library: MediaLibraryRecord | undefined,
  mediaRoots: Pick<ConfiguredMediaRootService, "prepareOutputDirectory">,
): Promise<{ outputRootId: string; outputRelativeDirectory: string; target: PublicationTarget } | undefined> => {
  if (getMaintenancePreset(presetId).output !== "move") return undefined;
  if (!library) throw new Error("Choose the library to organize into");
  const target = toPublicationTarget(library);
  if (!["move", "hardlink", "copy"].includes(target.placement))
    throw new Error(`Library "${library.name}" keeps videos at their source, so it cannot be organized`);
  const output = await mediaRoots.prepareOutputDirectory({ hostPath: target.outputPath });
  return { outputRootId: output.id, outputRelativeDirectory: output.relativeDirectory, target };
};
