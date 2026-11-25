import { appPreviewPosterBadgesInputSchema } from "@mdcz/shared/serverDtos";
import { Label, Switch } from "@mdcz/ui";
import { useId, useState } from "react";
import { useWatch } from "react-hook-form";
import { useLoad } from "../common/useLoad";
import { useT } from "../i18n";
import { useSettingsServices } from "./SettingsServices";

const PREVIEW_DEBOUNCE_MS = 300;
const PREVIEW_FIELDS = [
  "download.tagBadgeTypes",
  "download.tagBadgePosition",
  "download.tagBadgeSizePercent",
  "download.tagBadgeOpacity",
  "download.tagBadgeInsetPercent",
  "download.tagBadgeImageOverrides",
] as const;

export function PosterBadgePreview() {
  const t = useT();
  const services = useSettingsServices();
  const [types, position, sizePercent, opacity, insetPercent, imageOverrides] = useWatch({ name: PREVIEW_FIELDS });
  const [roundedCorners, setRoundedCorners] = useState(true);
  const roundedCornersId = useId();
  const { data: request } = appPreviewPosterBadgesInputSchema.safeParse({
    tagBadgeTypes: types,
    tagBadgePosition: position,
    tagBadgeSizePercent: sizePercent,
    tagBadgeOpacity: opacity,
    tagBadgeInsetPercent: insetPercent,
    tagBadgeImageOverrides: imageOverrides,
  });
  // Mid-edit values (an emptied number input, 5 in a 25-300 range) stay on the last good preview.
  const preview = useLoad(
    async () => request && (await services.previewPosterBadges(request)),
    request ? JSON.stringify(request) : null,
    PREVIEW_DEBOUNCE_MS,
  );
  const imageDataUrl = preview.latest;
  const error = preview.error;

  return (
    <div className="flex flex-col gap-3 self-start py-3 lg:sticky lg:top-20">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t.settings.badgePreview.title}</span>
        <div className="flex items-center gap-2">
          <Label htmlFor={roundedCornersId} className="text-xs text-muted-foreground">
            {t.settings.badgePreview.roundedCorners}
          </Label>
          <Switch id={roundedCornersId} checked={roundedCorners} onCheckedChange={setRoundedCorners} />
        </div>
      </div>
      {error ? (
        <p className="text-xs text-destructive">{t.settings.badgePreview.failed(error)}</p>
      ) : imageDataUrl ? (
        <img
          src={imageDataUrl}
          alt={t.settings.badgePreview.title}
          className={`w-full max-w-56 border border-border/50 ${roundedCorners ? "rounded-xl" : ""}`}
        />
      ) : null}
    </div>
  );
}
