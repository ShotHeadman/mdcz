import { type NormalizedCropRegion, resolvePosterEditorCropRegion } from "@mdcz/shared/posterCrop";
import { PosterCropDialog } from "@mdcz/views/common";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

const fullArea = resolvePosterEditorCropRegion(900, 500);
// The area a poster was last cut by, half the size of the largest one.
const initialCrop = { x: 0.1, y: 0.2, width: fullArea.width / 2, height: fullArea.height / 2 };
const sourceUrl =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="100%" height="100%" fill="#c84630"/></svg>',
  );

function PosterCropHarness({ onSave }: { onSave: (crop: NormalizedCropRegion) => void }) {
  const [open, setOpen] = useState(true);
  const [crop, setCrop] = useState(initialCrop);
  return (
    <PosterCropDialog
      open={open}
      session={{ sourceUrl, width: 900, height: 500, initialCrop }}
      crop={crop}
      saving={false}
      onCropChange={setCrop}
      onOpenChange={setOpen}
      onSave={() => onSave(crop)}
    />
  );
}

test("poster crop dialog opens on a stored area and keeps 2:3 framing across zoom, reset, and save", async () => {
  const onSave = vi.fn();
  const screen = await render(<PosterCropHarness onSave={onSave} />);
  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "封面裁剪区域" })).toBeVisible();
  await expect.element(screen.getByLabelText("封面缩放")).toHaveValue("2");

  await screen.getByLabelText("封面缩放").fill("1");
  await screen.getByRole("button", { name: "保存封面" }).click();
  const zoomedOut = onSave.mock.calls[0]?.[0] as NormalizedCropRegion;
  expect((zoomedOut.width * 900) / (zoomedOut.height * 500)).toBeCloseTo(2 / 3, 3);
  expect(zoomedOut.width).toBeCloseTo(fullArea.width, 6);

  await screen.getByRole("button", { name: "重置" }).click();
  await screen.getByRole("button", { name: "保存封面" }).click();
  expect(onSave).toHaveBeenLastCalledWith(initialCrop);
});
