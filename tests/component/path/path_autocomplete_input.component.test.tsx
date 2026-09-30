import { PathAutocompleteInput, type PathAutocompleteResult } from "@mdcz/views/path";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

function PathHarness({
  loadSuggestions,
  onCommit,
}: {
  loadSuggestions?: (value: string) => Promise<PathAutocompleteResult>;
  onCommit?: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <div>
      <label htmlFor="media-path">媒体目录</label>
      <PathAutocompleteInput
        id="media-path"
        value={value}
        onChange={setValue}
        onBlur={() => onCommit?.(value)}
        loadSuggestions={loadSuggestions}
        staticSuggestions={[
          { label: "电影", path: "D:/Media/Movies" },
          { label: "剧集", path: "D:/Media/Series" },
        ]}
      />
      <button type="button">完成</button>
    </div>
  );
}

test("path autocomplete supports keyboard selection with semantic listbox options", async () => {
  const onCommit = vi.fn();
  const screen = await render(<PathHarness onCommit={onCommit} />);
  const input = screen.getByLabelText("媒体目录");

  await input.click();
  await expect.element(screen.getByRole("listbox")).toBeVisible();
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await expect.element(input).toHaveValue("D:/Media/Series");
  await input.fill("D:/Media");
  await userEvent.keyboard("{Tab}");
  expect(onCommit).not.toHaveBeenCalled();
  await userEvent.keyboard("{Enter}");
  await expect.element(input).toHaveValue("D:/Media/Movies");
  await input.click();
  await screen.getByRole("button", { name: "完成" }).click();
  expect(onCommit).toHaveBeenLastCalledWith("D:/Media/Movies");
  await expect.element(screen.getByRole("listbox")).not.toBeInTheDocument();
});

test("path autocomplete exposes loading and resolved asynchronous suggestions", async () => {
  const loadSuggestions = vi.fn(async (): Promise<PathAutocompleteResult> => {
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    return { entries: [{ label: "动画", path: "D:/Media/Anime" }] };
  });
  const screen = await render(<PathHarness loadSuggestions={loadSuggestions} />);

  await screen.getByLabelText("媒体目录").click();
  await expect.element(screen.getByText("正在读取目录")).toBeVisible();
  await expect.element(screen.getByRole("option", { name: /动画/u })).toBeVisible();
  expect(loadSuggestions).toHaveBeenCalledWith("");
});
