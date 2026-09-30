import { isWindowsPortable } from "@main/appIdentity";
import { configManager } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { SignalService } from "@main/services/SignalService";
import { resolveManualDownloadUrl } from "@main/updateDelivery";
import { toErrorMessage } from "@main/utils/common";
import type { AppUpdateStatus } from "@mdcz/shared/ipcTypes";
import { app, type Session, session } from "electron";
import electronUpdater, { type AppUpdater } from "electron-updater";

const LATEST_RELEASE_API_URL = "https://api.github.com/repos/ShotHeadman/mdcz/releases/latest";
// electron-updater downloads through this fixed partition; checking through it too keeps both on one proxy route.
const UPDATER_SESSION_PARTITION = "electron-updater";

const isNewerVersion = (latest: string, current: string): boolean =>
  latest.localeCompare(current, undefined, { numeric: true }) > 0;

export class UpdateService {
  private readonly logger = loggerService.getLogger("UpdateService");
  private status: AppUpdateStatus = { phase: "idle" };
  private updater: AppUpdater | null = null;

  constructor(private readonly signalService: SignalService) {}

  getStatus(): AppUpdateStatus {
    return this.status;
  }

  async check(): Promise<AppUpdateStatus> {
    if (["checking", "downloading", "downloaded"].includes(this.status.phase)) {
      return this.status;
    }

    this.setStatus({ phase: "checking" });
    try {
      const updaterSession = await this.prepareSession();
      const response = await updaterSession.fetch(LATEST_RELEASE_API_URL, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) {
        throw new Error(`GitHub responded with HTTP ${response.status}`);
      }
      const release = (await response.json()) as { tag_name: string; html_url: string };
      const version = release.tag_name.replace(/^v/u, "");
      const currentVersion = app.getVersion();

      if (!isNewerVersion(version, currentVersion)) {
        this.logger.info(`Current version ${currentVersion} is up to date`);
        this.setStatus({ phase: "latest" });
        return this.status;
      }

      this.logger.info(`Update available: ${currentVersion} -> ${version}`);
      this.setStatus({
        phase: "available",
        version,
        releaseUrl: release.html_url,
        manualDownloadUrl: resolveManualDownloadUrl({
          platform: process.platform,
          arch: process.arch,
          isPackaged: app.isPackaged,
          isPortable: isWindowsPortable(),
          isAppImage: Boolean(process.env.APPIMAGE),
          version,
          releaseUrl: release.html_url,
        }),
      });
    } catch (error) {
      this.fail("Update check failed", error);
    }
    return this.status;
  }

  async download(): Promise<void> {
    if (this.status.phase !== "available" || this.status.manualDownloadUrl !== null) {
      throw new Error("No in-app update is ready to download");
    }

    const { version } = this.status;
    this.setStatus({ phase: "downloading", version, percent: 0 });
    try {
      await this.prepareSession();
      const updater = this.getUpdater();
      await updater.checkForUpdates();
      await updater.downloadUpdate();
      this.setStatus({ phase: "downloaded", version });
    } catch (error) {
      this.fail("Update download failed", error);
    }
  }

  install(): void {
    if (this.status.phase !== "downloaded") {
      throw new Error("No downloaded update to install");
    }
    this.getUpdater().quitAndInstall(true, true);
  }

  /** Uses the configured proxy when set, otherwise the OS proxy settings. */
  private async prepareSession(): Promise<Session> {
    const updaterSession = session.fromPartition(UPDATER_SESSION_PARTITION, { cache: false });
    const proxyUrl = configManager.getComputed().proxyUrl;
    await updaterSession.setProxy(proxyUrl ? { proxyRules: proxyUrl } : { mode: "system" });
    return updaterSession;
  }

  private getUpdater(): AppUpdater {
    if (this.updater) {
      return this.updater;
    }

    const updater = electronUpdater.autoUpdater;
    updater.autoDownload = false;
    updater.logger = this.logger;
    updater.on("download-progress", ({ percent }) => {
      if (this.status.phase === "downloading") {
        this.setStatus({ ...this.status, percent: Math.floor(percent) });
      }
    });
    this.updater = updater;
    return updater;
  }

  private fail(context: string, error: unknown): void {
    const message = toErrorMessage(error);
    this.logger.warn(`${context}: ${message}`);
    this.setStatus({ phase: "error", message });
  }

  private setStatus(status: AppUpdateStatus): void {
    this.status = status;
    this.signalService.publishUpdateStatus(status);
  }
}
