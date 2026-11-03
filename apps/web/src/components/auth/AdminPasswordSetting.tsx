import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  PasswordInput,
} from "@mdcz/ui";
import { useT } from "@mdcz/views/i18n";
import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "../../client";
import { queryKeys } from "../../lib/queryKeys";
import { ErrorBanner } from "../../routeCommon";
import { passwordErrorMessage } from "./LoginPage";

export const AdminPasswordSetting = () => {
  const t = useT();
  const authQ = useQuery({ queryKey: queryKeys.auth.status, queryFn: () => api.auth.status() });
  const [dialogOpen, setDialogOpen] = useState(false);

  if (authQ.data?.environmentPasswordConfigured) {
    return <p className="py-2 text-xs text-muted-foreground">{t.web.passwordManagedByEnvironment}</p>;
  }

  return (
    <>
      <div className="py-2">
        <Button variant="outline" onClick={() => setDialogOpen(true)}>
          <KeyRound />
          {t.web.changePassword}
        </Button>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        {dialogOpen ? <ChangePasswordDialog onDone={() => setDialogOpen(false)} /> : null}
      </Dialog>
    </>
  );
};

const ChangePasswordDialog = ({ onDone }: { onDone: () => void }) => {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    setError(null);
    if (!currentPassword || !newPassword) {
      setError(t.web.passwordRequired);
      return;
    }
    if (newPassword !== form.get("confirmation")) {
      setError(t.web.passwordsDoNotMatch);
      return;
    }
    setPending(true);
    try {
      await api.auth.changePassword({ currentPassword, newPassword });
      toast.success(t.web.passwordChanged);
      onDone();
    } catch (err) {
      setError(passwordErrorMessage(t, err));
    } finally {
      setPending(false);
    }
  };

  const visibilityLabels = { show: t.common.showPassword, hide: t.common.hidePassword };
  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{t.web.changePassword}</DialogTitle>
        <DialogDescription>{t.web.changePasswordDescription}</DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div className="grid gap-2">
          <Label htmlFor="account-current-password">{t.web.currentPassword}</Label>
          <PasswordInput
            visibilityLabels={visibilityLabels}
            id="account-current-password"
            name="currentPassword"
            autoComplete="current-password"
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="account-new-password">{t.web.newPassword}</Label>
          <PasswordInput
            visibilityLabels={visibilityLabels}
            id="account-new-password"
            name="newPassword"
            autoComplete="new-password"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="account-confirm-password">{t.web.confirmNewPassword}</Label>
          <PasswordInput
            visibilityLabels={visibilityLabels}
            id="account-confirm-password"
            name="confirmation"
            autoComplete="new-password"
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? t.web.savingPassword : t.web.changePassword}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
};
