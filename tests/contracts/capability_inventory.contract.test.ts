import {
  type CapabilityInventoryDesktopExhaustive,
  type CapabilityInventoryServerExhaustive,
  CROSS_HOST_CAPABILITIES,
  DESKTOP_ONLY_CHANNELS,
  type FlattenedServerPath,
  SERVER_ONLY_PROCEDURES,
} from "@mdcz/shared/capabilityInventory";
import { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import type { IpcProcedureInput, IpcProcedureOutput } from "@mdcz/shared/ipcTypes";
import type { ServerApiContract } from "@mdcz/shared/serverApi";
import { describe, expect, it } from "vitest";

type DesktopInput<Channel extends keyof IpcRouterContract> = IpcProcedureInput<IpcRouterContract[Channel]>;
type DesktopOutput<Channel extends keyof IpcRouterContract> = IpcProcedureOutput<IpcRouterContract[Channel]>;
type ServerMethod<Path extends FlattenedServerPath> = Path extends `${infer Namespace}.${infer Rest}`
  ? Rest extends `${infer Operation}.${infer Nested}`
    ? Namespace extends keyof ServerApiContract
      ? Operation extends keyof ServerApiContract[Namespace]
        ? Nested extends keyof ServerApiContract[Namespace][Operation]
          ? ServerApiContract[Namespace][Operation][Nested]
          : never
        : never
      : never
    : Namespace extends keyof ServerApiContract
      ? Rest extends keyof ServerApiContract[Namespace]
        ? ServerApiContract[Namespace][Rest]
        : never
      : never
  : never;
type ServerInput<Path extends FlattenedServerPath> =
  // biome-ignore lint/suspicious/noConfusingVoidType: no-input IPC contracts use void.
  ServerMethod<Path> extends (...args: infer Args) => unknown ? (Args extends [] ? void : NonNullable<Args[0]>) : never;
type ServerOutput<Path extends FlattenedServerPath> =
  ServerMethod<Path> extends (...args: never[]) => Promise<infer Output> ? Output : never;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type CapabilityTypeCheck<Row extends (typeof CROSS_HOST_CAPABILITIES)[number]> = Row["status"] extends "aligned"
  ? Equal<DesktopInput<Row["desktop"]>, ServerInput<Row["server"]>> extends true
    ? Equal<DesktopOutput<Row["desktop"]>, ServerOutput<Row["server"]>>
    : false
  : true;
type FailingAlignedCapabilities = {
  [Index in Exclude<keyof typeof CROSS_HOST_CAPABILITIES, keyof (readonly unknown[])>]: CapabilityTypeCheck<
    (typeof CROSS_HOST_CAPABILITIES)[Index]
  > extends true
    ? never
    : (typeof CROSS_HOST_CAPABILITIES)[Index]["desktop"];
}[Exclude<keyof typeof CROSS_HOST_CAPABILITIES, keyof (readonly unknown[])>];

const _desktopExhaustive: CapabilityInventoryDesktopExhaustive = true;
const _serverExhaustive: CapabilityInventoryServerExhaustive = true;
const _alignedCapabilitiesMatch: Record<FailingAlignedCapabilities, never> = {};

const duplicates = (values: string[]): string[] =>
  values.filter((value, index) => values.indexOf(value) !== index).sort();

describe("dual-host capability inventory", () => {
  it("classifies each host contract exactly once and explains every difference", () => {
    void _desktopExhaustive;
    void _serverExhaustive;
    void _alignedCapabilitiesMatch;

    const desktopChannels = [
      ...CROSS_HOST_CAPABILITIES.map((entry) => entry.desktop),
      ...DESKTOP_ONLY_CHANNELS.map((entry) => entry.channel),
    ];
    const serverPaths = [
      ...CROSS_HOST_CAPABILITIES.map((entry) => entry.server),
      ...SERVER_ONLY_PROCEDURES.map((entry) => entry.path),
    ];

    expect(duplicates(desktopChannels)).toEqual([]);
    expect(new Set(desktopChannels)).toEqual(new Set(Object.values(IpcChannel)));
    expect(duplicates(serverPaths)).toEqual([]);
    expect(CROSS_HOST_CAPABILITIES.every((entry) => entry.status === "aligned" || entry.reason.length > 0)).toBe(true);
    expect([...DESKTOP_ONLY_CHANNELS, ...SERVER_ONLY_PROCEDURES].every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it("records the nine maintenance adapters exactly", () => {
    expect(CROSS_HOST_CAPABILITIES.filter((entry) => entry.desktop.startsWith("maintenance:"))).toEqual([
      {
        desktop: IpcChannel.Maintenance_Execute,
        server: "maintenance.apply",
        status: "adapted",
        reason:
          "Hosts share maintenance orchestration; desktop adapts committed items and an acknowledgement to server task apply.",
      },
      {
        desktop: IpcChannel.Maintenance_GetActiveSession,
        server: "maintenance.getActiveSession",
        status: "aligned",
      },
      {
        desktop: IpcChannel.Maintenance_UpdateDraft,
        server: "maintenance.updateDraft",
        status: "adapted",
        reason: "Desktop resolves the active task in-process; server draft updates carry an explicit task ID.",
      },
      {
        desktop: IpcChannel.Maintenance_DiscardSession,
        server: "maintenance.discardSession",
        status: "adapted",
        reason: "Desktop discards its sole active session; server accepts an optional task identity guard.",
      },
      {
        desktop: IpcChannel.Maintenance_Pause,
        server: "maintenance.pause",
        status: "adapted",
        reason: "Hosts share task pause semantics; desktop resolves the active task because IPC carries no task ID.",
      },
      {
        desktop: IpcChannel.Maintenance_Preview,
        server: "maintenance.preview",
        status: "adapted",
        reason: "Hosts share preview orchestration; desktop starts from local entries while server reads by task ID.",
      },
      {
        desktop: IpcChannel.Maintenance_Resume,
        server: "maintenance.resume",
        status: "adapted",
        reason: "Hosts share task resume semantics; desktop resolves the active task because IPC carries no task ID.",
      },
      {
        desktop: IpcChannel.Maintenance_Scan,
        server: "maintenance.scanSelectedFiles",
        status: "adapted",
        reason:
          "Desktop accepts a directory or selected paths; server requires selected paths plus a registered scan root.",
      },
      {
        desktop: IpcChannel.Maintenance_Stop,
        server: "maintenance.stop",
        status: "adapted",
        reason: "Hosts share task stop semantics; desktop resolves the active task because IPC carries no task ID.",
      },
    ]);
  });
});
