import { toErrorMessage } from "@mdcz/shared/error";
import { Button, Card, CardContent, CardHeader, CardTitle, PasswordInput } from "@mdcz/ui";
import { useT } from "@mdcz/views/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../client";
import { queryKeys } from "../lib/queryKeys";
import { ErrorBanner } from "../routeCommon";

export const SetupPage = () => {
  const t = useT();
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
          <CardTitle>{t.web.initAdminTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-6"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);
              if (password !== confirmation) {
                setError(t.web.passwordsDoNotMatch);
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
            <p className="text-sm text-muted-foreground">{t.web.initAdminDescription}</p>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <label htmlFor="admin-password" className="block space-y-2">
              <span>{t.web.adminPassword}</span>
              <PasswordInput
                visibilityLabels={{ show: t.common.showPassword, hide: t.common.hidePassword }}
                id="admin-password"
                autoComplete="new-password"
                placeholder={t.web.adminPasswordPlaceholder}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label htmlFor="confirm-password" className="block space-y-2">
              <span>{t.web.confirmPassword}</span>
              <PasswordInput
                visibilityLabels={{ show: t.common.showPassword, hide: t.common.hidePassword }}
                id="confirm-password"
                autoComplete="new-password"
                placeholder={t.web.confirmPasswordPlaceholder}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={pending}>
              {pending ? t.web.completingInit : t.web.completeInit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
};

export const Route = createFileRoute("/setup")({ component: SetupPage });
