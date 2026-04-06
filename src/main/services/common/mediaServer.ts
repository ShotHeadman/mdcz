import { isRecord } from "@main/utils/common";

export const toStringValue = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

export const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

export const toStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, recordValue] of Object.entries(value)) {
    const normalized = toStringValue(recordValue);
    if (normalized) {
      output[key] = normalized;
    }
  }

  return output;
};

export const toBooleanValue = (value: unknown): boolean | undefined => {
  return typeof value === "boolean" ? value : undefined;
};

export const pickAutoResolvedUserId = (
  users: ReadonlyArray<{
    Id?: unknown;
    Policy?: unknown;
  }>,
): string | undefined => {
  let bestId: string | undefined;
  let bestScore = -1;

  for (const user of users) {
    const id = toStringValue(user.Id);
    if (!id) {
      continue;
    }

    const policy = isRecord(user.Policy) ? user.Policy : undefined;
    const isAdministrator = toBooleanValue(policy?.IsAdministrator) ?? false;
    const enableAllFolders = toBooleanValue(policy?.EnableAllFolders) ?? false;
    const score = isAdministrator && enableAllFolders ? 3 : isAdministrator ? 2 : enableAllFolders ? 1 : 0;

    if (score > bestScore) {
      bestScore = score;
      bestId = id;
      if (score === 3) {
        break;
      }
    }
  }

  return bestId;
};
