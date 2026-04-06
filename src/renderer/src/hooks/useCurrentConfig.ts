import { type UseQueryOptions, useQuery } from "@tanstack/react-query";
import { getCurrentConfig } from "@/client/api";
import type { ConfigOutput } from "@/client/types";

export const CURRENT_CONFIG_QUERY_KEY = ["config", "current"] as const;

type CurrentConfigQueryOptions = Omit<
  UseQueryOptions<ConfigOutput, Error, ConfigOutput, typeof CURRENT_CONFIG_QUERY_KEY>,
  "queryKey" | "queryFn"
>;

export const useCurrentConfig = (options?: CurrentConfigQueryOptions) =>
  useQuery({
    staleTime: 30_000,
    ...options,
    queryKey: CURRENT_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const response = await getCurrentConfig({ throwOnError: true });
      return response.data as ConfigOutput;
    },
  });
