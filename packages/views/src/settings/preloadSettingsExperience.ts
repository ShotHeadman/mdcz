import { preloadSettingsEditorBody } from "./SettingsEditor";

let preloadPromise: Promise<void> | null = null;

export function preloadSettingsExperience(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = Promise.resolve(preloadSettingsEditorBody());
  }

  return preloadPromise;
}
