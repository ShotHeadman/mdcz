import type { SystemAboutResponse } from "@mdcz/shared/serverDtos";
import { Button, quietHeroRadiusClass, quietPanelRadiusClass } from "@mdcz/ui";
import { Bug, ExternalLink, Github, Server, Sparkles } from "lucide-react";

export interface AboutViewProps {
  about?: SystemAboutResponse;
  loading?: boolean;
  updateCheck?: boolean | null;
  showDebugAction?: boolean;
  debugActionLabel?: string;
  logoSrc?: string;
  updateCheckDisabled?: boolean;
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
  community: {
    feedback: {
      label: "提交反馈",
      url: "https://github.com/ShotHeadman/mdcz/issues/new/choose",
    },
    links: [
      {
        label: "MDCx",
        url: "https://github.com/sqzw-x/mdcx",
        description: "原 Python 版本项目",
      },
      {
        label: "Movie_Data_Capture",
        url: "https://github.com/yoshiko2/Movie_Data_Capture",
        description: "命令行版核心项目",
      },
    ],
  },
};

const compactValue = (value: string | null | undefined): string => value || "dev";

export const AboutView = ({
  about = fallbackAbout,
  loading = false,
  updateCheck = null,
  showDebugAction = false,
  debugActionLabel = "开启调试",
  logoSrc,
  updateCheckDisabled = false,
  onDebug,
  onOpenExternal,
  onUpdateCheckChange,
}: AboutViewProps) => {
  const homepage = about.homepage ?? about.repository ?? fallbackAbout.homepage;

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
              {logoSrc ? (
                <img alt={about.productName} className={`relative h-20 w-20 ${quietHeroRadiusClass}`} src={logoSrc} />
              ) : (
                <Server className="relative h-9 w-9 text-foreground" />
              )}
            </button>
            <div className="flex flex-col items-center gap-1">
              <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
                {about.productName}
                <span className="mt-1 rounded-full bg-surface-low px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  v{compactValue(about.version)}
                </span>
              </h1>
              <p className="text-xs text-muted-foreground">
                {loading ? "读取运行信息中" : "WebUI / Server 运行信息与支持入口"}
              </p>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground opacity-50">
              <Sparkles className="h-3.5 w-3.5" />
              <span>社区与反馈</span>
            </div>
            <div className={`grid gap-4 ${showDebugAction ? "grid-cols-2" : "grid-cols-1"}`}>
              <Button
                className={`h-14 justify-start gap-3.5 border-border/30 bg-surface-low/30 px-4.5 transition-all hover:border-border/60 hover:bg-surface-low/60 ${quietPanelRadiusClass}`}
                variant="outline"
                onClick={() => onOpenExternal(about.community.feedback.url)}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/5 transition-colors group-hover:bg-primary/10">
                  <Github className="h-4 w-4" />
                </div>
                <span className="text-sm font-semibold">{about.community.feedback.label}</span>
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
                  <span className="text-sm font-semibold">{debugActionLabel}</span>
                </Button>
              )}
            </div>
          </section>

          <section
            className={`flex items-center justify-between border border-border/30 bg-surface-low/30 p-5 transition-all hover:border-border/60 hover:bg-surface-low/60 ${quietPanelRadiusClass}`}
          >
            <div className="space-y-0.5 px-1">
              <h2 className="text-sm font-semibold">自动检查更新</h2>
              <p className="text-xs text-muted-foreground">桌面端保留完整更新偏好；WebUI 显示 server/Web 构建状态。</p>
            </div>
            <input
              aria-label="自动检查更新"
              checked={Boolean(updateCheck)}
              className="h-5 w-5 accent-primary disabled:opacity-50"
              disabled={!onUpdateCheckChange || updateCheck === null || updateCheckDisabled}
              type="checkbox"
              onChange={(event) => onUpdateCheckChange?.(event.currentTarget.checked)}
            />
          </section>

          <section className={`border border-border/30 bg-surface-low/20 p-5 ${quietPanelRadiusClass}`}>
            <div className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground opacity-50">
              运行构建
            </div>
            <dl className="mt-4 grid gap-2 text-xs text-muted-foreground">
              <div className="flex justify-between gap-4">
                <dt>Server</dt>
                <dd className="font-mono">{compactValue(about.build.server)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Web</dt>
                <dd className="font-mono">{compactValue(about.build.web)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Node</dt>
                <dd className="font-mono">{about.build.node}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Platform</dt>
                <dd className="font-mono">{`${about.build.platform}/${about.build.arch}`}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-2">
            <div className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground opacity-50">
              相关项目
            </div>
            <div className="grid gap-2.5">
              {about.community.links.map((link) => (
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
                        {link.label}
                      </div>
                      {link.description && <div className="text-xs text-muted-foreground/60">{link.description}</div>}
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
