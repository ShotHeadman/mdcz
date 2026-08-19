import { unflattenConfig } from "./settingsRegistry";

export interface ServerValidationPayload {
  fields: string[];
  fieldErrors: Record<string, string>;
}

export const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function extractServerValidation(error: unknown): ServerValidationPayload | null {
  if (!isRecord(error)) return null;
  const details = isRecord(error.details) ? error.details : undefined;
  const rootFields = toStringArray(error.fields);
  const rootFieldErrors = toStringRecord(error.fieldErrors);
  const fields = rootFields.length > 0 ? rootFields : toStringArray(details?.fields);
  const fieldErrors = Object.keys(rootFieldErrors).length > 0 ? rootFieldErrors : toStringRecord(details?.fieldErrors);

  if (fields.length === 0 && Object.keys(fieldErrors).length === 0) {
    return null;
  }

  const mergedFields = new Set<string>(fields);
  for (const key of Object.keys(fieldErrors)) {
    mergedFields.add(key);
  }

  return { fields: [...mergedFields], fieldErrors };
}

function collectServerErrorPaths(errors: unknown, prefix = ""): string[] {
  if (Array.isArray(errors)) {
    return errors.flatMap((entry, index) =>
      collectServerErrorPaths(entry, prefix ? `${prefix}.${index}` : String(index)),
    );
  }

  if (!isRecord(errors)) {
    return [];
  }

  if (errors.type === "server") {
    return prefix ? [prefix] : [];
  }

  const paths: string[] = [];
  for (const [key, value] of Object.entries(errors)) {
    if (key === "root") continue;
    paths.push(...collectServerErrorPaths(value, prefix ? `${prefix}.${key}` : key));
  }
  return paths;
}

export function buildAutoSaveFlatPayload(
  path: string,
  value: unknown,
  errors: unknown,
  getValue: (fieldPath: string) => unknown,
): Record<string, unknown> {
  const relatedPaths = new Set([path, ...collectServerErrorPaths(errors)]);
  const flatPayload: Record<string, unknown> = {};

  for (const relatedPath of relatedPaths) {
    flatPayload[relatedPath] = relatedPath === path ? value : getValue(relatedPath);
  }

  return flatPayload;
}

function cloneConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneConfigValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneConfigValue(entry)]));
  }
  return value;
}

function mergeConfigValue(base: unknown, override: unknown): unknown {
  if (Array.isArray(override)) return cloneConfigValue(override);
  if (isRecord(override)) {
    const next: Record<string, unknown> = isRecord(base)
      ? Object.fromEntries(Object.entries(base).map(([key, value]) => [key, cloneConfigValue(value)]))
      : {};

    for (const [key, value] of Object.entries(override)) {
      next[key] = mergeConfigValue(next[key], value);
    }
    return next;
  }
  return cloneConfigValue(override);
}

export function mergeConfigWithFlatPayload(
  baseConfig: Record<string, unknown>,
  flatPayload: Record<string, unknown>,
): Record<string, unknown> {
  return mergeConfigValue(baseConfig, unflattenConfig(flatPayload)) as Record<string, unknown>;
}

export function formatFieldLabel(label: string | undefined, path: string): string {
  return label ? `“${label}”` : `“${path}”`;
}

export function toFieldMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function nextRevision(revisions: Map<string, number>, path: string): number {
  const revision = (revisions.get(path) ?? 0) + 1;
  revisions.set(path, revision);
  return revision;
}

export function isLatestRevision(revisions: Map<string, number>, path: string, revision: number): boolean {
  return (revisions.get(path) ?? 0) === revision;
}

interface LatestRevisionTaskOptions {
  revisions: Map<string, number>;
  path: string;
  revision: number;
  run: () => Promise<void>;
  finalize: () => void;
}

export async function runLatestRevisionTask({
  revisions,
  path,
  revision,
  run,
  finalize,
}: LatestRevisionTaskOptions): Promise<void> {
  try {
    if (!isLatestRevision(revisions, path, revision)) return;
    await run();
  } finally {
    finalize();
  }
}
