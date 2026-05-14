import { toErrorMessage } from "@mdcz/shared/error";
import { AppShell, type ShellLinkProps, ThemeProvider } from "@mdcz/views/shell";
import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "../client";
import { useWebTaskSync } from "../hooks/useWebTaskSync";
import { ErrorBanner } from "../routeCommon";
import { Button, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, PasswordInput } from "../ui";

const PUBLIC_PATHS = new Set(["/setup", "/login"]);

const ShellLink = ({ to, className, onFocus, onMouseEnter, children }: ShellLinkProps) => (
  <a className={className} href={to} onFocus={onFocus} onMouseEnter={onMouseEnter}>
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

  return <AuthenticatedShell pathname={pathname}>{children}</AuthenticatedShell>;
};

const AuthenticatedShell = ({ children, pathname }: { children: ReactNode; pathname: string }) => {
  useWebTaskSync();

  return (
    <ThemeProvider>
      <AppShell currentPath={pathname} linkComponent={ShellLink}>
        {children}
      </AppShell>
    </ThemeProvider>
  );
};

export const Route = createRootRoute({
  component: () => (
    <RootLayout>
      <Outlet />
    </RootLayout>
  ),
});
