import { createHash } from "node:crypto";
import { cp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safeSegment = (value) => typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/iu.test(value);

const directories = async (root) => {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
};

export const validateCrawlerFiles = async (root) => {
  const cassettes = [];
  for (const website of await directories(root)) {
    if (!safeSegment(website)) throw new Error(`Unsafe crawler Website directory: ${website}`);
    for (const caseId of await directories(path.join(root, website))) {
      if (!safeSegment(caseId)) throw new Error(`Unsafe crawler caseId directory: ${caseId}`);
      const fixtureDir = path.join(root, website, caseId);
      const cassette = JSON.parse(await readFile(path.join(fixtureDir, "cassette.json"), "utf8"));
      if (cassette.schemaVersion !== 1 || cassette.website !== website || cassette.caseId !== caseId) {
        throw new Error(`Crawler cassette identity mismatch at ${website}/${caseId}`);
      }
      if (!Array.isArray(cassette.interactions) || cassette.interactions.length === 0) {
        throw new Error(`Crawler cassette has no interactions at ${website}/${caseId}`);
      }
      for (const [index, interaction] of cassette.interactions.entries()) {
        if (interaction.sequence !== index + 1) throw new Error(`Crawler sequence mismatch at ${website}/${caseId}`);
        if (!interaction.response) continue;
        const responsePath = path.resolve(fixtureDir, interaction.response.bodyPath);
        if (!responsePath.startsWith(`${path.resolve(fixtureDir)}${path.sep}`)) {
          throw new Error(`Crawler response escapes fixture at ${website}/${caseId}`);
        }
        const bytes = await readFile(responsePath);
        if (sha256(bytes) !== interaction.response.sha256) {
          throw new Error(`Crawler response hash mismatch at ${website}/${caseId}/${interaction.response.bodyPath}`);
        }
      }
      cassettes.push({ website, caseId });
    }
  }
  return cassettes;
};

export const validateMediaFiles = async (manifestRoot, blobRoot) => {
  const manifests = [];
  for (const caseId of (await directories(manifestRoot)).filter((entry) => entry !== "blobs")) {
    if (!safeSegment(caseId)) throw new Error(`Unsafe media caseId directory: ${caseId}`);
    const manifest = JSON.parse(await readFile(path.join(manifestRoot, caseId, "manifest.json"), "utf8"));
    if (manifest.schemaVersion !== 1 || manifest.caseId !== caseId) {
      throw new Error(`Media manifest identity mismatch at ${caseId}`);
    }
    if (!Array.isArray(manifest.interactions) || manifest.interactions.length === 0) {
      throw new Error(`Media manifest has no interactions at ${caseId}`);
    }
    for (const [index, interaction] of manifest.interactions.entries()) {
      if (interaction.sequence !== index + 1) throw new Error(`Media sequence mismatch at ${caseId}`);
      const response = interaction.response;
      if (!response) continue;
      if (!/^[a-f0-9]{64}$/u.test(response.sha256)) throw new Error(`Invalid media hash at ${caseId}`);
      const bytes = await readFile(path.join(blobRoot, "blobs", response.sha256));
      if (bytes.byteLength !== response.byteLength || sha256(bytes) !== response.sha256) {
        throw new Error(`Media blob integrity mismatch at ${caseId}/${response.sha256}`);
      }
    }
    manifests.push(manifest);
  }
  return manifests;
};

export const publishDirectories = async (entries, sourceRoot, destinationRoot, key) => {
  for (const entry of entries) {
    const relative = key(entry);
    const source = path.join(sourceRoot, relative);
    const destination = path.join(destinationRoot, relative);
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
  }
};

export const validateRecordingReceipt = async (receiptPath, stagingRoot, mediaStagingRoot, expectedPaths) => {
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (receipt.schemaVersion !== 1 || !Array.isArray(receipt.files) || receipt.files.length === 0) {
    throw new Error(`Invalid recording validation receipt: ${receiptPath}`);
  }
  const actualPaths = receipt.files.map((entry) => entry.path).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify([...expectedPaths].sort())) {
    throw new Error("Recording staging no longer matches its validation receipt");
  }
  for (const entry of receipt.files) {
    if (typeof entry.path !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      throw new Error(`Invalid recording receipt entry: ${JSON.stringify(entry)}`);
    }
    const [kind, ...relativeParts] = entry.path.split("/");
    const root = kind === "crawler" ? stagingRoot : kind === "media" ? mediaStagingRoot : undefined;
    if (!root) throw new Error(`Unknown recording receipt kind: ${kind}`);
    const filePath = path.resolve(root, ...relativeParts);
    if (!filePath.startsWith(`${path.resolve(root)}${path.sep}`))
      throw new Error(`Unsafe recording receipt path: ${entry.path}`);
    if (sha256(await readFile(filePath)) !== entry.sha256) {
      throw new Error(`Recording receipt hash mismatch: ${entry.path}`);
    }
  }
};
