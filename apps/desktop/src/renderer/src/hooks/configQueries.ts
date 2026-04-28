import { queryOptions, type UseQueryOptions, useQuery } from "@tanstack/react-query";
import { getCurrentConfig } from "@/client/api";
import { ipc } from "@/client/ipc";
import type { ConfigOutput } from "@/client/types";

export interface ConfigProfilesOutput {
  profiles: string[];
  active: string;
}

export const CURRENT_CONFIG_QUERY_KEY = ["config", "current"] as const;
export const DEFAULT_CONFIG_QUERY_KEY = ["config", "defaults"] as const;
export const CONFIG_PROFILES_QUERY_KEY = ["config", "profiles"] as const;

export const currentConfigQueryOptions = () =>
  queryOptions({
    queryKey: CURRENT_CONFIG_QUERY_KEY,
    staleTime: 30_000,
    queryFn: async () => {
      const response = await getCurrentConfig({ throwOnError: true });
      return response.data as ConfigOutput;
    },
  });

export const defaultConfigQueryOptions = () =>
  queryOptions({
    queryKey: DEFAULT_CONFIG_QUERY_KEY,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    queryFn: async () => (await ipc.config.getDefaults()) as ConfigOutput,
  });

export const configProfilesQueryOptions = () =>
  queryOptions({
    queryKey: CONFIG_PROFILES_QUERY_KEY,
    staleTime: 30_000,
    queryFn: async () => (await ipc.config.listProfiles()) as ConfigProfilesOutput,
  });

type CurrentConfigQueryOptions = Omit<
  UseQueryOptions<ConfigOutput, Error, ConfigOutput, typeof CURRENT_CONFIG_QUERY_KEY>,
  "queryKey" | "queryFn"
>;

type DefaultConfigQueryOptions = Omit<
  UseQueryOptions<ConfigOutput, Error, ConfigOutput, typeof DEFAULT_CONFIG_QUERY_KEY>,
  "queryKey" | "queryFn"
>;

type ConfigProfilesQueryOptions = Omit<
  UseQueryOptions<ConfigProfilesOutput, Error, ConfigProfilesOutput, typeof CONFIG_PROFILES_QUERY_KEY>,
  "queryKey" | "queryFn"
>;

export const useCurrentConfig = (options?: CurrentConfigQueryOptions) =>
  useQuery({
    ...currentConfigQueryOptions(),
    ...options,
  });

export const useDefaultConfig = (options?: DefaultConfigQueryOptions) =>
  useQuery({
    ...defaultConfigQueryOptions(),
    ...options,
  });

export const useConfigProfiles = (options?: ConfigProfilesQueryOptions) =>
  useQuery({
    ...configProfilesQueryOptions(),
    ...options,
  });
