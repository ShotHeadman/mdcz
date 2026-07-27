import { RecentAcquisitionRemoveDialog } from "@mdcz/views/overview";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

function DialogHarness({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开移除确认
      </button>
      <RecentAcquisitionRemoveDialog open={open} onConfirm={onConfirm} onOpenChange={setOpen} />
    </>
  );
}

test("recent acquisition removal supports cancel and confirm through the dialog", async () => {
  const onConfirm = vi.fn();
  const screen = await render(<DialogHarness onConfirm={onConfirm} />);
  const dialog = screen.getByRole("dialog", { name: "从最近入库移除" });

  await expect.element(dialog).toBeVisible();
  await screen.getByRole("button", { name: "取消" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(onConfirm).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "打开移除确认" }).click();
  await screen.getByRole("button", { name: "确认" }).click();
  expect(onConfirm).toHaveBeenCalledOnce();
});
