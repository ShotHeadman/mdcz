import { getT } from "@mdcz/views/i18n";

interface BrowseFilter {
  name: string;
  extensions: string[];
}

interface ImportFileEntry {
  file: File;
  syntheticPath: string;
}

const importFileStash = new Map<string, ImportFileEntry>();
let syntheticPathCounter = 0;

const buildAcceptString = (filters: BrowseFilter[]): string =>
  filters.flatMap((filter) => filter.extensions.map((extension) => `.${extension.replace(/^\./u, "")}`)).join(",");

export const promptForImportFile = (filters: BrowseFilter[]): Promise<{ label: string; path: string } | null> =>
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
      if (!file) {
        resolve(null);
        return;
      }
      syntheticPathCounter += 1;
      const syntheticPath = `web-import://${Date.now()}-${syntheticPathCounter}/${file.name}`;
      importFileStash.set(syntheticPath, { file, syntheticPath });
      resolve({ label: file.name, path: syntheticPath });
    };
    const onChange = () => {
      resolveOnce(input.files?.[0] ?? null);
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

export async function readImportedFile(path: string): Promise<{ content: string; fileName: string }> {
  const entry = importFileStash.get(path);
  if (!entry) {
    throw new Error(getT().web.fileUnavailable);
  }
  return { content: await entry.file.text(), fileName: entry.file.name };
}

export function clearImportedFile(path: string): void {
  importFileStash.delete(path);
}

export function triggerDownload(fileName: string, content: string, mimeType: string): void {
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
}
