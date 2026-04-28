import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import type { SignalService } from "@main/services/SignalService";
import { toErrorMessage } from "@main/utils/common";
import { app } from "electron";

const GITHUB_REPO = "ShotHeadman/mdcz";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
}

export class UpdateService {
  private readonly logger = loggerService.getLogger("UpdateService");

  constructor(private readonly networkClient: NetworkClient) {}

  async checkForUpdate(): Promise<UpdateCheckResult> {
    const currentVersion = app.getVersion();

    try {
      const data = await this.networkClient.getJson<{ tag_name?: string; html_url?: string }>(GITHUB_API_URL, {
        headers: new Headers({
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "MDCz-Updater",
        }),
      });

      const latestTag = data.tag_name ?? "";
      const latestVersion = latestTag.replace(/^v/u, "");

      if (!latestVersion) {
        this.logger.warn("Update check: no version tag found in release");
        return { hasUpdate: false, currentVersion };
      }

      const hasUpdate = this.isNewerVersion(currentVersion, latestVersion);

      if (hasUpdate) {
        this.logger.info(`Update available: ${currentVersion} -> ${latestVersion}`);
      } else {
        this.logger.info(`Current version ${currentVersion} is up to date`);
      }

      return {
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseUrl: data.html_url,
      };
    } catch (error) {
      const message = toErrorMessage(error);
      this.logger.warn(`Update check failed: ${message}`);
      return { hasUpdate: false, currentVersion };
    }
  }

  async checkAndNotify(signalService: SignalService): Promise<void> {
    const result = await this.checkForUpdate();
    if (result.hasUpdate && result.latestVersion) {
      signalService.showLogText(
        `🔔 发现新版本 v${result.latestVersion}，当前版本 v${result.currentVersion}。请前往 GitHub 下载更新。`,
      );
    }
  }

  /**
   * Simple semver comparison: returns true if `latest` is newer than `current`.
   */
  private isNewerVersion(current: string, latest: string): boolean {
    const parse = (v: string) => v.split(".").map((s) => Number.parseInt(s, 10) || 0);
    const currentParts = parse(current);
    const latestParts = parse(latest);

    const maxLen = Math.max(currentParts.length, latestParts.length);
    for (let i = 0; i < maxLen; i++) {
      const c = currentParts[i] ?? 0;
      const l = latestParts[i] ?? 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }
}
