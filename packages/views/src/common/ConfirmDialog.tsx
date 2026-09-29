import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@mdcz/ui";
import { create } from "zustand";
import { useT } from "../i18n";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

const useConfirmStore = create<{ pending: PendingConfirm | null }>()(() => ({ pending: null }));

const settle = (confirmed: boolean) => {
  useConfirmStore.getState().pending?.resolve(confirmed);
  useConfirmStore.setState({ pending: null });
};

export const confirmDialog = (options: ConfirmOptions): Promise<boolean> =>
  new Promise((resolve) => {
    settle(false);
    useConfirmStore.setState({ pending: { ...options, resolve } });
  });

export function ConfirmDialogHost() {
  const t = useT();
  const pending = useConfirmStore((state) => state.pending);

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          {pending?.description ? (
            <DialogDescription className="whitespace-pre-wrap break-all">{pending.description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            {t.common.cancel}
          </Button>
          <Button variant={pending?.destructive ? "destructive" : "default"} onClick={() => settle(true)}>
            {pending?.confirmLabel ?? t.common.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
