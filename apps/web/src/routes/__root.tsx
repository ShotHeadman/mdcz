import { toErrorMessage } from "@mdcz/shared/error";
import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { type AnchorHTMLAttributes, type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "../client";
import { NAV_ITEMS } from "../navigation";
import { ErrorBanner } from "../routeCommon";
import { buildHref } from "../routeHelpers";
import { Button, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, PasswordInput } from "../ui";

const PUBLIC_PATHS = new Set(["/setup", "/login"]);

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  search?: Record<string, string | undefined>;
  to: string;
};

const AppLink = ({ to, search, className, children, ...props }: AppLinkProps) => (
  <a className={className} href={buildHref(to, search)} {...props}>
    {children}
  </a>
);

export const LoginPage = ({ nextPath = "/" }: { nextPath?: string }) => {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const form = useForm({
    defaultValues: {
      password: "",
    },
  });

  const handleSubmit = async (values: { password: string }) => {
    setError(null);
    setIsPending(true);
    try {
      await api.auth.login({ password: values.password });
      window.location.href = nextPath;
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-surface-canvas px-6 text-foreground">
      <div className="w-full max-w-md space-y-8 rounded-quiet-xl border border-border/60 bg-surface p-8 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">MDCz</p>
          <h1 className="text-2xl font-semibold tracking-tight">管理员登录</h1>
          <p className="text-sm leading-6 text-muted-foreground">请输入管理员密码继续使用 WebUI。</p>
        </div>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Form {...form}>
          <form className="grid gap-6" onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}>
            <FormField
              control={form.control}
              name="password"
              rules={{ required: "请输入管理员密码" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>密码</FormLabel>
                  <FormControl>
                    <PasswordInput autoFocus placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button disabled={isPending || !form.watch("password")} type="submit">
              {isPending ? "正在登录..." : "登录"}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
};

export const RootLayout = ({ children }: { children: ReactNode }) => {
  const pathname = window.location.pathname;
  const authQ = useQuery({ queryKey: ["auth", "status"], queryFn: () => api.auth.status(), retry: false });

  if (authQ.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface-canvas text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (authQ.data?.setupRequired && pathname !== "/setup") {
    window.location.replace("/setup");
    return null;
  }

  if (!authQ.data?.setupRequired && pathname === "/setup") {
    window.location.replace("/");
    return null;
  }

  if (!authQ.data?.setupRequired && !authQ.data?.authenticated && !PUBLIC_PATHS.has(pathname)) {
    return <LoginPage />;
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return <>{children}</>;
  }

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
            {NAV_ITEMS.map((item) => {
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
                  window.location.href = "/login";
                });
              }}
            >
              <LogOut className="h-4 w-4" />
              退出登录
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

export const Route = createRootRoute({
  component: () => (
    <RootLayout>
      <Outlet />
    </RootLayout>
  ),
});
