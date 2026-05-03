import type { Configuration } from "@mdcz/shared/config";
import { api } from "../client";

/**
 * Web-side `ipc` adapter that mirrors the desktop renderer's `ipc.config.*` and
 * `ipc.file.browse` shapes so settings components ported verbatim from the
 * desktop renderer can run unmodified. Implementations route to the tRPC
 * server (`api.config.*`) and to browser-native file pickers/downloads.
 */

interface BrowseFilter {
  name: string;
  extensions: string[];
}

interface BrowseResult {
  canceled: boolean;
  paths: string[];
}

interface ImportFileEntry {
  file: File;
  syntheticPath: string;
}

const importFileStash = new Map<string, ImportFileEntry>();
let syntheticPathCounter = 0;

const buildAcceptString = (filters: BrowseFilter[]): string =>
  filters.flatMap((filter) => filter.extensions.map((extension) => `.${extension.replace(/^\./u, "")}`)).join(",");

const promptForFile = (filters: BrowseFilter[]): Promise<File | null> =>
  new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    if (filters.length > 0) {
      input.accept = buildAcceptString(filters);
    }
    let settled = false;
    const resolveOnce = (file: File | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      resolve(file);
    };
    const onChange = () => {
      const file = input.files?.[0] ?? null;
      resolveOnce(file);
    };
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled && (input.files?.length ?? 0) === 0) {
          resolveOnce(null);
        }
      }, 200);
    };
    input.addEventListener("change", onChange, { once: true });
    window.addEventListener("focus", onFocus);
    input.click();
  });

const triggerDownload = (fileName: string, content: string, mimeType: string): void => {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export const ipc = {
  app: {
    ensureWatermarkDirectory: async () => ({ path: "(server)", warnings: [] as string[] }),
    openWatermarkDirectory: async () => undefined,
    relaunch: async () => {
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    },
  },
  crawler: {
    listSites: async () => ({ sites: [] as Array<unknown> }),
    probeSiteConnectivity: async (_site: string) => ({ ok: false, message: "WebUI 暂不支持站点连通性测试" }),
  },
  network: {
    checkCookies: async () => ({ results: [] as Array<{ site: string; valid: boolean; message: string }> }),
  },
  translate: {
    testLlm: async (_input: unknown) => ({ success: false, message: "WebUI 暂不支持 LLM 测试" }),
  },
  config: {
    get: async (path?: string) => {
      if (path) {
        return await api.config.read();
      }
      return await api.config.read();
    },
    getDefaults: () => api.config.defaults() as Promise<Configuration>,
    save: async (config?: Partial<Configuration>) => {
      if (!config) return await api.config.read();
      return await api.config.update(config as Parameters<typeof api.config.update>[0]);
    },
    list: () => Promise.resolve({ configPath: "(server)", dataDir: "(server)" }),
    reset: (path?: string) => api.config.reset(path ? { path } : undefined),
    previewNaming: (config?: Partial<Configuration>) =>
      api.config.previewNaming((config ?? {}) as Parameters<typeof api.config.previewNaming>[0]),
    listProfiles: () => api.config.profiles.list(),
    createProfile: (name: string) => api.config.profiles.create({ name }),
    switchProfile: (name: string) => api.config.profiles.switch({ name }),
    deleteProfile: (name: string) => api.config.profiles.delete({ name }),
    exportProfile: async (name: string) => {
      const result = await api.config.profiles.export({ name });
      triggerDownload(result.fileName, result.content, "application/toml;charset=utf-8");
      return {
        canceled: false,
        filePath: result.fileName,
        profileName: result.profileName,
      };
    },
    importProfile: async (filePath: string, name: string, overwrite = false) => {
      const entry = importFileStash.get(filePath);
      if (!entry) {
        throw new Error("已选择的文件不可用，请重新选择。");
      }
      const content = await entry.file.text();
      const result = await api.config.profiles.import({ name, content, fileName: entry.file.name, overwrite });
      importFileStash.delete(filePath);
      return {
        success: true as const,
        profileName: result.profileName,
        overwritten: result.overwritten,
        active: result.active,
      };
    },
  },
  file: {
    browse: async (kind: "file" | "directory" = "file", filters: BrowseFilter[] = []): Promise<BrowseResult> => {
      if (kind !== "file") {
        return { canceled: true, paths: [] };
      }
      const file = await promptForFile(filters);
      if (!file) {
        return { canceled: true, paths: [] };
      }
      syntheticPathCounter += 1;
      const syntheticPath = `web-import://${Date.now()}-${syntheticPathCounter}/${file.name}`;
      importFileStash.set(syntheticPath, { file, syntheticPath });
      return { canceled: false, paths: [syntheticPath] };
    },
  },
};
