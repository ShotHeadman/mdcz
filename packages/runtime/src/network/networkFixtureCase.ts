import path from "node:path";

export const fixtureCaseIdFromRelativePath = (relativePath: string): string => {
  const base = path.posix.basename(relativePath.replaceAll("\\", "/").trim());
  const stem = base.includes(".") ? base.replace(/\.[^.]+$/u, "") : base;
  const caseId = stem
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replaceAll(/^[._-]+|[._-]+$/gu, "")
    .replaceAll(/-{2,}/gu, "-");
  if (!caseId) throw new Error(`Cannot derive fixture caseId from ${relativePath}`);
  return caseId;
};

export const attachNetworkFixtureCaseId = <T extends { relativePath: string; caseId?: string }>(item: T): T =>
  process.env.MDCZ_NETWORK_FIXTURE_MODE ? { ...item, caseId: fixtureCaseIdFromRelativePath(item.relativePath) } : item;
