import { readFile, writeFile } from "node:fs/promises";

const paths = ["package.json", "apps/desktop/package.json"];
const manifests = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
const parts = manifests[0].version.split(".").map(Number);
const index = ["major", "minor", "patch"].indexOf(process.argv[2]);
if (index < 0 || parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
  throw new Error("Expected a stable semver version and major, minor, or patch bump");
}
parts[index] += 1;
for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
const version = parts.join(".");
for (const [i, manifest] of manifests.entries()) {
  manifest.version = version;
  await writeFile(paths[i], `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`v${version}`);
