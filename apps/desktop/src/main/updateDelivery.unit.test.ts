import { describe, expect, it } from "vitest";
import { resolveManualDownloadUrl, type UpdateDeliveryInput } from "./updateDelivery";

const RELEASE_URL = "https://github.com/ShotHeadman/mdcz/releases/tag/v1.2.3";
const ASSET_URL = "https://github.com/ShotHeadman/mdcz/releases/download/v1.2.3";

const base: UpdateDeliveryInput = {
  platform: "win32",
  arch: "x64",
  isPackaged: true,
  isPortable: false,
  isAppImage: false,
  version: "1.2.3",
  releaseUrl: RELEASE_URL,
};

describe("update delivery", () => {
  it.each([
    ["installed Windows build installs in-app", {}, null],
    [
      "portable Windows build downloads the portable zip",
      { isPortable: true },
      `${ASSET_URL}/MDCz-1.2.3-win-x64-portable.zip`,
    ],
    [
      "unsigned macOS build downloads the matching dmg",
      { platform: "darwin", arch: "arm64" },
      `${ASSET_URL}/MDCz-1.2.3-mac-arm64.dmg`,
    ],
    ["AppImage build installs in-app", { platform: "linux", isAppImage: true }, null],
    ["development build opens the release page", { isPackaged: false }, RELEASE_URL],
  ] satisfies Array<[string, Partial<UpdateDeliveryInput>, string | null]>)("%s", (_name, overrides, expected) => {
    expect(resolveManualDownloadUrl({ ...base, ...overrides })).toBe(expected);
  });
});
