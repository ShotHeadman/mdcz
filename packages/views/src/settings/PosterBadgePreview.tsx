import { toErrorMessage } from "@mdcz/shared/error";
import { appPreviewPosterBadgesInputSchema } from "@mdcz/shared/serverDtos";
import { Label, Switch } from "@mdcz/ui";
import { useEffect, useId, useState } from "react";
import { useWatch } from "react-hook-form";
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
  const [imageDataUrl, setImageDataUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [roundedCorners, setRoundedCorners] = useState(true);
  const roundedCornersId = useId();

  useEffect(() => {
    // Mid-edit values (an emptied number input, 5 in a 25-300 range) stay on the last good preview.
    const input = appPreviewPosterBadgesInputSchema.safeParse({
      tagBadgeTypes: types,
      tagBadgePosition: position,
      tagBadgeSizePercent: sizePercent,
      tagBadgeOpacity: opacity,
      tagBadgeInsetPercent: insetPercent,
      tagBadgeImageOverrides: imageOverrides,
    });
    if (!input.success) {
      return;
    }

    let stale = false;
    const timer = setTimeout(() => {
      services.previewPosterBadges(input.data).then(
        (dataUrl) => {
          if (!stale) {
            setImageDataUrl(dataUrl);
            setError(undefined);
          }
        },
        (reason) => {
          if (!stale) {
            setError(toErrorMessage(reason));
          }
        },
      );
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [services, types, position, sizePercent, opacity, insetPercent, imageOverrides]);

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
