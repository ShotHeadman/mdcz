import { toErrorMessage } from "@mdcz/shared/error";
import { Button, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, PasswordInput } from "@mdcz/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "../../client";
import { queryKeys } from "../../lib/queryKeys";
import { ErrorBanner } from "../../routeCommon";

export const LoginPage = ({ nextPath = "/" }: { nextPath?: string }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.status });
      await navigate({ to: nextPath, replace: true });
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
          <p className="text-sm leading-6 text-muted-foreground">请输入管理员密码</p>
        </div>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Form {...form}>
          <form className="grid gap-6" onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}>
            <FormField
              control={form.control}
              name="password"
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
            <Button disabled={isPending} type="submit">
              {isPending ? "正在登录..." : "登录"}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
};
