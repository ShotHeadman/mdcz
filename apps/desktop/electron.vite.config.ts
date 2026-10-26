import { cp, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { createServer, type Plugin } from "vite";
import pkg from "./package.json" with { type: "json" };

const appResolve = (subpath: string): string => resolve(__dirname, subpath);
const workspaceResolve = (subpath: string): string => resolve(__dirname, "../..", subpath);
const workspacePackages = ["@mdcz/persistence", "@mdcz/runtime", "@mdcz/shared", "@mdcz/media-store"];
const externalDependencies = Object.keys(pkg.dependencies).filter(
  (dependency) => !workspacePackages.includes(dependency),
);

const desktopDistributionAssets = (): Plugin => ({
  name: "mdcz-desktop-distribution-assets",
  async buildStart() {
    const target = appResolve("out/drizzle");
    await rm(target, { recursive: true, force: true });
    await cp(workspaceResolve("packages/persistence/drizzle"), target, {
      recursive: true,
    });
  },
});

let webDevServer: Promise<unknown> | undefined;
// Its own port, so web's dev server can run beside it.
const WEB_DEV_PORT = 5183;

/** The window shows web's app; in development web's own Vite server provides it, started once before Electron. */
const webDevServerPlugin = (): Plugin => ({
  name: "mdcz-web-dev-server",
  async buildStart() {
    webDevServer ??= createServer({
      root: workspaceResolve("apps/web"),
      configFile: workspaceResolve("apps/web/vite.config.ts"),
      // The page's origin is the API scheme, so Vite's client cannot derive its HMR socket from the page's address.
      server: { port: WEB_DEV_PORT, strictPort: true, hmr: { host: "localhost", clientPort: WEB_DEV_PORT } },
    })
      .then(async (server) => await server.listen())
      .then((server) => {
        const url = server.resolvedUrls?.local[0];
        if (!url) throw new Error("Web's Vite server did not report a local URL");
        // Electron inherits this environment when electron-vite starts it after the build.
        process.env.MDCZ_WEB_DEV_URL = url;
      });
    await webDevServer;
  },
});

// The dev app records every scrape for replay; packaged builds use the plain network client.
export default defineConfig(({ command }) => ({
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: workspacePackages }),
      desktopDistributionAssets(),
      // electron-vite compiles main with Vite's build even in dev, so `apply: "serve"` would never match.
      ...(command === "serve" ? [webDevServerPlugin()] : []),
    ],
    resolve: {
      alias: {
        "@main/networkComposition": appResolve(
          command === "serve" ? "src/main/networkFixtureComposition.ts" : "src/main/networkComposition.ts",
        ),
        "@mdcz/persistence": workspaceResolve("packages/persistence/src/index.ts"),
        "@mdcz/runtime": workspaceResolve("packages/runtime/src"),
        "@mdcz/server": workspaceResolve("apps/server/src"),
        "@mdcz/shared": workspaceResolve("packages/shared"),
        "@mdcz/media-store": workspaceResolve("packages/media-store/src/index.ts"),
      },
    },
    build: {
      rollupOptions: {
        external: externalDependencies,
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    resolve: {
      alias: {
        "@mdcz/shared": workspaceResolve("packages/shared"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.js",
        },
      },
    },
  },
}));
