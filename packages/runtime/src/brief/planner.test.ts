import type { BriefPlan, BriefPlanInput } from "@mdcz/shared/briefCatalog";
import { maskSecretsInPrompt, withoutSecretValues } from "@mdcz/shared/briefSettings";
import { defaultConfiguration } from "@mdcz/shared/config";
import { mediaLibrarySettingsSchema } from "@mdcz/shared/mediaLibrary";
import { describe, expect, it } from "vitest";
import { LlmApiClient } from "../llm";
import { BriefAnswerError, type BriefPlannerContext, planBriefRequest } from "./planner";

const library = (id: string, name: string, sourcePath: string, outputPath: string) => ({
  ...mediaLibrarySettingsSchema.parse({ name, sourcePath, outputPath }),
  id,
});

const context: BriefPlannerContext = {
  libraries: [
    library("lib-main", "Main", "/media/downloads", "/media/library"),
    library("lib-archive", "Archive", "/media/incoming", "/media/archive"),
  ],
  mediaServers: ["jellyfin"],
  configuration: defaultConfiguration,
  profiles: async () => ({ profiles: ["default", "NAS"], active: "default" }),
  facets: async () => ({
    actors: [{ name: "Aoi Sora", count: 3 }],
    studios: [{ name: "S1", count: 2 }],
    tags: [{ name: "Drama", count: 4 }],
  }),
  movieValues: async (_filter, field) => (field === "genres" ? ["Drama", "Comedy"] : []),
};

/** Answers each model call with the next content, so a request routed to settings gets its second answer. */
const answering = (...contents: string[]) => {
  const queue = [...contents];
  return new LlmApiClient({
    postJsonDetailed: async <T>() => ({
      ok: true,
      status: 200,
      statusText: "OK",
      resolvedUrl: "",
      headers: new Headers(),
      data: { output_text: queue.shift() ?? "" } as T,
    }),
  });
};

const scrapeDraft = {
  workflow: "scrape" as const,
  params: { libraryId: "lib-main", directory: "/media/new", recursive: true },
};

describe("Brief planner", () => {
  it.each<{ name: string; input: BriefPlanInput; answers: string[]; plan: BriefPlan | "no plan" }>([
    {
      name: "keeps a valid plan",
      input: { prompt: "Scrape /media/new into Archive" },
      answers: ['{"workflow":"scrape","params":{"libraryId":"lib-archive","directory":"/media/new","recursive":true}}'],
      plan: {
        workflow: "scrape",
        params: { libraryId: "lib-archive", directory: "/media/new", recursive: true },
        workedOut: [],
        dropped: [],
      },
    },
    {
      name: "drops an unknown library id",
      input: { prompt: "Scrape /media/new into Films" },
      answers: ['{"workflow":"scrape","params":{"libraryId":"Films","directory":"/media/new"}}'],
      plan: {
        workflow: "scrape",
        params: { directory: "/media/new" },
        workedOut: [],
        dropped: [{ param: "libraryId", value: "Films", reason: "unknownLibrary" }],
      },
    },
    {
      name: "drops a relative directory and starts from the library's own",
      input: { prompt: "Scrape downloads/new into Main" },
      answers: ['{"workflow":"scrape","params":{"libraryId":"lib-main","directory":"downloads/new"}}'],
      plan: {
        workflow: "scrape",
        params: { libraryId: "lib-main", directory: "/media/downloads" },
        workedOut: [],
        dropped: [{ param: "directory", value: "downloads/new", reason: "relativePath" }],
      },
    },
    {
      name: "keeps and marks a directory the model worked out",
      input: { prompt: "Scrape the new folder under downloads into Main" },
      answers: ['{"workflow":"scrape","params":{"libraryId":"lib-main","directory":"/media/downloads/new"}}'],
      plan: {
        workflow: "scrape",
        params: { libraryId: "lib-main", directory: "/media/downloads/new" },
        workedOut: ["directory"],
        dropped: [],
      },
    },
    {
      name: "fills the fixed workflow whatever the model names",
      input: { prompt: "into Archive", workflow: "scrape" },
      answers: ['{"workflow":"edit","params":{"libraryId":"lib-archive"}}'],
      plan: {
        workflow: "scrape",
        params: { libraryId: "lib-archive", directory: "/media/incoming" },
        workedOut: [],
        dropped: [],
      },
    },
    {
      name: "drops a preset outside the enum",
      input: { prompt: "Refresh everything in Main" },
      answers: ['{"workflow":"maintenance","params":{"presetId":"refresh_everything","libraryId":"lib-main"}}'],
      plan: {
        workflow: "maintenance",
        params: { libraryId: "lib-main", directory: "/media/library" },
        workedOut: [],
        dropped: [{ param: "presetId", value: "refresh_everything", reason: "invalid" }],
      },
    },
    {
      name: "keeps the pending kinds that exist and drops the others",
      input: { prompt: "Retry the not-found ABC files" },
      answers: ['{"workflow":"pending","params":{"action":"retry","kinds":["not_found","lost"],"name":"ABC"}}'],
      plan: {
        workflow: "pending",
        params: { action: "retry", kinds: ["not_found"], name: "ABC" },
        workedOut: [],
        dropped: [{ param: "kinds", value: "lost", reason: "invalid" }],
      },
    },
    {
      name: "drops an actor the library does not have",
      input: { prompt: "For the movies with actor Aoi, set the series to Foo" },
      answers: ['{"workflow":"edit","params":{"actor":"Aoi","field":"series","operation":"set","value":"Foo"}}'],
      plan: {
        workflow: "edit",
        params: { field: "series", operation: "set", value: "Foo" },
        workedOut: [],
        dropped: [{ param: "actor", value: "Aoi", reason: "noMatch" }],
      },
    },
    {
      name: "matches the entry a rename starts from against the movies",
      input: { prompt: "Rename the genre drama to Romance for aoi sora" },
      answers: [
        '{"workflow":"edit","params":{"actor":"aoi sora","field":"genres","operation":"rename","from":"drama","value":"Romance"}}',
      ],
      plan: {
        workflow: "edit",
        params: { actor: "Aoi Sora", field: "genres", operation: "rename", from: "Drama", value: "Romance" },
        workedOut: [],
        dropped: [],
      },
    },
    {
      name: "drops a media server that is not configured",
      input: { prompt: "Sync missing actor photos to Emby" },
      answers: [
        '{"workflow":"person-sync","params":{"action":"sync","server":"emby","kind":"photo","mode":"missing"}}',
      ],
      plan: {
        workflow: "person-sync",
        params: { action: "sync", kind: "photo", mode: "missing" },
        workedOut: [],
        dropped: [{ param: "server", value: "emby", reason: "notConfigured" }],
      },
    },
    {
      name: "matches the profile to switch to",
      input: { prompt: "Switch to the nas profile" },
      answers: ['{"workflow":"profile","params":{"action":"switch","name":"nas"}}'],
      plan: { workflow: "profile", params: { action: "switch", name: "NAS" }, workedOut: [], dropped: [] },
    },
    {
      name: "drops a library change the library's own rules reject",
      input: { prompt: "Group Main's folders as [{actor}/]{number}" },
      answers: [
        '{"workflow":"library","params":{"action":"update","libraryId":"lib-main","folderTemplate":"[{actor}/]{number}"}}',
      ],
      plan: {
        workflow: "library",
        params: { action: "update", libraryId: "lib-main" },
        workedOut: [],
        dropped: [{ param: "folderTemplate", value: "[{actor}/]{number}", reason: "invalid" }],
      },
    },
    {
      name: "matches a library view's filters against the facets",
      input: { prompt: "Show me the drama movies" },
      answers: ['{"workflow":"open","params":{"target":"library","tag":"drama"}}'],
      plan: { workflow: "open", params: { target: "library", tag: "Drama" }, workedOut: [], dropped: [] },
    },
    {
      name: "answers no workflow",
      input: { prompt: "What is the weather?" },
      answers: ['{"workflow":null,"params":{}}'],
      plan: { workflow: null, workedOut: [], dropped: [] },
    },
    {
      name: "reads JSON in a code fence after a think block",
      input: { prompt: "Scrape /media/new into Main" },
      answers: [
        '<think>The user wants a scrape.</think>\n```json\n{"workflow":"scrape","params":{"libraryId":"lib-main","directory":"/media/new"}}\n```',
      ],
      plan: {
        workflow: "scrape",
        params: { libraryId: "lib-main", directory: "/media/new" },
        workedOut: [],
        dropped: [],
      },
    },
    {
      name: "refuses text that is not JSON",
      input: { prompt: "Scrape" },
      answers: ["I cannot help with that."],
      plan: "no plan",
    },
    {
      name: "lays a follow-up in the draft's workflow over the draft",
      input: { prompt: "The other library, and leave the subfolder option out", draft: scrapeDraft },
      answers: ['{"workflow":"scrape","params":{"libraryId":"lib-archive","directory":null},"clear":["recursive"]}'],
      plan: {
        workflow: "scrape",
        params: { libraryId: "lib-archive", directory: "/media/new" },
        changed: ["libraryId", "recursive"],
        workedOut: [],
        dropped: [],
      },
    },
    {
      name: "plans a new cell for a follow-up answered with another workflow",
      input: { prompt: "Now refresh the metadata of Main", draft: scrapeDraft },
      answers: ['{"workflow":"maintenance","params":{"presetId":"refresh_metadata","libraryId":"lib-main"}}'],
      plan: {
        workflow: "maintenance",
        params: { presetId: "refresh_metadata", libraryId: "lib-main", directory: "/media/library" },
        workedOut: [],
        dropped: [],
      },
    },
    {
      name: "asks for the settings changes in a second call and replaces a draft field's changes",
      input: {
        prompt: "Make the timeout 30 instead",
        draft: {
          workflow: "settings",
          params: {
            changes: [
              { key: "network.timeout", op: "set", value: 20 },
              { key: "network.retryCount", op: "set", value: 5 },
            ],
          },
        },
      },
      answers: ['{"workflow":"settings","params":{}}', '{"changes":[{"key":"network.timeout","op":"set","value":30}]}'],
      plan: {
        workflow: "settings",
        params: {
          changes: [
            { key: "network.timeout", op: "set", value: 30 },
            { key: "network.retryCount", op: "set", value: 5 },
          ],
        },
        changed: ["network.timeout"],
        workedOut: [],
        dropped: [],
      },
    },
  ])("$name", async ({ input, answers, plan }) => {
    const planning = planBriefRequest(input, defaultConfiguration.llm, context, answering(...answers));
    if (plan === "no plan") await expect(planning).rejects.toBeInstanceOf(BriefAnswerError);
    else await expect(planning).resolves.toEqual(plan);
  });
});

describe("Brief settings operations", () => {
  it.each<{
    name: string;
    prompt: string;
    changes: unknown[];
    plan: Omit<Extract<BriefPlan, { workflow: "settings" }>, "workflow">;
  }>([
    {
      name: "sets a stated value and marks one the model worked out",
      prompt: "Retry 5 times, and give NFO titles the number in front",
      changes: [
        { key: "network.retryCount", op: "set", value: 5 },
        { key: "naming.nfoTitleTemplate", op: "set", value: "{number} {title}" },
      ],
      plan: {
        params: {
          changes: [
            { key: "network.retryCount", op: "set", value: 5 },
            { key: "naming.nfoTitleTemplate", op: "set", value: "{number} {title}" },
          ],
        },
        workedOut: ["naming.nfoTitleTemplate"],
        dropped: [],
      },
    },
    {
      name: "adds, moves and removes list entries, and drops one the list does not have",
      prompt: "Put javdb first, drop heyzo and fc2ppv, and add avwikidb",
      changes: [
        { key: "scrape.sites", op: "move", value: "javdb", to: 0 },
        { key: "scrape.sites", op: "remove", value: "heyzo" },
        { key: "scrape.sites", op: "remove", value: "fc2ppv" },
        { key: "scrape.sites", op: "add", value: "avwikidb" },
      ],
      plan: {
        params: {
          changes: [
            { key: "scrape.sites", op: "move", value: "javdb", to: 0 },
            { key: "scrape.sites", op: "remove", value: "heyzo" },
            { key: "scrape.sites", op: "add", value: "avwikidb" },
          ],
        },
        workedOut: [],
        dropped: [{ param: "scrape.sites", value: "fc2ppv", reason: "notInList" }],
      },
    },
    {
      name: "keeps a replace and drops a reset that changes nothing",
      prompt: "Only scrape javdb and dmm, and reset the proxy",
      changes: [
        { key: "scrape.sites", op: "replace", value: ["javdb", "dmm"] },
        { key: "network.proxy", op: "reset" },
      ],
      plan: {
        params: { changes: [{ key: "scrape.sites", op: "replace", value: ["javdb", "dmm"] }] },
        workedOut: [],
        dropped: [{ param: "network.proxy", value: "reset", reason: "unchanged" }],
      },
    },
    {
      name: "drops an unknown field, a value out of range and a change a rule across fields refuses",
      prompt: "Set the speed to 9, the timeout to 900, and the per-site timeout to 70 seconds",
      changes: [
        { key: "scrape.speed", op: "set", value: 9 },
        { key: "network.timeout", op: "set", value: 900 },
        { key: "aggregation.perCrawlerTimeoutMs", op: "set", value: 70000 },
      ],
      plan: {
        params: { changes: [] },
        workedOut: [],
        dropped: [
          { param: "scrape.speed", value: "9", reason: "unknownField" },
          { param: "network.timeout", value: "900", reason: "invalid" },
          { param: "aggregation.perCrawlerTimeoutMs", value: "70000", reason: "invalid" },
        ],
      },
    },
    {
      name: "keeps a secret only as typed in the prompt",
      prompt: "Use the DeepL key abc-123, and set the ntfy token",
      changes: [
        { key: "translate.deeplApiKey", op: "set", value: "abc-123" },
        { key: "notifications.ntfyToken", op: "set", value: "tk_invented" },
      ],
      plan: {
        params: {
          changes: [
            { key: "translate.deeplApiKey", op: "set", value: "abc-123" },
            { key: "notifications.ntfyToken", op: "set" },
          ],
        },
        workedOut: [],
        dropped: [],
      },
    },
  ])("$name", async ({ prompt, changes, plan }) => {
    await expect(
      planBriefRequest(
        { prompt, workflow: "settings" },
        defaultConfiguration.llm,
        context,
        answering(JSON.stringify({ changes })),
      ),
    ).resolves.toEqual({ workflow: "settings", ...plan });
  });

  it("keeps secrets out of what the cell stores", () => {
    const changes = [{ key: "translate.deeplApiKey" as const, op: "set" as const, value: "abc-123" }];
    expect(withoutSecretValues(changes)).toEqual([{ key: "translate.deeplApiKey", op: "set" }]);
    expect(maskSecretsInPrompt("Use the DeepL key abc-123", changes)).toBe("Use the DeepL key ••••••");
  });
});
