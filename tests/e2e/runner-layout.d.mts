export type PlaywrightTarget = "web-chromium" | "desktop-electron" | undefined;

export interface E2ERunnerLayout {
  webRuntimeRoot: string;
  desktopRuntimeRoot: string;
  cleanupRuntimeRoots: string[];
  serverRuntimeRoot: string;
  mediaDir: string;
  desktopUserDataDir: string;
  resultDir: string;
  serverLogPath: string;
  reportDir: string;
  outputDir: string;
}

export declare function resolvePnpmCli(npmExecPath: string | undefined): string;
export declare function resolvePlaywrightTarget(args: readonly string[]): string | undefined;
export declare function resolveE2ERunnerLayout(
  workspaceRoot: string,
  playwrightTarget: PlaywrightTarget,
): E2ERunnerLayout;
