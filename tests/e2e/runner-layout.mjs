import path from "node:path";

export const resolvePnpmCli = (npmExecPath) => npmExecPath?.trim() || "pnpm";

export const resolvePlaywrightTarget = (args) => {
  for (const [index, argument] of args.entries()) {
    if (argument.startsWith("--project=")) {
      return argument.slice("--project=".length);
    }
    if (argument === "--project") {
      return args[index + 1];
    }
  }
  return undefined;
};

export const resolveE2ERunnerLayout = (workspaceRoot, playwrightTarget) => {
  const webRuntimeRoot = path.join(workspaceRoot, ".tmp", "e2e-web");
  const desktopRuntimeRoot = path.join(workspaceRoot, ".tmp", "e2e-desktop");
  const resultDir = path.join(workspaceRoot, "test-results");
  const isDesktopOnly = playwrightTarget === "desktop-electron";
  const isWebOnly = playwrightTarget === "web-chromium";
  const targetRuntimeRoot = isDesktopOnly ? desktopRuntimeRoot : webRuntimeRoot;

  return {
    webRuntimeRoot,
    desktopRuntimeRoot,
    cleanupRuntimeRoots: isDesktopOnly
      ? [desktopRuntimeRoot]
      : isWebOnly
        ? [webRuntimeRoot]
        : [webRuntimeRoot, desktopRuntimeRoot],
    serverRuntimeRoot: path.join(targetRuntimeRoot, "server"),
    mediaDir: path.join(targetRuntimeRoot, "media"),
    desktopUserDataDir: path.join(desktopRuntimeRoot, "user-data"),
    resultDir,
    serverLogPath: path.join(resultDir, isDesktopOnly ? "desktop-e2e-server.log" : "web-e2e-server.log"),
    reportDir: path.join(
      workspaceRoot,
      isDesktopOnly ? "playwright-report-desktop" : isWebOnly ? "playwright-report-web" : "playwright-report",
    ),
    outputDir: path.join(resultDir, isDesktopOnly ? "playwright-desktop" : isWebOnly ? "playwright-web" : "playwright"),
  };
};
