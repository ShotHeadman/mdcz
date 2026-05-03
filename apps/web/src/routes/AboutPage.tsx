import { useQuery } from "@tanstack/react-query";
import { api } from "../client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui";
import { AppLink } from "./Common";

export const AboutPage = () => {
  const healthQ = useQuery({ queryKey: ["health"], queryFn: () => api.health.read(), retry: false });
  const persistenceQ = useQuery({ queryKey: ["persistence"], queryFn: () => api.persistence.status(), retry: false });
  const configQ = useQuery({ queryKey: ["config"], queryFn: () => api.config.read(), retry: false });

  return (
    <main className="h-full overflow-y-auto bg-surface-canvas text-foreground">
      <div className="mx-auto grid w-full max-w-[1600px] gap-7 px-6 py-8 lg:px-12 lg:py-12">
        <header className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">关于</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">MDCz WebUI/server 运行信息与支持入口。</p>
        </header>
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>MDCz WebUI</CardTitle>
              <CardDescription>面向已挂载媒体目录的浏览器工作台。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                当前 WebUI 正从已挂载媒体目录工作流逐步扩展到桌面 parity 产品界面。
              </p>
              <div className="grid gap-2 font-mono text-xs text-muted-foreground">
                <span>service: {healthQ.data?.service ?? "—"}</span>
                <span>status: {healthQ.data?.status ?? "—"}</span>
                <span>slice: {healthQ.data?.slice ?? "—"}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>运行状态</CardTitle>
              <CardDescription>用于排查 WebUI/server 的基础状态。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 text-sm text-muted-foreground">
                <p>持久化：{persistenceQ.data?.ok ? "可用" : "不可用"}</p>
                <p className="break-all font-mono text-xs">{persistenceQ.data?.path ?? "—"}</p>
                <p>默认媒体目录：{configQ.data?.paths.mediaPath || "未配置"}</p>
                <AppLink className="font-medium text-foreground underline-offset-4 hover:underline" to="/logs">
                  查看日志
                </AppLink>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
};
