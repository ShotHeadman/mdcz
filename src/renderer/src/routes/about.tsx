import type { AppInfo } from "@shared/ipcContract";
import { createFileRoute } from "@tanstack/react-router";
import { Bug, ExternalLink, Github } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import AppLogo from "@/assets/images/logo.png";
import { ipc } from "@/client/ipc";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Separator } from "@/components/ui/Separator";

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

  useEffect(() => {
    ipc.app
      .info()
      .then(setAppInfo)
      .catch(() => {});
  }, []);

  const onDebug = async () => {
    await ipc.tool.toggleDevTools();
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto overflow-x-hidden" style={NO_DRAG_STYLE}>
      <div className="flex-1 flex flex-col justify-center w-full max-w-2xl mx-auto px-6 py-8 md:px-12">
        <div className="space-y-8">
          {/* Header */}
          <div className="flex items-center gap-6 py-4">
            <button
              type="button"
              onClick={() => openUrl("https://github.com/ShotHeadman/mdcz")}
              className="shrink-0 transition-all hover:scale-105 active:scale-95 group"
            >
              <img
                src={AppLogo}
                alt="MDCz"
                className="h-20 w-20 rounded-2xl shadow-sm border bg-card group-hover:shadow-md transition-shadow"
              />
            </button>
            <div className="flex flex-col justify-center">
              <h1 className="text-2xl font-bold tracking-tight">MDCz</h1>
              <p className="text-sm text-muted-foreground mt-1">影片元数据刮削与管理工具</p>
              {appInfo && (
                <button
                  type="button"
                  onClick={() => openUrl(`https://github.com/ShotHeadman/mdcz/releases/tag/v${appInfo.version}`)}
                  className="mt-2 self-start"
                >
                  <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold hover:bg-primary/20 transition-colors cursor-pointer border border-primary/20">
                    v{appInfo.version}
                  </span>
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-6">
            {/* Support & Development */}
            <Card className="bg-muted/20 border-none shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">支持与反馈</CardTitle>
                <CardDescription>遇到问题或有好的建议？欢迎反馈给开发者</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-10 bg-background/50 border-muted-foreground/20 hover:bg-background hover:border-primary/50 transition-all group"
                  onClick={() => openUrl("https://github.com/ShotHeadman/mdcz/issues/new/choose")}
                >
                  <Github className="h-4 w-4" />
                  <span>提交反馈</span>
                  <ExternalLink className="ml-auto h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 h-10 bg-background/50 border-muted-foreground/20 hover:bg-background hover:border-primary/50 transition-all group"
                  onClick={onDebug}
                >
                  <Bug className="h-4 w-4" />
                  <span>开启调试</span>
                  <ExternalLink className="ml-auto h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Button>
              </CardContent>
            </Card>

            {/* Related Projects */}
            <Card className="bg-muted/20 border-none shadow-none p-0">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">相关项目</CardTitle>
                <CardDescription>感谢以下开源项目为本工具提供的核心功能支持</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {PROJECT_LINKS.map((link) => (
                  <button
                    key={link.name}
                    type="button"
                    onClick={() => openUrl(link.url)}
                    className="flex w-full items-center justify-between p-3 rounded-lg hover:bg-background/80 hover:text-foreground transition-all group text-left border border-transparent hover:border-muted-foreground/10 shadow-none hover:shadow-sm"
                  >
                    <div>
                      <div className="text-sm font-medium group-hover:text-primary transition-colors">{link.name}</div>
                      <div className="text-xs text-muted-foreground">{link.description}</div>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="pt-4">
            <Separator className="opacity-50" />
            <div className="mt-6 text-center text-xs text-muted-foreground/60 font-medium">
              <p>by ShotHeadman</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
