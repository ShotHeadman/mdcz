import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SystemAboutResponse } from "@mdcz/shared/serverDtos";

interface PackageJson {
  name?: string;
  homepage?: string;
  repository?: string | { url?: string };
  version?: string;
}

const repositoryUrl = (repository: PackageJson["repository"]): string | null => {
  if (!repository) {
    return null;
  }
  return typeof repository === "string" ? repository : (repository.url ?? null);
};

const normalizeGitUrl = (url: string | null): string | null =>
  url?.replace(/^git\+/u, "").replace(/\.git$/u, "") ?? null;

export class SystemService {
  async about(): Promise<SystemAboutResponse> {
    const packageJson = await this.readPackageJson();
    const repository = normalizeGitUrl(repositoryUrl(packageJson.repository));

    return {
      productName: "MDCz",
      version: packageJson.version ?? null,
      homepage: packageJson.homepage ?? repository,
      repository,
      build: {
        mode: process.env.NODE_ENV ?? "development",
        server: process.env.MDCZ_SERVER_BUILD ?? null,
        web: process.env.MDCZ_WEB_BUILD ?? null,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    };
  }

  private async readPackageJson(): Promise<PackageJson> {
    const candidates = [
      path.resolve(process.cwd(), "package.json"),
      fileURLToPath(new URL("../../../../package.json", import.meta.url)),
      fileURLToPath(new URL("../../../package.json", import.meta.url)),
      fileURLToPath(new URL("../../package.json", import.meta.url)),
    ];
    const packageJsons = await Promise.all(
      candidates
        .filter((candidate, index) => candidates.indexOf(candidate) === index && existsSync(candidate))
        .map(async (candidate) => JSON.parse(await readFile(candidate, "utf8")) as PackageJson),
    );
    return packageJsons.find((packageJson) => packageJson.name === "mdcz") ?? packageJsons[0] ?? {};
  }
}
