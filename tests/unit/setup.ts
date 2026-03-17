import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

const userDataPath = join(tmpdir(), "mdcz-vitest", String(process.pid));

vi.mock("electron", () => {
  const app = {
    isReady: () => false,
    isPackaged: true,
    getPath: () => userDataPath,
    commandLine: {
      appendSwitch: () => {},
    },
    setAppUserModelId: () => {},
  };

  return {
    app,
  };
});
