import { normalizeActorName } from "@mdcz/shared/actorAliases";
import {
  BRIEF_CATALOG,
  BRIEF_WORKFLOWS,
  type BriefCheckResponse,
  type BriefDrop,
  type BriefPlan,
  type BriefPlanInput,
  type BriefWorkflow,
  briefWorkflowSchema,
  type MediaServerId,
} from "@mdcz/shared/briefCatalog";
import {
  applySettingsChange,
  BRIEF_SETTINGS_KEYS,
  type BriefSettingsChange,
  briefSettingsChangeSchema,
  groupSettingsChanges,
  isBriefSettingsKey,
  isSecretField,
  isTextValueField,
  resolveSettingsRow,
  SETTINGS_OPERATIONS,
  settingsFieldShape,
  validateSettingsValues,
} from "@mdcz/shared/briefSettings";
import { type Configuration, defaultConfiguration, type LlmSettings } from "@mdcz/shared/config";
import type { LibraryEdit } from "@mdcz/shared/libraryEdit";
import { isAbsoluteHostPath, normalizeComparableHostPath } from "@mdcz/shared/mediaCandidate";
import { type MediaLibrarySettings, mediaLibrarySettingsSchema } from "@mdcz/shared/mediaLibrary";
import { PENDING_KINDS, type PendingKindDto } from "@mdcz/shared/pending";
import {
  configProfileNameInputSchema,
  type LibraryListInput,
  type LibrarySummaryResponse,
} from "@mdcz/shared/serverDtos";
import type { FieldKey } from "@mdcz/shared/settingsRegistry";
import { z } from "zod";
import { type LlmApiClient, type LlmJsonSchema, missingLlmSetting, toLlmTextRequest } from "../llm";
import { toErrorMessage } from "../shared";

export type BriefPlannerLibrary = MediaLibrarySettings & { id: string };

/** What code checks the model's values against. The model itself sees only the libraries and the media servers. */
export interface BriefPlannerContext {
  libraries: readonly BriefPlannerLibrary[];
  /** The media servers with an address and an API key. */
  mediaServers: readonly MediaServerId[];
  /** The saved settings that settings operations apply to. */
  configuration: Configuration;
  profiles(): Promise<{ profiles: string[]; active: string }>;
  facets(libraryId: string | undefined): Promise<LibrarySummaryResponse["facets"]>;
  /** Every value `field` holds across the movies the filter lists. */
  movieValues(filter: NonNullable<LibraryListInput>, field: LibraryEdit["field"]): Promise<string[]>;
}

type Values = Record<string, unknown>;
type ParamWorkflow = Exclude<BriefWorkflow, "settings">;

export class BriefAnswerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BriefAnswerError";
  }
}

const LIBRARY_PARAMS = new Set(["libraryId", "targetLibraryId"]);
const PATH_PARAMS = new Set(["directory", "file", "sourceDir", "destDir", "sourcePath", "outputPath"]);
/** Text and numbers with nothing real to check them against: kept, and marked when the model wrote them itself. */
const TEXT_PARAMS: Record<ParamWorkflow, readonly string[]> = {
  scrape: ["directory", "file", "url", "number"],
  maintenance: ["directory"],
  pending: ["name", "number", "url"],
  edit: ["query", "value"],
  "person-sync": [],
  library: ["name", "sourcePath", "outputPath", "folderTemplate", "fileTemplate", "cloudPath", "scanIntervalMinutes"],
  symlink: ["sourceDir", "destDir"],
  check: ["number", "url"],
  profile: ["name"],
  open: ["directory"],
};
const FACET_PARAMS = { actor: "actors", studio: "studios", tag: "tags" } as const;
const SCALAR_EDIT_FIELDS: ReadonlySet<string> = new Set(["studio", "publisher", "director", "series"]);
const LIBRARY_SETTING_KEYS = Object.keys(mediaLibrarySettingsSchema.shape);
const COMPLETE_LEADING_THINK_PATTERN = /^\s*<think>[\s\S]*?<\/think>\s*/iu;

const answerSchema = z.object({
  workflow: z.string().nullable().optional(),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  clear: z.array(z.string()).nullable().optional(),
});

const settingsAnswerSchema = z.object({
  changes: z
    .array(
      z.object({
        key: z.string(),
        op: z.string(),
        value: z.unknown().optional(),
        to: z.number().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  clear: z.array(z.string()).nullable().optional(),
});

const paramShape = (workflow: BriefWorkflow): Record<string, z.ZodType> => BRIEF_CATALOG[workflow].params.shape;

const strictParams = (workflow: BriefWorkflow) =>
  z.strictObject(
    Object.fromEntries(
      Object.entries(paramShape(workflow)).map(([key, schema]) => [
        key,
        (schema as z.ZodOptional<z.ZodType>).unwrap().nullable(),
      ]),
    ),
  );

const outputSchema = (workflow: BriefWorkflow | undefined): LlmJsonSchema => ({
  name: "brief_plan",
  schema: z.toJSONSchema(
    z.strictObject({
      workflow: workflow ? z.literal(workflow) : briefWorkflowSchema.nullable(),
      params: workflow
        ? strictParams(workflow)
        : z.union(BRIEF_WORKFLOWS.map(strictParams) as [ReturnType<typeof strictParams>]),
      clear: z.array(z.string()),
    }),
  ),
});

const aliasEntry = z.strictObject({ name: z.string(), aliases: z.array(z.string()) });
const mappingEntry = z.strictObject({ from: z.string(), to: z.string() });
const settingsOutputSchema: LlmJsonSchema = {
  name: "brief_settings",
  schema: z.toJSONSchema(
    z.strictObject({
      changes: z.array(
        z.strictObject({
          key: z.enum(BRIEF_SETTINGS_KEYS as [FieldKey, ...FieldKey[]]),
          op: z.enum(SETTINGS_OPERATIONS),
          value: z
            .union([
              z.string(),
              z.number(),
              z.boolean(),
              z.array(z.string()),
              aliasEntry,
              mappingEntry,
              z.array(aliasEntry),
              z.array(mappingEntry),
            ])
            .nullable(),
          to: z.number().int().nullable(),
        }),
      ),
      clear: z.array(z.string()),
    }),
  ),
};

const describeWorkflow = (workflow: BriefWorkflow): string => {
  // The schema's own header and closure carry nothing the model needs and cost tokens on every prompt.
  const {
    $schema: _schema,
    additionalProperties: _closed,
    ...parameters
  } = z.toJSONSchema(BRIEF_CATALOG[workflow].params);
  return `- ${workflow}: ${BRIEF_CATALOG[workflow].when}\n  Parameters (JSON Schema): ${JSON.stringify(parameters)}`;
};

export const buildBriefPrompt = (
  input: BriefPlanInput,
  context: Pick<BriefPlannerContext, "libraries" | "mediaServers">,
): string =>
  [
    "You prepare one job in MDCz, an app that scrapes and organizes movie metadata. You never run anything: the user reviews the job on a card and confirms it.",
    'Answer with one JSON object and nothing else, in this shape: {"workflow": "<workflow id>" or null, "params": {<parameters>}, "clear": []}',
    "Rules:",
    "- Pick the one workflow that fits the request. Use null when none does.",
    "- Fill only the parameters the request states, or describes well enough to work out. Leave every other parameter out or null.",
    "- Use library ids exactly as listed. Directories and files are absolute paths. Never invent ids, paths, numbers or URLs.",
    "- The settings workflow takes no parameters here: its changes are asked for separately.",
    input.workflow ? `The workflow is fixed: answer with "workflow": "${input.workflow}".` : "Workflows:",
    ...(input.workflow ? [describeWorkflow(input.workflow)] : BRIEF_WORKFLOWS.map(describeWorkflow)),
    "Libraries:",
    ...(context.libraries.length
      ? context.libraries.map(
          (library) =>
            `- id ${JSON.stringify(library.id)}: name ${JSON.stringify(library.name)}, source directory ${JSON.stringify(library.sourcePath)}, output directory ${JSON.stringify(library.outputPath)}`,
        )
      : ["- none"]),
    `Configured media servers: ${context.mediaServers.join(", ") || "none"}`,
    ...(input.draft
      ? [
          "A draft is open on the user's screen:",
          JSON.stringify(input.draft),
          "If the request changes this draft, answer with the draft's workflow and only the parameters the request changes, and list in \"clear\" the parameters it asks to empty. If the request asks for a different job, answer with that job's workflow and its parameters.",
        ]
      : []),
    "Request:",
    input.prompt,
  ].join("\n");

export const buildSettingsPrompt = (input: BriefPlanInput, draftChanges: readonly BriefSettingsChange[]) =>
  [
    "You prepare a change to the settings of MDCz, an app that scrapes and organizes movie metadata. You never save anything: the user reviews each change on a card and confirms it.",
    'Answer with one JSON object and nothing else, in this shape: {"changes": [{"key": "<field key>", "op": "<operation>", "value": <value or null>, "to": <position or null>}], "clear": []}',
    "Operations:",
    '- set: give a switch, number, choice or text field the value in "value".',
    '- add: put the entry in "value" into a list. "to" is its zero-based position, or null for the end.',
    '- remove: take the entry in "value" out of a list. For a list of objects give only its name or its from path.',
    '- move: move the list entry in "value" to the zero-based position in "to".',
    '- replace: give a list the whole list in "value". Only when the request names the entire list.',
    "- reset: put a field back to its default.",
    "Rules:",
    "- Change only the fields the request calls for. Change a list one entry at a time; never retype a list to change one entry.",
    "- A value the request states is used exactly as written. A value it describes, such as a template, a format or a number, you may work out.",
    '- For a field marked secret (an API key, cookie, token or password) give the value only when the request contains it. Otherwise give "value": null, and the user types it.',
    "- Answer with no changes when no field fits the request.",
    "Fields, one JSON object per line:",
    ...BRIEF_SETTINGS_KEYS.map((key) => {
      const text = input.settingsFields?.[key];
      return JSON.stringify({
        key,
        label: text?.label ?? key,
        ...(text?.description ? { description: text.description } : {}),
        schema: settingsFieldShape(key),
        ...(isSecretField(key) ? { secret: true } : {}),
      });
    }),
    ...(draftChanges.length
      ? [
          "A draft of changes is open on the user's screen:",
          JSON.stringify(draftChanges),
          'Answer with only the changes the request makes to it: a change for a field replaces the draft\'s changes for that field. List in "clear" the field keys whose changes the request takes out of the draft.',
        ]
      : []),
    "Request:",
    input.prompt,
  ].join("\n");

const parseJson = <T extends z.ZodType>(content: string | null, schema: T): z.infer<T> => {
  const json = (content ?? "").replace(COMPLETE_LEADING_THINK_PATTERN, "").match(/\{[\s\S]*\}/u)?.[0];
  if (!json) throw new BriefAnswerError(`The model did not answer with a plan: ${(content ?? "").slice(0, 200)}`);
  try {
    return schema.parse(JSON.parse(json));
  } catch (error) {
    throw new BriefAnswerError(`The model's plan is not valid JSON: ${toErrorMessage(error)}`, { cause: error });
  }
};

export const parseBriefAnswer = (content: string | null): z.infer<typeof answerSchema> =>
  parseJson(content, answerSchema);

const normalizeText = (value: string): string => value.toLowerCase().replace(/\\/gu, "/").replace(/\s+/gu, " ").trim();
const foundInPrompt = (prompt: string, value: string | number): boolean =>
  normalizeText(prompt).includes(normalizeText(String(value)).replace(/\/+$/u, ""));
const display = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** Validates each value on its own, so one bad value drops only itself. */
const readParams = (workflow: BriefWorkflow, raw: Values, dropped: BriefDrop[]): Values => {
  const shape = paramShape(workflow);
  const values: Values = {};
  for (const [key, value] of Object.entries(raw)) {
    const schema = shape[key];
    if (!schema || value === null || value === undefined) continue;
    if (key === "kinds" && Array.isArray(value)) {
      const kinds = value.filter((kind): kind is PendingKindDto => PENDING_KINDS.includes(kind));
      for (const kind of value)
        if (!kinds.includes(kind)) dropped.push({ param: key, value: display(kind), reason: "invalid" });
      if (kinds.length) values[key] = kinds;
      continue;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success && parsed.data !== undefined) values[key] = parsed.data;
    else dropped.push({ param: key, value: display(value), reason: "invalid" });
  }
  return values;
};

const isOwnLibraryDirectory = (libraries: readonly BriefPlannerLibrary[], path: string): boolean =>
  libraries.some((library) =>
    [library.sourcePath, library.outputPath].some(
      (own) => own && normalizeComparableHostPath(own) === normalizeComparableHostPath(path),
    ),
  );

const matchName = (names: readonly string[], value: string, actor: boolean): string | undefined => {
  const key = actor ? normalizeActorName : (name: string) => name.trim().toLowerCase();
  return names.find((name) => key(name) === key(value));
};

/**
 * Checks the values the model returned in `incoming` against what is real, with `base` (the open draft) as the rest of
 * the plan, and sorts the text it kept into values found in the prompt and values the model worked out.
 */
const resolveValues = async (
  workflow: ParamWorkflow,
  incoming: Values,
  base: Values,
  prompt: string,
  context: BriefPlannerContext,
): Promise<{ values: Values; workedOut: string[]; dropped: BriefDrop[] }> => {
  const values = { ...incoming };
  const dropped: BriefDrop[] = [];
  const drop = (param: string, reason: BriefDrop["reason"]) => {
    dropped.push({ param, value: display(values[param]), reason });
    delete values[param];
  };
  const combined = () => ({ ...base, ...values });

  for (const key of Object.keys(values)) {
    if (LIBRARY_PARAMS.has(key) && !context.libraries.some((library) => library.id === values[key]))
      drop(key, "unknownLibrary");
    else if (PATH_PARAMS.has(key) && !isAbsoluteHostPath(String(values[key]))) drop(key, "relativePath");
    else if (key === "url" && !URL.canParse(String(values[key]))) drop(key, "invalid");
    else if (key === "server" && !context.mediaServers.includes(values[key] as MediaServerId))
      drop(key, "notConfigured");
  }

  if (workflow === "edit" || workflow === "open") {
    for (const [param, facet] of Object.entries(FACET_PARAMS)) {
      if (typeof values[param] !== "string") continue;
      const libraryId = combined().libraryId as string | undefined;
      const match = matchName(
        (await context.facets(libraryId))[facet].map((entry) => entry.name),
        values[param],
        param === "actor",
      );
      if (match) values[param] = match;
      else drop(param, "noMatch");
    }
  }

  if (workflow === "edit") {
    const { field, operation } = combined() as { field?: string; operation?: string };
    if (field && operation && SCALAR_EDIT_FIELDS.has(field) !== (operation === "set" || operation === "clear")) {
      if ("operation" in values) drop("operation", "invalid");
      else if ("field" in values) drop("field", "invalid");
    }
    const plan = combined() as Values & { field?: LibraryEdit["field"]; operation?: string };
    if (typeof values.from === "string" && plan.field && (plan.operation === "remove" || plan.operation === "rename")) {
      const filter = Object.fromEntries(
        ["libraryId", "actor", "studio", "tag", "query"].flatMap((key) => (plan[key] ? [[key, plan[key]]] : [])),
      );
      const match = matchName(await context.movieValues(filter, plan.field), values.from, plan.field === "actors");
      if (match) values.from = match;
      else drop("from", "notOnMovies");
    }
  }

  if (workflow === "library") {
    // A change is checked with the rest of the library's settings, which also catches rules across fields.
    const plan = combined();
    const library = context.libraries.find((candidate) => candidate.id === plan.libraryId);
    if (plan.action === "update" && library) {
      const { id: _id, ...saved } = library;
      const merged = Object.fromEntries(
        LIBRARY_SETTING_KEYS.map((key) => [key, plan[key] ?? saved[key as keyof typeof saved]]),
      );
      const parsed = mediaLibrarySettingsSchema.safeParse(merged);
      for (const issue of parsed.success ? [] : parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key in values) drop(key, "invalid");
      }
    }
  }

  if (workflow === "profile" && typeof values.name === "string") {
    const { profiles } = await context.profiles();
    const action = combined().action;
    const match = profiles.find((profile) => profile.toLowerCase() === String(values.name).toLowerCase());
    if (action === "switch") {
      if (match) values.name = match;
      else drop("name", "noMatch");
    } else if (action === "create") {
      if (match) drop("name", "exists");
      else if (!configProfileNameInputSchema.safeParse({ name: values.name }).success) drop("name", "invalid");
    }
  }

  const workedOut = TEXT_PARAMS[workflow].filter((key) => {
    const value = values[key];
    if ((typeof value !== "string" && typeof value !== "number") || foundInPrompt(prompt, value)) return false;
    return !(PATH_PARAMS.has(key) && isOwnLibraryDirectory(context.libraries, String(value)));
  });

  // A library and no directory starts from the library's own directory, as the workbench does.
  const plan = combined();
  if ((workflow === "scrape" || workflow === "maintenance") && !plan.directory && !plan.file && !plan.issue) {
    const library = context.libraries.find((candidate) => candidate.id === plan.libraryId);
    const directory = workflow === "maintenance" ? library?.outputPath || library?.sourcePath : library?.sourcePath;
    if (directory) values.directory = directory;
  }
  return { values, workedOut, dropped };
};

const readSettingsChanges = (params: Values): BriefSettingsChange[] =>
  (Array.isArray(params.changes) ? params.changes : []).flatMap((raw) => {
    const parsed = briefSettingsChangeSchema.safeParse(raw);
    return parsed.success && isBriefSettingsKey(parsed.data.key)
      ? [{ ...parsed.data, key: parsed.data.key } as BriefSettingsChange]
      : [];
  });

const isWorkedOutSetting = (change: BriefSettingsChange, prompt: string): boolean => {
  if (isSecretField(change.key) || !isTextValueField(change.key)) return false;
  if (change.op !== "set" && change.op !== "add" && change.op !== "replace") return false;
  const values = Array.isArray(change.value) ? change.value : [change.value];
  return values.some(
    (value) => (typeof value === "string" || typeof value === "number") && !foundInPrompt(prompt, value),
  );
};

/**
 * Lays the model's operations over the draft's, field by field, and checks each one against the saved value. A secret
 * is kept only when the prompt contains it exactly: a key the model did not read is one it invented.
 */
const resolveSettings = (
  answer: z.infer<typeof settingsAnswerSchema>,
  base: readonly BriefSettingsChange[],
  prompt: string,
  configuration: Configuration,
): { changes: BriefSettingsChange[]; changed: string[]; workedOut: string[]; dropped: BriefDrop[] } => {
  const dropped: BriefDrop[] = [];
  const incoming: BriefSettingsChange[] = [];
  for (const raw of answer.changes ?? []) {
    const secret = isSecretField(raw.key);
    const shown = secret ? "••••••" : display(raw.value);
    const op = SETTINGS_OPERATIONS.find((operation) => operation === raw.op);
    if (!isBriefSettingsKey(raw.key)) dropped.push({ param: raw.key, value: shown, reason: "unknownField" });
    else if (!op) dropped.push({ param: raw.key, value: raw.op, reason: "invalid" });
    else {
      const stated = raw.value ?? undefined;
      const value = secret && !(typeof stated === "string" && stated && prompt.includes(stated)) ? undefined : stated;
      incoming.push({
        key: raw.key,
        op,
        ...(value === undefined ? {} : { value }),
        ...(raw.to == null ? {} : { to: raw.to }),
      });
    }
  }

  const kept: BriefSettingsChange[] = [];
  for (const { key, changes } of groupSettingsChanges(incoming)) {
    let value = resolveSettingsRow(configuration, key, []).saved;
    for (const change of changes) {
      if (change.op !== "reset" && change.value === undefined) {
        kept.push(change);
        continue;
      }
      const result = applySettingsChange(value, change);
      if (result.ok) {
        value = result.value;
        kept.push(change);
      } else
        dropped.push({
          param: key,
          value: isSecretField(key) ? "••••••" : display(change.value ?? change.op),
          reason: result.reason,
        });
    }
  }

  // The answer's operations for a field replace the draft's for it, in the draft's place; new fields go last.
  const answered = new Set(kept.map((change) => change.key));
  const cleared = new Set(answer.clear ?? []);
  const baseKeys = new Set(base.map((change) => change.key));
  const merged = [
    ...groupSettingsChanges(base).flatMap(({ key, changes }) =>
      answered.has(key) ? kept.filter((change) => change.key === key) : cleared.has(key) ? [] : changes,
    ),
    ...kept.filter((change) => !baseKeys.has(change.key)),
  ];

  const values = new Map(
    groupSettingsChanges(merged).flatMap(({ key, changes }) => {
      const row = resolveSettingsRow(configuration, key, changes);
      return row.ok ? [[key, row.value] as const] : [];
    }),
  );
  const problems = validateSettingsValues(configuration, values);
  for (const key of answered)
    if (problems.has(key))
      dropped.push({ param: key, value: isSecretField(key) ? "••••••" : display(values.get(key)), reason: "invalid" });
  const changes = merged.filter((change) => !(answered.has(change.key) && problems.has(change.key)));

  const forKey = (list: readonly BriefSettingsChange[], key: FieldKey) =>
    JSON.stringify(list.filter((change) => change.key === key));
  return {
    changes,
    changed: [...new Set([...baseKeys, ...changes.map((change) => change.key)])].filter(
      (key) => forKey(base, key) !== forKey(changes, key),
    ),
    workedOut: [
      ...new Set(
        changes
          .filter((change) => answered.has(change.key) && isWorkedOutSetting(change, prompt))
          .map((change) => change.key),
      ),
    ],
    dropped,
  };
};

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export const planBriefRequest = async (
  input: BriefPlanInput,
  settings: LlmSettings,
  context: BriefPlannerContext,
  client: Pick<LlmApiClient, "generateText">,
  signal?: AbortSignal,
): Promise<BriefPlan> => {
  const ask = async <T extends z.ZodType>(prompt: string, schema: LlmJsonSchema, parse: T) =>
    parseJson(
      await client.generateText(
        toLlmTextRequest(settings, prompt, settings.outputFormat === "json_schema" ? schema : undefined),
        signal,
      ),
      parse,
    );
  const draft = input.draft;
  // A request fixed to settings needs no routing: the call with the field list is the only one.
  const answer =
    input.workflow === "settings"
      ? null
      : await ask(buildBriefPrompt(input, context), outputSchema(input.workflow), answerSchema);
  const answered = briefWorkflowSchema.safeParse(answer?.workflow);
  const workflow = input.workflow ?? (answered.success ? answered.data : null);
  const onDraft = draft && (workflow === draft.workflow || workflow === null) ? draft : undefined;
  const dropped: BriefDrop[] = [];

  if (workflow === "settings" || onDraft?.workflow === "settings") {
    const base = onDraft ? readSettingsChanges(onDraft.params) : [];
    const resolved = workflow
      ? resolveSettings(
          await ask(buildSettingsPrompt(input, base), settingsOutputSchema, settingsAnswerSchema),
          base,
          input.prompt,
          context.configuration,
        )
      : { changes: base, changed: [], workedOut: [], dropped: [] };
    return {
      workflow: "settings",
      params: { changes: resolved.changes },
      ...(onDraft ? { changed: resolved.changed } : {}),
      workedOut: resolved.workedOut,
      dropped: resolved.dropped,
    };
  }

  if (onDraft) {
    const draftWorkflow = onDraft.workflow as ParamWorkflow;
    const base = readParams(draftWorkflow, onDraft.params, []);
    const cleared = workflow ? (answer?.clear ?? []).filter((key) => key in paramShape(draftWorkflow)) : [];
    const incoming = workflow ? readParams(draftWorkflow, answer?.params ?? {}, dropped) : {};
    const resolved = await resolveValues(draftWorkflow, incoming, base, input.prompt, context);
    const params = { ...base, ...resolved.values };
    for (const key of cleared) if (!(key in resolved.values)) delete params[key];
    return {
      workflow: draftWorkflow,
      params,
      changed: Object.keys(paramShape(draftWorkflow)).filter((key) => !sameValue(base[key], params[key])),
      workedOut: resolved.workedOut,
      dropped: [...dropped, ...resolved.dropped],
    } as BriefPlan;
  }

  if (!workflow) return { workflow: null, workedOut: [], dropped: [] };
  const resolved = await resolveValues(
    workflow,
    readParams(workflow, answer?.params ?? {}, dropped),
    {},
    input.prompt,
    context,
  );
  return {
    workflow,
    params: resolved.values,
    workedOut: resolved.workedOut,
    dropped: [...dropped, ...resolved.dropped],
  } as BriefPlan;
};

const CHECK_REQUEST = "Scrape the new videos in /media/new-videos into the Archive library";
const checkLibrary = (id: string, name: string, sourcePath: string, outputPath: string): BriefPlannerLibrary => ({
  ...mediaLibrarySettingsSchema.parse({ name, sourcePath, outputPath }),
  id,
});
const CHECK_CONTEXT: BriefPlannerContext = {
  libraries: [
    checkLibrary("lib-main", "Main", "/media/downloads", "/media/library"),
    checkLibrary("lib-archive", "Archive", "/media/incoming", "/media/archive"),
  ],
  mediaServers: [],
  configuration: defaultConfiguration,
  profiles: async () => ({ profiles: ["default"], active: "default" }),
  facets: async () => ({ actors: [], studios: [], tags: [] }),
  movieValues: async () => [],
};

/**
 * Plans a fixed request against a fixed context with a known answer, using the settings as edited. A model that
 * answers but cannot plan (no JSON, the wrong workflow, an id it made up) is turned away here once.
 */
export const checkBriefPlanner = async (
  settings: LlmSettings,
  client: Pick<LlmApiClient, "generateText">,
  signal?: AbortSignal,
): Promise<BriefCheckResponse> => {
  const missing = missingLlmSetting(settings);
  if (missing) return { status: missing };
  try {
    const plan = await planBriefRequest({ prompt: CHECK_REQUEST }, settings, CHECK_CONTEXT, client, signal);
    const passed =
      plan.workflow === "scrape" &&
      plan.params.libraryId === "lib-archive" &&
      normalizeComparableHostPath(plan.params.directory ?? "") === "/media/new-videos" &&
      plan.dropped.length === 0;
    return passed ? { status: "ok" } : { status: "wrong_plan" };
  } catch (error) {
    return { status: "failed", error: toErrorMessage(error) };
  }
};
