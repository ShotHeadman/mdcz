import { toErrorMessage } from "@mdcz/shared/error";
import { Button, Label, PasswordInput } from "@mdcz/ui";
import { type Messages, useT } from "@mdcz/views/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import { type FormEvent, useState } from "react";
import { api } from "../../client";
import { queryKeys } from "../../lib/queryKeys";
import { ErrorBanner } from "../../routeCommon";

export const passwordErrorMessage = (t: Messages, error: unknown): string => {
  const code = error instanceof TRPCClientError ? error.data?.code : undefined;
  if (code === "UNAUTHORIZED") return t.web.incorrectPassword;
  if (code === "TOO_MANY_REQUESTS") return t.web.tooManyLoginAttempts;
  return toErrorMessage(error);
};

export const LoginPage = ({ nextPath = "/" }: { nextPath?: string }) => {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Read the field itself: browser autofill can fill it without React ever seeing an input event.
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setError(null);
    setIsPending(true);
    try {
      await api.auth.login({ password });
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.status });
      await navigate({ to: nextPath, replace: true });
    } catch (err) {
      setError(passwordErrorMessage(t, err));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-surface-canvas px-6 text-foreground">
      <div className="w-full max-w-md space-y-8 rounded-quiet-xl border border-border/60 bg-surface p-8 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.45)]">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">MDCz</p>
          <h1 className="text-2xl font-semibold tracking-tight">{t.web.adminLogin}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{t.web.enterAdminPassword}</p>
        </div>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <form className="grid gap-6" onSubmit={(event) => void handleSubmit(event)}>
          {/* Password managers save and fill a credential only as a username/password pair. */}
          <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
          <div className="grid gap-2">
            <Label htmlFor="admin-login-password">{t.web.password}</Label>
            <PasswordInput
              visibilityLabels={{ show: t.common.showPassword, hide: t.common.hidePassword }}
              id="admin-login-password"
              name="password"
              autoComplete="current-password"
              autoFocus
              placeholder="••••••••"
            />
          </div>
          <Button disabled={isPending} type="submit">
            {isPending ? t.web.loggingIn : t.web.login}
          </Button>
        </form>
      </div>
    </div>
  );
};
