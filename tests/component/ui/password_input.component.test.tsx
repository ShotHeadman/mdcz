import { PasswordInput } from "@mdcz/ui";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

test("password input exposes a semantic visibility toggle", async () => {
  const screen = await render(
    <div>
      <label htmlFor="admin-password">Admin password</label>
      <PasswordInput id="admin-password" visibilityLabels={{ show: "Show password", hide: "Hide password" }} />
    </div>,
  );
  const input = screen.getByLabelText("Admin password");

  await expect.element(input).toHaveAttribute("type", "password");
  await screen.getByRole("button", { name: "Show password" }).click();
  await expect.element(input).toHaveAttribute("type", "text");
  await expect.element(screen.getByRole("button", { name: "Hide password" })).toBeVisible();
});
