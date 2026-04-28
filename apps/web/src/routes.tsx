import { toErrorMessage } from "@mdcz/shared/error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, HardDrive, LayoutDashboard, ListChecks, LogOut, Settings, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, getApiBase, setApiBase, subscribeTaskUpdates } from "./client";
import { Badge, Button, Field, Input, Page, Panel } from "./ui";

const navItems = [
  { label: "概览", to: "/", icon: LayoutDashboard },
  { label: "初始化", to: "/setup", icon: ShieldCheck },
  { label: "媒体根", to: "/media-roots", icon: HardDrive },
  { label: "浏览", to: "/browser", icon: FolderOpen },
  { label: "任务", to: "/tasks", icon: ListChecks },
  { label: "设置", to: "/settings", icon: Settings },
];

type AppLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  search?: Record<string, string | undefined>;
};

const buildHref = (to: string, search?: Record<string, string | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value !== undefined) {
      query.set(key, value);
    }
  }
  return query.size > 0 ? `${to}?${query.toString()}` : to;
};

const AppLink = ({ to, search, className, children, ...props }: AppLinkProps) => (
  <a className={className} href={buildHref(to, search)} {...props}>
    {children}
  </a>
);

const ErrorBanner = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-quiet border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
    {children}
  </div>
);

const Notice = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-quiet border border-border/60 bg-surface-low px-4 py-3 text-sm text-muted-foreground">
    {children}
  </div>
);

export const SetupPage = () => {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("admin");
  const [name, setName] = useState("Media");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setupQ = useQuery({ queryKey: ["setup"], queryFn: () => api.setup.status(), retry: false });
  const authQ = useQuery({ queryKey: ["auth"], queryFn: () => api.auth.status(), retry: false });
  const loginM = useMutation({ mutationFn: () => api.auth.login({ password }) });
  const createM = useMutation({ mutationFn: () => api.mediaRoots.create({ name, path, enabled: true }) });
  const authenticated = authQ.data?.authenticated || loginM.data?.authenticated;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries();
    } catch (runError) {
      setError(toErrorMessage(runError));
    }
  };

  return (
    <Page title="初始化" subtitle="配置单管理员访问，并注册已挂载的文件系统媒体根。">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Admin login" description="默认 alpha 密码为 admin；可通过 MDCZ_ADMIN_PASSWORD 覆盖。">
          <Field label="Password">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Button disabled={authenticated || loginM.isPending} onClick={() => run(() => loginM.mutateAsync())}>
            {authenticated ? "Authenticated" : "Login"}
          </Button>
        </Panel>
        <Panel title="Media root" description="首版只接受已挂载路径；NAS/WebDAV/SFTP 请先由系统挂载。">
          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Path">
            <Input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/mnt/media or E:/Media"
            />
          </Field>
          <Button disabled={!authenticated || createM.isPending} onClick={() => run(() => createM.mutateAsync())}>
            Add media root
          </Button>
        </Panel>
      </div>
      <Panel title="Status">
        <p className="text-sm text-muted-foreground">
          {setupQ.data?.configured ? "Setup complete." : "Add an enabled media root to complete setup."}
        </p>
        <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/">
          Open overview
        </AppLink>
      </Panel>
    </Page>
  );
};

export const OverviewPage = () => {
  const healthQ = useQuery({ queryKey: ["health"], queryFn: () => api.health.read(), retry: false });
  const setupQ = useQuery({ queryKey: ["setup"], queryFn: () => api.setup.status(), retry: false });
  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const tasksQ = useQuery({ queryKey: ["scans"], queryFn: () => api.scans.list(), retry: false });

  return (
    <Page title="概览" subtitle="WebUI server runtime status for mounted-volume workflows.">
      {!setupQ.data?.configured && (
        <Notice>
          <AppLink className="font-medium text-foreground underline-offset-4 hover:underline" to="/setup">
            Complete first-run setup
          </AppLink>
        </Notice>
      )}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Server" description={healthQ.data?.service}>
          <p className="font-numeric text-3xl font-bold tracking-tight">{healthQ.data?.status ?? "unknown"}</p>
        </Panel>
        <Panel title="Media roots">
          <p className="font-numeric text-3xl font-bold tracking-tight">{rootsQ.data?.roots.length ?? 0}</p>
          <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/media-roots">
            Manage roots
          </AppLink>
        </Panel>
        <Panel title="Tasks">
          <p className="font-numeric text-3xl font-bold tracking-tight">{tasksQ.data?.tasks.length ?? 0}</p>
          <AppLink className="text-sm font-medium text-foreground underline-offset-4 hover:underline" to="/tasks">
            Open tasks
          </AppLink>
        </Panel>
      </section>
    </Page>
  );
};

export const MediaRootsPage = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Media");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const createM = useMutation({ mutationFn: () => api.mediaRoots.create({ name, path, enabled: true }) });
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries();
    } catch (runError) {
      setError(toErrorMessage(runError));
    }
  };

  return (
    <Page title="媒体根" subtitle="所有 server 文件操作都限制在已注册的挂载文件系统根目录内。">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Panel title="Add root">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] lg:items-end">
          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Root name" />
          </Field>
          <Field label="Path">
            <Input
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="E:/Media"
              aria-label="Root path"
            />
          </Field>
          <Button onClick={() => run(() => createM.mutateAsync())}>Add</Button>
        </div>
      </Panel>
      <div className="grid gap-4">
        {rootsQ.data?.roots.map((root) => (
          <Panel key={root.id} title={root.name}>
            <p className="break-all font-mono text-sm text-muted-foreground">{root.path}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{root.enabled ? "Enabled" : "Disabled"}</Badge>
              <Button
                variant="secondary"
                onClick={() => {
                  window.location.href = buildHref("/browser", { rootId: root.id, path: "" });
                }}
              >
                Browse
              </Button>
              <Button variant="secondary" onClick={() => run(() => api.scans.start({ rootId: root.id }))}>
                Scan
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  run(() =>
                    root.enabled ? api.mediaRoots.disable({ id: root.id }) : api.mediaRoots.enable({ id: root.id }),
                  )
                }
              >
                {root.enabled ? "Disable" : "Enable"}
              </Button>
              <Button variant="danger" onClick={() => run(() => api.mediaRoots.delete({ id: root.id }))}>
                Delete
              </Button>
            </div>
          </Panel>
        ))}
      </div>
    </Page>
  );
};

const parentPath = (value: string): string => {
  const parts = value.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
};

export const BrowserPage = () => {
  const search = new URLSearchParams(window.location.search);
  const rootsQ = useQuery({ queryKey: ["mediaRoots"], queryFn: () => api.mediaRoots.list(), retry: false });
  const rootId = search.get("rootId") ?? rootsQ.data?.roots[0]?.id;
  const relativePath = search.get("path") ?? "";
  const browserQ = useQuery({
    queryKey: ["browser", rootId, relativePath],
    queryFn: () => api.browser.list({ rootId: rootId ?? "", relativePath }),
    enabled: Boolean(rootId),
    retry: false,
  });

  return (
    <Page
      title="浏览"
      subtitle={browserQ.data?.root.path ?? "Select a media root to browse directories and video files."}
    >
      {browserQ.error && <ErrorBanner>{toErrorMessage(browserQ.error)}</ErrorBanner>}
      {rootId && relativePath && (
        <AppLink
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
          to="/browser"
          search={{ rootId, path: parentPath(relativePath) }}
        >
          Up
        </AppLink>
      )}
      <Panel title={`/${browserQ.data?.relativePath ?? relativePath}`}>
        <div className="grid overflow-hidden rounded-quiet border border-border/50 bg-surface-low/40">
          {browserQ.data?.entries.map((entry) => (
            <div
              className="flex items-center justify-between gap-4 border-t border-border/40 px-4 py-3 first:border-t-0"
              key={entry.relativePath}
            >
              {entry.type === "directory" ? (
                <AppLink
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  to="/browser"
                  search={{ rootId, path: entry.relativePath }}
                >
                  {entry.name}/
                </AppLink>
              ) : (
                <span className="truncate">{entry.name}</span>
              )}
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {entry.type === "file" ? `${entry.classification} · ${entry.size ?? 0} bytes` : "directory"}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </Page>
  );
};

export const TasksPage = () => {
  const queryClient = useQueryClient();
  const tasksQ = useQuery({ queryKey: ["scans"], queryFn: () => api.scans.list(), retry: false });
  useEffect(
    () =>
      subscribeTaskUpdates(() => {
        void queryClient.invalidateQueries({ queryKey: ["scans"] });
      }),
    [queryClient],
  );

  return (
    <Page title="任务" subtitle="SQLite-backed scan queue and persisted scan results.">
      <div>
        <Button variant="secondary" onClick={() => void tasksQ.refetch()}>
          Refresh
        </Button>
      </div>
      <div className="grid gap-4">
        {tasksQ.data?.tasks.map((task) => (
          <Panel key={task.id} title={`${task.status.toUpperCase()} · ${task.id}`}>
            <p className="text-sm text-muted-foreground">
              {task.error ?? `${task.videoCount} videos, ${task.directoryCount} directories`}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              Created {task.createdAt} · Updated {task.updatedAt}
            </p>
            {task.videos && task.videos.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Persisted video result paths</summary>
                <ul className="mt-3 max-h-80 space-y-1 overflow-auto rounded-quiet bg-surface-low p-4 font-mono text-xs text-muted-foreground">
                  {task.videos.slice(0, 200).map((video) => (
                    <li className="break-all" key={video}>
                      {video}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Panel>
        ))}
      </div>
    </Page>
  );
};

export const SettingsPage = () => {
  const queryClient = useQueryClient();
  const [base, setBase] = useState(getApiBase());
  const persistenceQ = useQuery({ queryKey: ["persistence"], queryFn: () => api.persistence.status(), retry: false });
  return (
    <Page title="设置" subtitle="Server endpoint and persistence status.">
      <Panel title="Server API endpoint">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <Input value={base} onChange={(event) => setBase(event.target.value)} />
          <Button
            onClick={() => {
              setApiBase(base);
              void queryClient.invalidateQueries();
            }}
          >
            Save endpoint
          </Button>
        </div>
      </Panel>
      <Panel title="Persistence">
        <p className="text-sm text-muted-foreground">{persistenceQ.data?.ok ? "Available" : "Unavailable"}</p>
        <p className="break-all font-mono text-sm text-muted-foreground">{persistenceQ.data?.path}</p>
      </Panel>
    </Page>
  );
};

export const RootLayout = ({ children }: { children: React.ReactNode }) => {
  const pathname = window.location.pathname;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[130px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
          <div className="flex h-20 shrink-0 items-center gap-2 px-5">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground shadow-sm">
              M
            </div>
            <span className="select-none text-lg font-semibold tracking-tight">MDCz</span>
          </div>
          <nav className="flex flex-1 flex-col gap-2 overflow-y-auto py-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.to;
              return (
                <AppLink
                  className={`relative flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                    active
                      ? "font-bold text-foreground before:absolute before:left-1 before:bottom-2 before:top-2 before:w-0.5 before:rounded-full before:bg-foreground"
                      : "font-medium text-muted-foreground hover:text-foreground"
                  }`}
                  key={item.to}
                  to={item.to}
                >
                  <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span className="truncate">{item.label}</span>
                </AppLink>
              );
            })}
          </nav>
          <div className="border-t border-border/50 px-3 py-2">
            <Button
              className="w-full justify-start px-3"
              variant="secondary"
              onClick={() => {
                void api.auth.logout().finally(() => {
                  window.location.href = "/setup";
                });
              }}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden py-2 pl-2">
          <div className="flex-1 overflow-hidden rounded-l-xl bg-surface">{children}</div>
        </main>
      </div>
    </div>
  );
};
