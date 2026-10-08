import { readFile, writeFile } from "node:fs/promises";

const paths = ["package.json", "apps/desktop/package.json"];
const manifests = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
const parseStable = (value) => {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Expected a stable semver version, got "${value}"`);
  return value.split(".").map(Number);
};

const current = parseStable(manifests[0].version);
const declared = process.argv[2];
const next = parseStable(declared);
const firstDifference = next.findIndex((part, i) => part !== current[i]);
if (firstDifference < 0 || next[firstDifference] < current[firstDifference]) {
  throw new Error(`Declared version ${declared} must be greater than ${manifests[0].version}`);
}

for (const [i, manifest] of manifests.entries()) {
  manifest.version = declared;
  await writeFile(paths[i], `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(`v${declared}`);
