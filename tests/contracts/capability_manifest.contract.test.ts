import {
  type ServerCapabilityPath,
  SHARED_CAPABILITIES,
  SHARED_CAPABILITY_BEHAVIOR_FIXTURES,
  SHARED_CAPABILITY_CONTRACTS,
} from "@mdcz/shared/capabilities";
import type { Configuration } from "@mdcz/shared/config";
import type { IpcChannel } from "@mdcz/shared/IpcChannel";
import type { IpcRouterContract } from "@mdcz/shared/ipcContract";
import type { IpcProcedure } from "@mdcz/shared/ipcTypes";
import type { ServerApiContract } from "@mdcz/shared/serverApi";
import type { LibraryListInput, LibraryListResponse } from "@mdcz/shared/serverDtos";
import { describe, expect, expectTypeOf, it } from "vitest";

type DesktopInput<Channel extends keyof IpcRouterContract> = Parameters<
  IpcRouterContract[Channel]["action"]
>[0]["input"];
type DesktopOutput<Channel extends keyof IpcRouterContract> = Awaited<ReturnType<IpcRouterContract[Channel]["action"]>>;
type ServerMethod<Path extends ServerCapabilityPath> = Path extends `${infer Namespace}.${infer Operation}`
  ? Namespace extends keyof ServerApiContract
    ? Operation extends keyof ServerApiContract[Namespace]
      ? ServerApiContract[Namespace][Operation]
      : never
    : never
  : never;
type ServerInput<Path extends ServerCapabilityPath> =
  // biome-ignore lint/suspicious/noConfusingVoidType: IPC no-input contracts use void as their input type.
  ServerMethod<Path> extends (...args: infer Args) => unknown ? (Args extends [] ? void : NonNullable<Args[0]>) : never;
type ServerOutput<Path extends ServerCapabilityPath> =
  ServerMethod<Path> extends (...args: never[]) => Promise<infer Output> ? Output : never;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type CapabilityTypeCheck<Row extends (typeof SHARED_CAPABILITIES)[number]> =
  Equal<DesktopOutput<Row["desktop"]>, ServerOutput<Row["server"]>> extends true
    ? Row["status"] extends "aligned"
      ? Equal<DesktopInput<Row["desktop"]>, ServerInput<Row["server"]>>
      : true
    : false;
type CapabilityTypeChecks = {
  [Index in Exclude<keyof typeof SHARED_CAPABILITIES, keyof (readonly unknown[])>]: CapabilityTypeCheck<
    (typeof SHARED_CAPABILITIES)[Index]
  >;
};

const capabilityTypeChecks: CapabilityTypeChecks = SHARED_CAPABILITIES.map(
  () => true,
) as unknown as CapabilityTypeChecks;

describe("shared capability manifest", () => {
  it("has unique, executable overlap rows with behavior fixtures", () => {
    const ids = SHARED_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const capability of SHARED_CAPABILITIES) {
      expect(SHARED_CAPABILITY_CONTRACTS).toHaveProperty(capability.inputContract);
      expect(SHARED_CAPABILITY_CONTRACTS).toHaveProperty(capability.outputContract);
      const fixture = SHARED_CAPABILITY_BEHAVIOR_FIXTURES[capability.behaviorFixture];
      expect(fixture.desktop).toBe(capability.desktop);
      expect(fixture.server).toBe(capability.server);
    }
    expect(Object.values(capabilityTypeChecks).every(Boolean)).toBe(true);
  });

  it("keeps representative DTOs tied to both platform contracts", () => {
    expectTypeOf<IpcRouterContract[typeof IpcChannel.Config_GetDefaults]>().toEqualTypeOf<
      IpcProcedure<void, Configuration>
    >();
    expectTypeOf<ServerApiContract["config"]["defaults"]>().toEqualTypeOf<() => Promise<Configuration>>();

    expectTypeOf<IpcRouterContract[typeof IpcChannel.Library_List]>().toEqualTypeOf<
      IpcProcedure<LibraryListInput, LibraryListResponse>
    >();
    expectTypeOf<ServerApiContract["library"]["list"]>().toEqualTypeOf<
      (input?: LibraryListInput) => Promise<LibraryListResponse>
    >();
  });
});
