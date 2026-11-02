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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@mdcz/ui";
import { useT } from "@mdcz/views/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "../../client";
import { queryKeys } from "../../lib/queryKeys";
import { ErrorBanner } from "../../routeCommon";
import { passwordErrorMessage } from "./LoginPage";

export const AccountMenu = () => {
  const t = useT();
  const queryClient = useQueryClient();
  const authQ = useQuery({ queryKey: queryKeys.auth.status, queryFn: () => api.auth.status() });
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const logout = async () => {
    await api.auth.logout();
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.auth.status[0] });
    await queryClient.invalidateQueries({ queryKey: queryKeys.auth.status });
  };

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label={t.web.account}
            title={t.web.account}
          >
            <UserRound />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-48 p-1">
          {/* MDCZ_ADMIN_PASSWORD owns the password, so there is nothing for the UI to change. */}
          {authQ.data?.environmentPasswordConfigured ? null : (
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                setMenuOpen(false);
                setDialogOpen(true);
              }}
            >
              <KeyRound />
              {t.web.changePassword}
            </Button>
          )}
          <Button variant="ghost" className="w-full justify-start" onClick={() => void logout()}>
            <LogOut />
            {t.web.logout}
          </Button>
        </PopoverContent>
      </Popover>
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
