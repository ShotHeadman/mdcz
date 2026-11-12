/**
 * Holds a quit while a task is doing work until the user confirms it. `hold` answers whether the quit may go ahead
 * now; when it may not, it asks once and calls `proceed` after the user agrees, after which every later quit passes.
 */
export const createQuitGuard = ({
  taskRunning,
  confirm,
}: {
  taskRunning: () => boolean;
  confirm: () => Promise<boolean>;
}): ((proceed: () => void) => boolean) => {
  let confirmed = false;
  let asking = false;
  return (proceed) => {
    if (confirmed || !taskRunning()) return true;
    if (asking) return false;
    asking = true;
    void confirm().then((agreed) => {
      asking = false;
      if (!agreed) return;
      confirmed = true;
      proceed();
    });
    return false;
  };
};
