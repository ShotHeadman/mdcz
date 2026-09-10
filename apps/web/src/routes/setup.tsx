import { toErrorMessage } from "@mdcz/shared/error";
import { Button, Card, CardContent, CardHeader, CardTitle, PasswordInput } from "@mdcz/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../client";
import { queryKeys } from "../lib/queryKeys";
import { ErrorBanner } from "../routeCommon";

export const SetupPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-canvas px-6 py-12 text-foreground">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>初始化管理员账户</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-6"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);
              if (password !== confirmation) {
                setError("两次输入的密码不一致");
                return;
              }
              setPending(true);
              try {
                await api.setup.complete({ password });
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: queryKeys.auth.status }),
                  queryClient.invalidateQueries({ queryKey: queryKeys.setup.status }),
                ]);
                await navigate({ to: "/", replace: true });
              } catch (error) {
                setError(toErrorMessage(error));
              } finally {
                setPending(false);
              }
            }}
          >
            <p className="text-sm text-muted-foreground">创建管理员账户后，即可进入系统配置媒体库。</p>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <label htmlFor="admin-password" className="block space-y-2">
              <span>管理员密码</span>
              <PasswordInput
                id="admin-password"
                autoComplete="new-password"
                placeholder="请输入新密码（无特殊格式限制）"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label htmlFor="confirm-password" className="block space-y-2">
              <span>确认密码</span>
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                placeholder="请再次输入新密码以确认"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={pending}>
              {pending ? "正在完成初始化…" : "完成初始化"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
};

export const Route = createFileRoute("/setup")({ component: SetupPage });
