import { ACTOR_IMAGE_SOURCE_OPTIONS, ACTOR_OVERVIEW_SOURCE_OPTIONS } from "@mdcz/shared/actorSource";
import {
  BoolField,
  ChipArrayFieldWrapper,
  CookieFieldWrapper,
  TextField,
  UrlField,
} from "../../config-form/FieldRenderer";
import { useT } from "../../i18n";
import { Subsection } from "../Subsection";

export function MediaServerSection() {
  const t = useT();
  return (
    <>
      <Subsection title="Jellyfin" className="mb-6 last:mb-0">
        <UrlField name="jellyfin.url" />
        <CookieFieldWrapper name="jellyfin.apiKey" />
        <TextField name="jellyfin.userId" />
        <BoolField name="jellyfin.refreshPersonAfterSync" />
        <BoolField name="jellyfin.lockOverviewAfterSync" />
        <BoolField name="jellyfin.notifyAfterPublish" />
      </Subsection>
      <Subsection title="Emby" className="mb-6 last:mb-0">
        <UrlField name="emby.url" />
        <CookieFieldWrapper name="emby.apiKey" />
        <TextField name="emby.userId" />
        <BoolField name="emby.refreshPersonAfterSync" />
        <BoolField name="emby.notifyAfterPublish" />
      </Subsection>
      <Subsection
        title={t.settings.subsections.sharedPersonSources}
        description={t.settings.subsections.sharedPersonSourcesHint}
        className="mb-6 last:mb-0"
      >
        <ChipArrayFieldWrapper name="personSync.personOverviewSources" options={[...ACTOR_OVERVIEW_SOURCE_OPTIONS]} />
        <ChipArrayFieldWrapper name="personSync.personImageSources" options={[...ACTOR_IMAGE_SOURCE_OPTIONS]} />
      </Subsection>
    </>
  );
}
