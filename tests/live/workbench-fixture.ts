import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Website } from "@mdcz/shared/enums";

export type WorkbenchLiveTarget = "web" | "desktop";
export type WorkbenchLiveJourney = "scrape-live" | "refresh-live";

export const WORKBENCH_REFRESH_STALE_TITLE = "Live E2E 旧标题";
export const WORKBENCH_REFRESH_STALE_ACTOR = "Live E2E Actor";
export const WORKBENCH_REFRESH_STALE_GENRE = "Live E2E";

export interface WorkbenchMediaFixturePaths {
  mediaRoot: string;
  fixtureDir: string;
  fixturePath: string;
  outputDir: string;
  fileName: string;
}

export interface WorkbenchRefreshFixturePaths extends WorkbenchMediaFixturePaths {
  nfoPath: string;
  staleTitle: string;
}

export interface WorkbenchMediaFixture extends WorkbenchMediaFixturePaths {
  target: WorkbenchLiveTarget;
  journey: WorkbenchLiveJourney;
  number: string;
  prepare: () => Promise<void>;
  cleanup: () => Promise<void>;
  assertZeroByte: () => Promise<void>;
}

export interface WorkbenchRefreshMediaFixture extends WorkbenchMediaFixture, WorkbenchRefreshFixturePaths {
  journey: "refresh-live";
  staleTitle: string;
  nfoPath: string;
  seedNfoContent: string;
  assertStaleNfo: () => Promise<void>;
}

const ZERO_BYTE = Buffer.alloc(0);

export const resolveWorkbenchMediaRoot = (target: WorkbenchLiveTarget): string => {
  const override = process.env.MDCZ_E2E_WORKBENCH_MEDIA_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }

  if (target === "web") {
    const mediaDir = process.env.MDCZ_E2E_MEDIA_DIR?.trim();
    if (!mediaDir) {
      throw new Error("MDCZ_E2E_MEDIA_DIR is required for web workbench media fixtures");
    }
    return path.resolve(mediaDir);
  }

  const desktopUserDataDir = process.env.MDCZ_E2E_DESKTOP_USER_DATA_DIR?.trim();
  if (!desktopUserDataDir) {
    throw new Error("MDCZ_E2E_DESKTOP_USER_DATA_DIR is required for desktop workbench media fixtures");
  }
  return path.resolve(desktopUserDataDir, "..", "media");
};

export const resolveWorkbenchMediaFixturePaths = (input: {
  target: WorkbenchLiveTarget;
  journey: WorkbenchLiveJourney;
  number: string;
  mediaRoot?: string;
}): WorkbenchMediaFixturePaths => {
  const number = input.number.trim().toUpperCase();
  if (!number) {
    throw new Error("Workbench media fixture number is required");
  }

  const mediaRoot = path.resolve(input.mediaRoot ?? resolveWorkbenchMediaRoot(input.target));
  const fixtureDir = path.join(mediaRoot, "workbench", input.target, input.journey);
  const fileName = `${number}.mp4`;
  const fixturePath = path.join(fixtureDir, fileName);
  const outputDir = path.join(fixtureDir, "JAV_output");

  return {
    mediaRoot,
    fixtureDir,
    fixturePath,
    outputDir,
    fileName,
  };
};

export const resolveWorkbenchRefreshFixturePaths = (input: {
  target: WorkbenchLiveTarget;
  number: string;
  mediaRoot?: string;
}): WorkbenchRefreshFixturePaths => {
  const paths = resolveWorkbenchMediaFixturePaths({
    target: input.target,
    journey: "refresh-live",
    number: input.number,
    mediaRoot: input.mediaRoot,
  });
  const number = input.number.trim().toUpperCase();

  return {
    ...paths,
    nfoPath: path.join(paths.fixtureDir, `${number}.nfo`),
    staleTitle: WORKBENCH_REFRESH_STALE_TITLE,
  };
};

export const assertZeroByteFile = async (filePath: string): Promise<void> => {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Expected a zero-byte file at ${filePath}`);
  }
  if (fileStat.size !== 0) {
    throw new Error(`Expected zero-byte fixture at ${filePath}, got size=${fileStat.size}`);
  }
};

/**
 * Hand-written stale NFO for refresh journeys.
 * Intentionally omits production markers that NfoGenerator always emits
 * (`dateadded`, `<mdcz>`, remote original titles) so post-apply assertions
 * can prove the preview was applied instead of accepting the seed as-is.
 */
export const buildWorkbenchRefreshStaleNfo = (input: { number: string; title?: string; website?: Website }): string => {
  const number = input.number.trim().toUpperCase();
  if (!number) {
    throw new Error("Workbench refresh NFO number is required");
  }
  const title = input.title ?? WORKBENCH_REFRESH_STALE_TITLE;
  const website = input.website ?? Website.DMM;

  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<movie>`,
    `  <title>${title}</title>`,
    `  <originaltitle>${title}</originaltitle>`,
    `  <uniqueid type="${website}" default="true">${number}</uniqueid>`,
    `  <genre>${WORKBENCH_REFRESH_STALE_GENRE}</genre>`,
    `  <actor>`,
    `    <name>${WORKBENCH_REFRESH_STALE_ACTOR}</name>`,
    `  </actor>`,
    `</movie>`,
    ``,
  ].join("\n");
};

export const assertWorkbenchRefreshStaleNfo = async (input: {
  nfoPath: string;
  number: string;
  title?: string;
}): Promise<void> => {
  const content = await readFile(input.nfoPath, "utf8");
  const expectedTitle = input.title ?? WORKBENCH_REFRESH_STALE_TITLE;
  const number = input.number.trim().toUpperCase();

  if (!content.includes(`<title>${expectedTitle}</title>`)) {
    throw new Error(`Expected stale NFO title '${expectedTitle}' in ${input.nfoPath}`);
  }
  if (!content.includes(`<originaltitle>${expectedTitle}</originaltitle>`)) {
    throw new Error(`Expected stale NFO originaltitle '${expectedTitle}' in ${input.nfoPath}`);
  }
  if (!content.includes(number)) {
    throw new Error(`Expected NFO number '${number}' in ${input.nfoPath}`);
  }
  if (content.includes("<dateadded>") || content.includes("<mdcz>")) {
    throw new Error(`Seed NFO must omit production markers (dateadded/mdcz) in ${input.nfoPath}`);
  }
};

export const prepareWorkbenchMediaFixture = async (paths: WorkbenchMediaFixturePaths): Promise<void> => {
  await mkdir(paths.fixtureDir, { recursive: true });
  await mkdir(paths.outputDir, { recursive: true });
  await writeFile(paths.fixturePath, ZERO_BYTE);
  await assertZeroByteFile(paths.fixturePath);
};

export const prepareWorkbenchRefreshMediaFixture = async (paths: WorkbenchRefreshFixturePaths): Promise<string> => {
  await prepareWorkbenchMediaFixture(paths);
  const number = path.basename(paths.fixturePath, path.extname(paths.fixturePath));
  const seedNfoContent = buildWorkbenchRefreshStaleNfo({
    number,
    title: paths.staleTitle,
  });
  await writeFile(paths.nfoPath, seedNfoContent);
  await assertWorkbenchRefreshStaleNfo({
    nfoPath: paths.nfoPath,
    number,
    title: paths.staleTitle,
  });
  return seedNfoContent;
};

export const cleanupWorkbenchMediaFixture = async (paths: WorkbenchMediaFixturePaths): Promise<void> => {
  await rm(paths.fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
};

export const createWorkbenchMediaFixture = (input: {
  target: WorkbenchLiveTarget;
  journey: WorkbenchLiveJourney;
  number: string;
  mediaRoot?: string;
}): WorkbenchMediaFixture => {
  const paths = resolveWorkbenchMediaFixturePaths(input);

  return {
    target: input.target,
    journey: input.journey,
    number: input.number.trim().toUpperCase(),
    ...paths,
    prepare: async () => {
      await prepareWorkbenchMediaFixture(paths);
    },
    cleanup: async () => {
      await cleanupWorkbenchMediaFixture(paths);
    },
    assertZeroByte: async () => {
      await assertZeroByteFile(paths.fixturePath);
    },
  };
};

export const createWorkbenchRefreshMediaFixture = (input: {
  target: WorkbenchLiveTarget;
  number: string;
  mediaRoot?: string;
}): WorkbenchRefreshMediaFixture => {
  const paths = resolveWorkbenchRefreshFixturePaths(input);
  const number = input.number.trim().toUpperCase();
  let seedNfoContent = buildWorkbenchRefreshStaleNfo({
    number,
    title: paths.staleTitle,
  });

  return {
    target: input.target,
    journey: "refresh-live",
    number,
    ...paths,
    get seedNfoContent() {
      return seedNfoContent;
    },
    prepare: async () => {
      seedNfoContent = await prepareWorkbenchRefreshMediaFixture(paths);
    },
    cleanup: async () => {
      await cleanupWorkbenchMediaFixture(paths);
    },
    assertZeroByte: async () => {
      await assertZeroByteFile(paths.fixturePath);
    },
    assertStaleNfo: async () => {
      await assertWorkbenchRefreshStaleNfo({
        nfoPath: paths.nfoPath,
        number,
        title: paths.staleTitle,
      });
    },
  };
};

export const listFilesRecursive = async (rootDir: string): Promise<string[]> => {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

export const findWorkbenchArtifacts = async (
  roots: readonly string[],
  options?: { extensions?: readonly string[] },
): Promise<string[]> => {
  const extensions = (options?.extensions ?? [".nfo", ".jpg", ".jpeg", ".png", ".webp"]).map((value) =>
    value.toLowerCase(),
  );
  const matches: string[] = [];

  for (const root of roots) {
    const files = await listFilesRecursive(root);
    for (const filePath of files) {
      const extension = path.extname(filePath).toLowerCase();
      if (extensions.includes(extension)) {
        matches.push(filePath);
      }
    }
  }

  return matches;
};
