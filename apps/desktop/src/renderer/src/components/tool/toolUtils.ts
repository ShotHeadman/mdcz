import { ipc } from "@/client/ipc";

export async function browseDirectoryPath() {
  const result = await ipc.file.browse("directory");
  return result.paths?.[0]?.trim() ?? "";
}
