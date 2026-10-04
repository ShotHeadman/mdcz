const RELEASE_DOWNLOAD_URL = "https://github.com/ShotHeadman/mdcz/releases/download";

export interface UpdateDeliveryInput {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  isPortable: boolean;
  isAppImage: boolean;
  version: string;
  releaseUrl: string;
}

/** Returns the URL the user must download from, or null when the running build can install the update itself. */
export const resolveManualDownloadUrl = (input: UpdateDeliveryInput): string | null => {
  const assetUrl = (fileName: string) => `${RELEASE_DOWNLOAD_URL}/v${input.version}/${fileName}`;

  if (!input.isPackaged) {
    return input.releaseUrl;
  }
  if (input.platform === "win32") {
    return input.isPortable ? assetUrl(`MDCz-${input.version}-win-${input.arch}-portable.zip`) : null;
  }
  // Squirrel.Mac refuses to install updates into unsigned apps.
  if (input.platform === "darwin") {
    return assetUrl(`MDCz-${input.version}-mac-${input.arch}.dmg`);
  }
  return input.isAppImage ? null : input.releaseUrl;
};
