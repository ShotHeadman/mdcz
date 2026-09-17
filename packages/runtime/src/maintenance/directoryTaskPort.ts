import { configurationSchema } from "@mdcz/shared/config";
import { directoryTaskScopeSchema } from "@mdcz/shared/directoryTasks";
import { maintenancePresetIdSchema } from "@mdcz/shared/serverDtos";
import type { MaintenanceDirectoryTaskDefinition } from "./coordinator";

type DirectoryTaskRow = {
  id: string;
  rootId: string;
  outputRootId: string;
  outputRelativeDirectory: string;
  presetId: string;
  scopeJson: string;
  configurationJson: string;
};

export function createMaintenanceDirectoryTaskPort(
  getRepository: () => Promise<{
    save(row: DirectoryTaskRow): void;
    get(id: string): DirectoryTaskRow;
    setStatus(id: string, status: string): void;
  }>,
) {
  return {
    save: async (definition: MaintenanceDirectoryTaskDefinition) => {
      const { directoryScope, configuration, ...fields } = definition;
      (await getRepository()).save({
        ...fields,
        scopeJson: JSON.stringify(directoryScope),
        configurationJson: JSON.stringify(configuration),
      });
    },
    get: async (id: string): Promise<MaintenanceDirectoryTaskDefinition> => {
      const row = (await getRepository()).get(id);
      return {
        id: row.id,
        rootId: row.rootId,
        outputRootId: row.outputRootId,
        outputRelativeDirectory: row.outputRelativeDirectory,
        presetId: maintenancePresetIdSchema.parse(row.presetId),
        directoryScope: directoryTaskScopeSchema.parse(JSON.parse(row.scopeJson)),
        configuration: configurationSchema.parse(JSON.parse(row.configurationJson)),
      };
    },
    setStatus: async (id: string, status: string) => (await getRepository()).setStatus(id, status),
  };
}
