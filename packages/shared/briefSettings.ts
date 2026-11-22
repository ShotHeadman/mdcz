import { z } from "zod";
import { type Configuration, configurationSchema, getConfigurationPathDefault } from "./config";
import {
  FIELD_REGISTRY,
  FIELD_REGISTRY_BY_KEY,
  type FieldKey,
  getNestedValue,
  setNestedValue,
} from "./settingsRegistry";

/** How a settings plan changes one field. Lists change one entry at a time, so a plan never retypes a list. */
export const SETTINGS_OPERATIONS = ["set", "add", "remove", "move", "replace", "reset"] as const;
export type SettingsOperation = (typeof SETTINGS_OPERATIONS)[number];

export interface BriefSettingsChange {
  key: FieldKey;
  op: SettingsOperation;
  /** The new value, the list entry, or for a secret nothing until the user types it. */
  value?: unknown;
  /** The zero-based position an added or moved entry takes. */
  to?: number;
}

export const briefSettingsChangeSchema = z.object({
  key: z.string(),
  op: z.enum(SETTINGS_OPERATIONS),
  value: z.unknown().optional(),
  to: z.number().int().optional(),
});

/** Every field the Settings page shows. */
export const BRIEF_SETTINGS_KEYS: readonly FieldKey[] = FIELD_REGISTRY.filter(
  (entry) => entry.visibility !== "hidden",
).map((entry) => entry.key);
const SETTINGS_KEY_SET: ReadonlySet<string> = new Set(BRIEF_SETTINGS_KEYS);

export const isBriefSettingsKey = (key: string): key is FieldKey => SETTINGS_KEY_SET.has(key);
export const isSecretField = (key: string): boolean => isBriefSettingsKey(key) && FIELD_REGISTRY_BY_KEY[key].secret;

/** Entries of the two object lists are added whole and removed by this key. */
export const SETTINGS_ENTRY_KEYS: Partial<Record<FieldKey, string>> = {
  "personSync.actorAliases": "name",
  "automation.pathMappings": "from",
};

type ZodDef = { type: string; innerType?: z.ZodType };
const unwrapDefaults = (schema: z.ZodType): z.ZodType => {
  let cursor = schema;
  for (;;) {
    const def = (cursor as unknown as { _zod: { def: ZodDef } })._zod.def;
    if ((def.type === "default" || def.type === "catch" || def.type === "prefault") && def.innerType)
      cursor = def.innerType;
    else return cursor;
  }
};

const fieldSchemas = new Map<string, z.ZodType>();
/** The field's own schema, without its default: a value it rejects is invalid rather than replaced. */
export const settingsFieldSchema = (key: FieldKey): z.ZodType => {
  const cached = fieldSchemas.get(key);
  if (cached) return cached;
  let cursor: z.ZodType = configurationSchema;
  for (const part of key.split(".")) cursor = (unwrapDefaults(cursor) as z.ZodObject).shape[part] as z.ZodType;
  const schema = unwrapDefaults(cursor);
  fieldSchemas.set(key, schema);
  return schema;
};

export interface SettingsFieldShape {
  type?: string;
  enum?: unknown[];
  items?: SettingsFieldShape & { properties?: Record<string, unknown> };
  anyOf?: SettingsFieldShape[];
  minimum?: number;
  maximum?: number;
}

const fieldShapes = new Map<string, SettingsFieldShape>();
/** The field's type as JSON Schema: what the model is told, and what tells a list or a choice apart. */
export const settingsFieldShape = (key: FieldKey): SettingsFieldShape => {
  const cached = fieldShapes.get(key);
  if (cached) return cached;
  const {
    $schema: _schema,
    default: _default,
    ...shape
  } = z.toJSONSchema(settingsFieldSchema(key), {
    io: "input",
    unrepresentable: "any",
  }) as SettingsFieldShape & { $schema?: string; default?: unknown };
  fieldShapes.set(key, shape);
  return shape;
};

export const isListField = (key: FieldKey): boolean => settingsFieldShape(key).type === "array";

/** A free-text value: one the model can write itself from a description, so it is marked when it does. */
export const isTextValueField = (key: FieldKey): boolean => {
  const shape = settingsFieldShape(key);
  const value = shape.type === "array" ? shape.items : shape;
  const variants = value?.anyOf ?? (value ? [value] : []);
  return variants.some(
    (variant) =>
      !variant.enum && (variant.type === "string" || variant.type === "number" || variant.type === "integer"),
  );
};

export type SettingsChangeResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid" | "notInList" | "unchanged" };

const entryKey = (key: FieldKey, entry: unknown): string => {
  const field = SETTINGS_ENTRY_KEYS[key];
  const raw = field && entry && typeof entry === "object" ? (entry as Record<string, unknown>)[field] : entry;
  return typeof raw === "string" ? raw.trim().toLowerCase() : JSON.stringify(raw);
};

/** Models answer "30" for a number now and then; the field's own type decides what the text means. */
const coerce = (key: FieldKey, value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const shape = settingsFieldShape(key);
  const types = (shape.anyOf ?? [shape]).map((variant) => variant.type);
  if ((types.includes("integer") || types.includes("number")) && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  if (types.includes("boolean") && (value === "true" || value === "false")) return value === "true";
  return value;
};

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));
const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** Applies one operation to the field's value, then checks the result against the field's schema. */
export const applySettingsChange = (saved: unknown, change: BriefSettingsChange): SettingsChangeResult => {
  const { key, op } = change;
  const list = isListField(key);
  const entries = Array.isArray(saved) ? [...saved] : [];
  const index = entries.findIndex((entry) => entryKey(key, entry) === entryKey(key, change.value));
  const position = (length: number) => Math.min(Math.max(change.to ?? length, 0), length);
  let next: unknown;
  if (op === "reset") {
    const fallback = getConfigurationPathDefault(key);
    next = fallback.found ? clone(fallback.value) : undefined;
  } else if (op === "set") {
    if (list) return { ok: false, reason: "invalid" };
    next = coerce(key, change.value);
  } else if (!list) {
    return { ok: false, reason: "invalid" };
  } else if (op === "replace") {
    if (!Array.isArray(change.value)) return { ok: false, reason: "invalid" };
    next = change.value;
  } else if (op === "add") {
    // An object entry whose key is already listed replaces that entry, so its aliases or target can change.
    if (index >= 0 && SETTINGS_ENTRY_KEYS[key]) entries[index] = change.value;
    else if (index >= 0) return { ok: false, reason: "unchanged" };
    else entries.splice(position(entries.length), 0, change.value);
    next = entries;
  } else {
    if (index < 0) return { ok: false, reason: "notInList" };
    const [entry] = entries.splice(index, 1);
    if (op === "move") entries.splice(position(entries.length), 0, entry);
    next = entries;
  }
  const parsed = settingsFieldSchema(key).safeParse(next);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return sameValue(parsed.data, saved) ? { ok: false, reason: "unchanged" } : { ok: true, value: parsed.data };
};

/** The changes grouped by field, in the order they first appear; one row per field on the card. */
export const groupSettingsChanges = (
  changes: readonly BriefSettingsChange[],
): Array<{ key: FieldKey; changes: BriefSettingsChange[] }> => {
  const groups = new Map<FieldKey, BriefSettingsChange[]>();
  for (const change of changes) groups.set(change.key, [...(groups.get(change.key) ?? []), change]);
  return [...groups].map(([key, grouped]) => ({ key, changes: grouped }));
};

export type SettingsRowResult =
  | { ok: true; saved: unknown; value: unknown }
  | { ok: false; saved: unknown; reason: "invalid" | "notInList" | "unchanged" | "empty" };

/** A field's new value after each of its changes in turn; a secret or a value left out is empty until typed. */
export const resolveSettingsRow = (
  configuration: Configuration,
  key: FieldKey,
  changes: readonly BriefSettingsChange[],
): SettingsRowResult => {
  const saved = getNestedValue(configuration as unknown as Record<string, unknown>, key);
  let value: unknown = saved;
  for (const change of changes) {
    if (change.op !== "reset" && change.value === undefined) return { ok: false, saved, reason: "empty" };
    const result = applySettingsChange(value, change);
    if (!result.ok) return { ok: false, saved, reason: result.reason };
    value = result.value;
  }
  return { ok: true, saved, value };
};

/**
 * Checks the new values together, without saving, and names the field each problem belongs to. A rule across fields,
 * such as the global timeout having to exceed the per-site one, may fail on a field that did not change; the problem
 * then belongs to the changed fields of that section.
 */
export const validateSettingsValues = (
  configuration: Configuration,
  values: ReadonlyMap<FieldKey, unknown>,
): Map<FieldKey, string> => {
  const merged = clone(configuration) as unknown as Record<string, unknown>;
  for (const [key, value] of values) setNestedValue(merged, key, clone(value));
  const parsed = configurationSchema.safeParse(merged);
  const problems = new Map<FieldKey, string>();
  if (parsed.success) return problems;
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String);
    const owners = [...values.keys()].filter((key) => {
      const parts = key.split(".");
      return parts.every((part, index) => path[index] === part);
    });
    const section = path[0];
    for (const key of owners.length ? owners : [...values.keys()].filter((key) => key.split(".")[0] === section))
      if (!problems.has(key)) problems.set(key, issue.message);
  }
  return problems;
};

/** The changes without the values of secrets, which never reach browser storage or a follow-up. */
export const withoutSecretValues = (changes: readonly BriefSettingsChange[]): BriefSettingsChange[] =>
  changes.map((change) => (isSecretField(change.key) ? { key: change.key, op: change.op } : change));

const SECRET_MASK = "••••••";
/** A secret is taken only as typed in the prompt, so the part of the prompt to mask is known exactly. */
export const maskSecretsInPrompt = (prompt: string, changes: readonly BriefSettingsChange[]): string =>
  changes
    .filter((change) => isSecretField(change.key) && typeof change.value === "string" && change.value)
    .reduce((masked, change) => masked.split(change.value as string).join(SECRET_MASK), prompt);
