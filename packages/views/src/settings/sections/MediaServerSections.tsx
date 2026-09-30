import { ACTOR_IMAGE_SOURCE_OPTIONS, ACTOR_OVERVIEW_SOURCE_OPTIONS } from "@mdcz/shared/actorSource";
import {
  BoolField,
  ChipArrayFieldWrapper,
  CookieFieldWrapper,
  TextField,
  UrlField,
} from "../../config-form/FieldRenderer";
import { useT } from "../../i18n";
import { useHasRenderableFields } from "../sectionVisibility";

const PERSON_SYNC_SHARED_FIELD_KEYS = ["personSync.personOverviewSources", "personSync.personImageSources"] as const;

export function PersonSyncSharedSection() {
  const t = useT();
  const hasRenderableFields = useHasRenderableFields(PERSON_SYNC_SHARED_FIELD_KEYS);
  if (!hasRenderableFields) return null;

  return (
    <div className="space-y-4 rounded-xl border bg-muted/10 p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-medium">{t.settings.subsections.sharedPersonSources}</h4>
        <p className="text-xs text-muted-foreground">{t.settings.subsections.sharedPersonSourcesHint}</p>
      </div>
      <ChipArrayFieldWrapper name="personSync.personOverviewSources" options={[...ACTOR_OVERVIEW_SOURCE_OPTIONS]} />
      <ChipArrayFieldWrapper name="personSync.personImageSources" options={[...ACTOR_IMAGE_SOURCE_OPTIONS]} />
    </div>
  );
}

export function JellyfinSection() {
  return (
    <>
      <UrlField name="jellyfin.url" />
      <CookieFieldWrapper name="jellyfin.apiKey" />
      <TextField name="jellyfin.userId" />
      <BoolField name="jellyfin.refreshPersonAfterSync" />
      <BoolField name="jellyfin.lockOverviewAfterSync" />
    </>
  );
}

export function EmbySection() {
  return (
    <>
      <UrlField name="emby.url" />
      <CookieFieldWrapper name="emby.apiKey" />
      <TextField name="emby.userId" />
      <BoolField name="emby.refreshPersonAfterSync" />
    </>
  );
}
