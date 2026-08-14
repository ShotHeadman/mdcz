import { type NormalizedCropRegion, resolvePosterEditorCropRegion } from "@mdcz/shared/posterCrop";
import { PosterCropDialog } from "@mdcz/views/detail";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

const initialCrop = resolvePosterEditorCropRegion(900, 500);
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

test("poster crop dialog preserves 2:3 framing across zoom, reset, and save", async () => {
  const onSave = vi.fn();
  const screen = await render(<PosterCropHarness onSave={onSave} />);
  await expect.element(screen.getByRole("dialog", { name: "编辑封面" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "封面裁剪区域" })).toBeVisible();

  await screen.getByLabelText("封面缩放").fill("2");
  await screen.getByRole("button", { name: "保存封面" }).click();
  const zoomedCrop = onSave.mock.calls[0]?.[0] as NormalizedCropRegion;
  expect((zoomedCrop.width * 900) / (zoomedCrop.height * 500)).toBeCloseTo(2 / 3, 3);
  expect(zoomedCrop.width).toBeLessThan(initialCrop.width);

  await screen.getByRole("button", { name: "重置" }).click();
  await screen.getByRole("button", { name: "保存封面" }).click();
  expect(onSave).toHaveBeenLastCalledWith(initialCrop);
});
