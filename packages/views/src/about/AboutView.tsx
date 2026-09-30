import type { SystemAboutResponse } from "@mdcz/shared/serverDtos";
import { Badge, Button, quietHeroRadiusClass, quietPanelRadiusClass, Switch } from "@mdcz/ui";
import { Bug, ExternalLink, Github, Server, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import AppLogo from "../assets/logo.png";
import { useT } from "../i18n";

export interface AboutViewProps {
  about?: SystemAboutResponse;
  loading?: boolean;
  updateCheck?: boolean | null;
  showUpdateCheck?: boolean;
  showDebugAction?: boolean;
  debugActionLabel?: string;
  logoSrc?: string;
  updateCheckDisabled?: boolean;
  updateStatus?: ReactNode;
  onDebug?: () => void;
  onOpenExternal: (url: string) => void;
  onUpdateCheckChange?: (checked: boolean) => void;
}

const fallbackAbout: SystemAboutResponse = {
  productName: "MDCz",
  version: null,
  homepage: "https://github.com/ShotHeadman/mdcz",
  repository: "https://github.com/ShotHeadman/mdcz",
  build: {
    mode: "development",
    server: null,
    web: null,
    node: "unknown",
    platform: "unknown",
    arch: "unknown",
  },
};

const FEEDBACK_URL = "https://github.com/ShotHeadman/mdcz/issues/new/choose";
const RELATED_PROJECTS = [
  { id: "mdcx", name: "MDCx", url: "https://github.com/sqzw-x/mdcx" },
  { id: "movieDataCapture", name: "Movie_Data_Capture", url: "https://github.com/yoshiko2/Movie_Data_Capture" },
] as const;

const compactValue = (value: string | null | undefined): string => value || "dev";

export const AboutView = ({
  about = fallbackAbout,
  loading = false,
  updateCheck = null,
  showUpdateCheck = true,
  showDebugAction = false,
  debugActionLabel,
  logoSrc,
  updateCheckDisabled = false,
  updateStatus,
  onDebug,
  onOpenExternal,
  onUpdateCheckChange,
}: AboutViewProps) => {
  const t = useT();
  const resolvedDebugActionLabel = debugActionLabel ?? t.about.debugAction;
  const homepage = about.homepage ?? about.repository ?? fallbackAbout.homepage;
  const resolvedLogoSrc = logoSrc ?? AppLogo;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-background/30 text-foreground selection:bg-primary/10">
      <div className="mx-auto flex w-full max-w-xl flex-col px-6 py-6 md:px-8">
        <div className="flex flex-col gap-7">
          <section className="flex flex-col items-center gap-3 text-center">
            <button
              className={`group relative flex h-20 w-20 items-center justify-center bg-surface-low shadow-xl shadow-primary/5 transition-all active:scale-[0.98] ${quietHeroRadiusClass}`}
              type="button"
              onClick={() => homepage && onOpenExternal(homepage)}
            >
              <div className="absolute inset-0 scale-125 rounded-full bg-primary/5 blur-2xl transition-colors group-hover:bg-primary/10" />
              {resolvedLogoSrc ? (
                <img
                  alt={about.productName}
                  className={`relative h-20 w-20 ${quietHeroRadiusClass}`}
                  src={resolvedLogoSrc}
                />
              ) : (
                <Server className="relative h-9 w-9 text-foreground" />
              )}
            </button>
            <div className="flex flex-col items-center gap-1">
              <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
                {about.productName}
                <Badge variant="secondary" className="mt-1 opacity-80">
                  v{compactValue(about.version)}
                </Badge>
              </h1>
              <p className="text-xs text-muted-foreground">{loading ? t.about.loading : ""}</p>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground opacity-50">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{t.about.communityAndFeedback}</span>
            </div>
            <div className={`grid gap-4 ${showDebugAction ? "grid-cols-2" : "grid-cols-1"}`}>
              <Button
                className={`h-14 justify-start gap-3.5 border-border/30 bg-surface-low/30 px-4.5 transition-all hover:border-border/60 hover:bg-surface-low/60 ${quietPanelRadiusClass}`}
                variant="outline"
                onClick={() => onOpenExternal(FEEDBACK_URL)}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/5 transition-colors group-hover:bg-primary/10">
                  <Github className="h-4 w-4" />
                </div>
                <span className="text-sm font-semibold">{t.about.feedback}</span>
                <ExternalLink className="ml-auto h-3 w-3 opacity-60" />
              </Button>
              {showDebugAction && (
                <Button
                  className={`h-14 justify-start gap-3.5 border-border/30 bg-surface-low/30 px-4.5 transition-all hover:border-border/60 hover:bg-surface-low/60 ${quietPanelRadiusClass}`}
                  variant="outline"
                  onClick={onDebug}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/5">
                    <Bug className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-semibold">{resolvedDebugActionLabel}</span>
                </Button>
              )}
            </div>
          </section>

          {showUpdateCheck && (
            <section
              className={`flex flex-col gap-4 border border-border/30 bg-surface-low/30 p-5 transition-all hover:border-border/60 hover:bg-surface-low/60 ${quietPanelRadiusClass}`}
            >
              <div className="flex items-center justify-between">
                <h2 className="px-1 text-sm font-semibold">{t.about.autoCheckUpdates}</h2>
                <Switch
                  aria-label={t.about.autoCheckUpdates}
                  checked={Boolean(updateCheck)}
                  disabled={!onUpdateCheckChange || updateCheck === null || updateCheckDisabled}
                  onCheckedChange={(checked) => onUpdateCheckChange?.(checked)}
                />
              </div>
              {updateStatus}
            </section>
          )}

          <section className="space-y-2">
            <div className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground opacity-50">
              {t.about.relatedProjectsTitle}
            </div>
            <div className="grid gap-2.5">
              {RELATED_PROJECTS.map((link) => (
                <button
                  className={`group flex w-full items-center justify-between border border-transparent bg-surface-low/20 p-4 text-left transition-all hover:border-border/40 hover:bg-surface-low/50 ${quietPanelRadiusClass}`}
                  key={link.url}
                  type="button"
                  onClick={() => onOpenExternal(link.url)}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/10 bg-white/40 text-muted-foreground/60 transition-colors group-hover:text-primary dark:bg-black/10">
                      <Github className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold transition-colors group-hover:text-primary">
                        {link.name}
                      </div>
                      <div className="text-xs text-muted-foreground/60">{t.about.relatedProjects[link.id]}</div>
                    </div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40" />
                </button>
              ))}
            </div>
          </section>

          <footer className="pb-1 pt-2 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/30">
              Crafted by ShotHeadman
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
};
