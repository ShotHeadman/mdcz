import { WorkbenchSetupAdapter, type WorkbenchSetupAdapterProps, type WorkbenchSetupPort } from "@mdcz/shared/adapters";
import { useMemo } from "react";
import { ipc } from "@/client/ipc";

const createDesktopSetupPort = (config: WorkbenchSetupAdapterProps["config"]): WorkbenchSetupPort => ({
  browseDirectory: async () => {
    const selection = await ipc.file.browse("directory");
    return selection.paths?.[0]?.trim() || null;
  },
  scanCandidates: async (scanDir, excludeDirPath) => await ipc.file.listMediaCandidates(scanDir, excludeDirPath),
  savePaths: async (scanDir, targetDir) => {
    const currentPaths = config?.paths;
    if (!currentPaths) {
      throw new Error("配置尚未加载完成");
    }

    await ipc.config.save({
      paths: {
        ...currentPaths,
        mediaPath: scanDir,
        successOutputFolder: targetDir || currentPaths.successOutputFolder,
      },
    });
  },
});

export default function WorkbenchSetup(props: Omit<WorkbenchSetupAdapterProps, "port">) {
  const port = useMemo(() => createDesktopSetupPort(props.config), [props.config]);
  return <WorkbenchSetupAdapter {...props} port={port} />;
}
