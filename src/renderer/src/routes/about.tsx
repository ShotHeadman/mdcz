import { toErrorMessage } from "@shared/error";
import type { AppInfo } from "@shared/ipcTypes";
import { createFileRoute } from "@tanstack/react-router";
import { Bug, ExternalLink, Github, Sparkles } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { toast } from "sonner";
import AppLogo from "@/assets/images/logo.png";
import { updateConfig } from "@/client/api";
import { ipc } from "@/client/ipc";
import type { ConfigOutput } from "@/client/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { quietHeroRadiusClass, quietPanelRadiusClass } from "@/components/ui/quietCraft";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/about")({
  component: About,
});

const PROJECT_LINKS = [
  {
    name: "MDCx",
    url: "https://github.com/sqzw-x/mdcx",
    description: "原 Python 版本项目",
  },
  {
    name: "Movie_Data_Capture",
    url: "https://github.com/yoshiko2/Movie_Data_Capture",
    description: "命令行版核心项目",
  },
];

const openUrl = (url: string) => {
  ipc.app.openExternal(url);
};

const NO_DRAG_STYLE = {
  WebkitAppRegion: "no-drag",
} as CSSProperties;

function About() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [updateCheck, setUpdateCheck] = useState<boolean | null>(null);
  const [isSavingUpdateCheck, setIsSavingUpdateCheck] = useState(false);

  useEffect(() => {
    Promise.all([ipc.app.info(), ipc.config.get()])
      .then(([info, config]) => {
        setAppInfo(info);
        setUpdateCheck((config as ConfigOutput).behavior?.updateCheck ?? true);
      })
      .catch(() => {});
  }, []);

  const onDebug = async () => {
    await ipc.tool.toggleDevTools();
  };

  const onUpdateCheckChange = async (checked: boolean) => {
    const previous = updateCheck ?? true;
    setUpdateCheck(checked);
    setIsSavingUpdateCheck(true);
    try {
      await updateConfig({
        body: {
          behavior: {
            updateCheck: checked,
          },
        },
      });
    } catch (error) {
      setUpdateCheck(previous);
      toast.error(`保存失败: ${toErrorMessage(error, "未知错误")}`);
    } finally {
      setIsSavingUpdateCheck(false);
    }
  };

  return (
    <div
      className="h-full flex flex-col overflow-y-auto overflow-x-hidden bg-background/30 selection:bg-primary/10"
      style={NO_DRAG_STYLE}
    >
      <div className="flex-1 flex flex-col w-full max-w-xl mx-auto px-6 py-6 md:px-8">
        <div className="flex flex-col gap-7">
          {/* Header (Hero Section) */}
          <section className="flex flex-col items-center text-center gap-3">
            <button
              type="button"
              onClick={() => openUrl("https://github.com/ShotHeadman/mdcz")}
              className={cn("relative group transition-all active:scale-[0.98]", quietHeroRadiusClass)}
            >
              <div className="absolute inset-0 bg-primary/5 blur-2xl rounded-full scale-125 group-hover:bg-primary/10 transition-colors" />
              <img
                src={AppLogo}
                alt="MDCz"
                className={cn("relative h-20 w-20 shadow-xl shadow-primary/5", quietHeroRadiusClass)}
              />
            </button>
            <div className="flex flex-col items-center gap-1">
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                MDCz
                {appInfo && (
                  <Badge variant="secondary" className="mt-1 opacity-80">
                    v{appInfo.version}
                  </Badge>
                )}
              </h1>
            </div>
          </section>

          <div className="grid gap-7">
            {/* Feedback & Actions */}
            <section className="space-y-2">
              <div className="px-1 flex items-center gap-2 text-xs font-bold tracking-widest text-muted-foreground uppercase opacity-50">
                <Sparkles className="w-3.5 h-3.5" />
                <span>社区与反馈</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  className={cn(
                    "h-14 justify-start gap-3.5 px-4.5 bg-surface-low/30 border-border/30 hover:bg-surface-low/60 hover:border-border/60 transition-all group",
                    quietPanelRadiusClass,
                  )}
                  onClick={() => openUrl("https://github.com/ShotHeadman/mdcz/issues/new/choose")}
                >
                  <div className="w-8 h-8 rounded-full bg-primary/5 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                    <Github className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col items-start text-left">
                    <span className="text-sm font-semibold">提交反馈</span>
                  </div>
                  <ExternalLink className="ml-auto h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity translate-x-1 group-hover:translate-x-0" />
                </Button>
                <Button
                  variant="outline"
                  className={cn(
                    "h-14 justify-start gap-3.5 px-4.5 bg-surface-low/30 border-border/30 hover:bg-surface-low/60 hover:border-border/60 transition-all group",
                    quietPanelRadiusClass,
                  )}
                  onClick={onDebug}
                >
                  <div className="w-8 h-8 rounded-full bg-primary/5 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                    <Bug className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col items-start text-left">
                    <span className="text-sm font-semibold">开启调试</span>
                  </div>
                </Button>
              </div>
            </section>

            {/* Updates Settings */}
            <section
              className={cn(
                "bg-surface-low/30 border border-border/30 p-5 flex items-center justify-between group hover:bg-surface-low/60 hover:border-border/60 transition-all",
                quietPanelRadiusClass,
              )}
            >
              <div className="space-y-0.5 px-1">
                <h3 className="text-sm font-semibold">自动检查更新</h3>
              </div>
              <Switch
                checked={Boolean(updateCheck)}
                disabled={updateCheck === null || isSavingUpdateCheck}
                onCheckedChange={onUpdateCheckChange}
              />
            </section>

            {/* Related Projects */}
            <section className="space-y-2">
              <div className="px-1 text-xs font-bold tracking-widest text-muted-foreground uppercase opacity-50">
                相关项目
              </div>
              <div className="grid gap-2.5">
                {PROJECT_LINKS.map((link) => (
                  <button
                    key={link.name}
                    type="button"
                    onClick={() => openUrl(link.url)}
                    className={cn(
                      "flex w-full items-center justify-between p-4 bg-surface-low/20 hover:bg-surface-low/50 transition-all group border border-transparent hover:border-border/40",
                      quietPanelRadiusClass,
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white/40 dark:bg-black/10 flex items-center justify-center text-muted-foreground/60 group-hover:text-primary transition-colors border border-border/10">
                        <Github className="h-5 w-5" />
                      </div>
                      <div className="text-left">
                        <div className="text-sm font-semibold group-hover:text-primary transition-colors">
                          {link.name}
                        </div>
                        <div className="text-xs text-muted-foreground/60">{link.description}</div>
                      </div>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0" />
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* Footer */}
          <footer className="text-center pt-2 pb-1">
            <p className="text-[11px] font-semibold text-muted-foreground/30 tracking-[0.2em] uppercase">
              Crafted by ShotHeadman
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
