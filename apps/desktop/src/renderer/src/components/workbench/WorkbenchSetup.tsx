import { WorkbenchSetupAdapter, type WorkbenchSetupAdapterProps, type WorkbenchSetupPort } from "@mdcz/views/adapters";
import { useMemo } from "react";
import { ipc } from "@/client/ipc";

const createDesktopSetupPort = (): WorkbenchSetupPort => ({
  browseDirectory: async () => {
    const selection = await ipc.file.browse("directory");
    return selection.paths?.[0]?.trim() || null;
  },
  scanCandidates: async (scanDir, excludeDirPaths) => await ipc.file.listMediaCandidates(scanDir, excludeDirPaths),
});

export default function WorkbenchSetup(props: Omit<WorkbenchSetupAdapterProps, "port">) {
  const port = useMemo(() => createDesktopSetupPort(), []);
  return <WorkbenchSetupAdapter {...props} port={port} />;
}
