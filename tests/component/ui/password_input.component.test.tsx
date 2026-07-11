import { PasswordInput } from "@mdcz/ui";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

test("password input exposes a semantic visibility toggle", async () => {
  const screen = await render(
    <div>
      <label htmlFor="admin-password">管理员密码</label>
      <PasswordInput id="admin-password" />
    </div>,
  );
  const input = screen.getByLabelText("管理员密码");

  await expect.element(input).toHaveAttribute("type", "password");
  await screen.getByRole("button", { name: "显示密码" }).click();
  await expect.element(input).toHaveAttribute("type", "text");
  await expect.element(screen.getByRole("button", { name: "隐藏密码" })).toBeVisible();
});
