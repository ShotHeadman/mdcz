import { toErrorMessage } from "@mdcz/shared/error";
import type { NormalizedCropRegion } from "@mdcz/shared/posterCrop";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@mdcz/ui";
import { Crop, ImageIcon, LoaderCircle } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { confirmDialog, PosterCropDialog, type PosterCropEditSession } from "../common";
import { getT, useT } from "../i18n";

export interface DetailPosterEditor {
  prepare: () => Promise<PosterCropEditSession | null>;
  save: (crop: NormalizedCropRegion) => Promise<{ posterUrl: string }>;
}

export function DetailPoster({
  src,
  alt,
  onError,
  onSaved,
  editor,
}: {
  src?: string;
  alt: string;
  onError?: () => void;
  onSaved: (posterUrl: string) => void;
  editor?: DetailPosterEditor;
}) {
  const t = useT();
  const [draft, setDraft] = useState<{ session: PosterCropEditSession; crop: NormalizedCropRegion } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const openEditor = async () => {
    if (!editor || loading) return;
    setLoading(true);
    try {
      const session = await editor.prepare();
      if (!mounted.current) return;
      if (session) {
        setDraft({ session, crop: session.initialCrop });
      } else {
        toast.error(getT().detail.noCropSource, { id: "poster-crop" });
      }
    } catch (error) {
      if (mounted.current) toast.error(getT().detail.loadCropFailed(toErrorMessage(error)), { id: "poster-crop" });
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const closeEditor = async (open: boolean) => {
    if (open || saving || !draft) return;
    const dirty = JSON.stringify(draft.crop) !== JSON.stringify(draft.session.initialCrop);
    if (dirty && !(await confirmDialog({ title: getT().scrape.discardPosterChanges, destructive: true }))) return;
    if (mounted.current) setDraft(null);
  };

  const saveCrop = async () => {
    if (!editor || !draft || saving) return;
    setSaving(true);
    try {
      const { posterUrl } = await editor.save(draft.crop);
      if (!mounted.current) return;
      onSaved(posterUrl);
      setDraft(null);
      toast.success(getT().scrape.coverSaved, { id: "poster-crop" });
    } catch (error) {
      if (mounted.current) toast.error(getT().scrape.saveCoverFailed(toErrorMessage(error)), { id: "poster-crop" });
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-[180px] shrink-0">
      {src ? (
        <div className="group relative aspect-2/3 overflow-hidden rounded-quiet-lg border border-black/5 bg-surface-low/70 shadow-[0_18px_48px_rgba(0,0,0,0.08)]">
          <img src={src} alt={alt} className="h-full w-full object-cover" onError={onError} />
          {editor ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="secondary"
                    aria-label={t.detail.editCover}
                    aria-busy={loading}
                    disabled={loading}
                    className="absolute right-2 bottom-2 bg-surface-floating/90 opacity-90 shadow-sm backdrop-blur-sm hover:opacity-100"
                    onClick={openEditor}
                  >
                    {loading ? <LoaderCircle className="animate-spin" /> : <Crop />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{t.detail.editCover}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
      ) : (
        <div className="flex aspect-2/3 w-full items-center justify-center rounded-quiet-lg border border-black/5 bg-surface-low/70">
          <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
        </div>
      )}
      {draft ? (
        <PosterCropDialog
          open
          session={draft.session}
          crop={draft.crop}
          saving={saving}
          onCropChange={(crop) => setDraft((current) => (current ? { ...current, crop } : null))}
          onOpenChange={closeEditor}
          onSave={saveCrop}
        />
      ) : null}
    </div>
  );
}
