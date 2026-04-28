import {
  configProfilesQueryOptions,
  currentConfigQueryOptions,
  defaultConfigQueryOptions,
} from "@/hooks/configQueries";
import { queryClient } from "@/lib/queryClient";
import { preloadSettingsEditorBody } from "./SettingsEditor";

let preloadPromise: Promise<void> | null = null;

export function preloadSettingsExperience(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = Promise.all([
      queryClient.prefetchQuery(currentConfigQueryOptions()),
      queryClient.prefetchQuery(configProfilesQueryOptions()),
      queryClient.prefetchQuery(defaultConfigQueryOptions()),
      Promise.resolve(preloadSettingsEditorBody()),
    ]).then(() => {});
  }

  return preloadPromise;
}
