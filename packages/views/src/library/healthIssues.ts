import type { LibraryHealthIssue } from "@mdcz/shared/serverDtos";
import type { MaintenancePresetId } from "@mdcz/shared/types";

/** The issues a refresh from the sites can repair; duplicate numbers need a person to choose which movie stays. */
export const HEALTH_FIX_PRESETS: Partial<Record<LibraryHealthIssue, MaintenancePresetId>> = {
  missingPoster: "refresh_metadata",
  missingBackdrop: "refresh_metadata",
  missingSynopsis: "refresh_metadata",
  noNfo: "refresh_metadata",
};

export interface LibraryFacetSelection {
  kind: "actor" | "studio" | "tag";
  name: string;
}
