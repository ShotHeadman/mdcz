import { spawn } from "node:child_process";
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse, stringify } from "yaml";

const repoRoot = resolve(import.meta.dirname, "..");
const releaseDir = resolve(repoRoot, "release");
const stagingRoot = resolve(releaseDir, "staging");
const templatesDir = resolve(repoRoot, "scripts/templates");

const stagingOnly = process.argv.includes("--staging-only");

const stripLeadingV = (value) => (value.startsWith("v") ? value.slice(1) : value);

const readJson = async (relativePath) => JSON.parse(await readFile(resolve(repoRoot, relativePath), "utf8"));

const requirePath = async (path, description) => {
  try {
    await stat(path);
  } catch {
    throw new Error(`${description} is missing: ${path}`);
  }
};

const run = (command, args) =>
  new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
    });

    child.on("error", rejectProcess);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveProcess();
        return;
      }
      rejectProcess(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });

const rootPackage = await readJson("package.json");
const serverPackage = await readJson("apps/server/package.json");
const lockfile = parse(await readFile(resolve(repoRoot, "pnpm-lock.yaml"), "utf8"));

const releaseVersion =
  process.env.MDCZ_RELEASE_VERSION?.trim() ||
  (process.env.MDCZ_RELEASE_TAG?.trim() ? stripLeadingV(process.env.MDCZ_RELEASE_TAG.trim()) : "") ||
  rootPackage.version;

const stagingDirName = `mdcz-${releaseVersion}`;
const stagingDir = resolve(stagingRoot, stagingDirName);
const artifactPath = resolve(releaseDir, `${stagingDirName}.tar.gz`);
const serverDist = resolve(repoRoot, "apps/server/dist");

await requirePath(resolve(serverDist, "server.js"), "Server bundle");
await requirePath(resolve(serverDist, "web/index.html"), "WebUI bundle");
await requirePath(resolve(serverDist, "persistence/drizzle"), "Drizzle migrations");
await requirePath(resolve(serverDist, "resources/mapping_table"), "Translation mappings");
await requirePath(resolve(templatesDir, "install.sh"), "install.sh template");
await requirePath(resolve(templatesDir, "install.ps1"), "install.ps1 template");
await requirePath(resolve(templatesDir, "start.sh"), "start.sh template");
await requirePath(resolve(templatesDir, "start.bat"), "start.bat template");
await requirePath(resolve(templatesDir, "mdcz.service"), "mdcz.service template");
await requirePath(resolve(templatesDir, "README.md"), "Bundle README template");

await rm(stagingDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });

await cp(resolve(serverDist, "server.js"), resolve(stagingDir, "server.js"));
await cp(resolve(serverDist, "web"), resolve(stagingDir, "web"), { recursive: true });
await cp(resolve(serverDist, "persistence/drizzle"), resolve(stagingDir, "persistence/drizzle"), { recursive: true });
await cp(resolve(serverDist, "resources/mapping_table"), resolve(stagingDir, "resources/mapping_table"), {
  recursive: true,
});
await cp(resolve(repoRoot, "apps/server/.env.example"), resolve(stagingDir, ".env.example"));
await cp(resolve(templatesDir, "README.md"), resolve(stagingDir, "README.md"));
await cp(resolve(templatesDir, "install.sh"), resolve(stagingDir, "install.sh"));
await cp(resolve(templatesDir, "install.ps1"), resolve(stagingDir, "install.ps1"));
await cp(resolve(templatesDir, "start.sh"), resolve(stagingDir, "start.sh"));
await cp(resolve(templatesDir, "start.bat"), resolve(stagingDir, "start.bat"));
await mkdir(resolve(stagingDir, "systemd"), { recursive: true });
await cp(resolve(templatesDir, "mdcz.service"), resolve(stagingDir, "systemd/mdcz.service"));
await chmod(resolve(stagingDir, "install.sh"), 0o755);
await chmod(resolve(stagingDir, "start.sh"), 0o755);

const releasePackage = {
  name: "mdcz",
  version: releaseVersion,
  private: true,
  type: "module",
  packageManager: rootPackage.packageManager,
  scripts: {
    start: "node server.js",
  },
  dependencies: Object.fromEntries(
    Object.entries(serverPackage.dependencies).filter(([, version]) => !version.startsWith("workspace:")),
  ),
  engines: {
    node: ">=24",
  },
  pnpm: {
    onlyBuiltDependencies: ["better-sqlite3", "impit"],
    ignoredBuiltDependencies: ["sharp"],
  },
};

await writeFile(resolve(stagingDir, "package.json"), `${JSON.stringify(releasePackage, null, 2)}\n`);
const lockedDependencies = {};
for (const [name, specifier] of Object.entries(releasePackage.dependencies)) {
  const locked = lockfile.importers["apps/server"].dependencies[name];
  if (!locked || locked.specifier !== specifier) throw new Error(`Runtime dependency is not locked: ${name}`);
  lockedDependencies[name] = locked;
}
lockfile.importers = { ".": { dependencies: lockedDependencies } };
await writeFile(resolve(stagingDir, "pnpm-lock.yaml"), stringify(lockfile));

if (stagingOnly) {
  console.log(`Staged ${stagingDir}`);
} else {
  await rm(artifactPath, { force: true });
  await run("tar", ["-czf", artifactPath, "-C", stagingRoot, stagingDirName]);
  console.log(`Created ${artifactPath}`);
}
