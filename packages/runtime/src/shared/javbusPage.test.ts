import { describe, expect, it } from "vitest";
import { classifyJavbusPage } from "./javbusPage";

describe("classifyJavbusPage", () => {
  it.each([
    ["film content", '<a class="movie-box" href="/ABP-123"></a>', "content"],
    [
      "film content with a login link in the navigation",
      '<nav><a href="/forum/member.php?mod=logging&action=login">登入</a></nav><div id="waterfall"></div>',
      "content",
    ],
    [
      "age verification",
      '<title>Age Verification JavBus - JavBus</title><div id="ageVerify"></div>',
      "verification_required",
    ],
    [
      "age verification modal overlaying film content",
      '<h4 class="modal-title">你是否已經成年？</h4><a class="movie-box" href="/ABP-123"></a>',
      "verification_required",
    ],
    ["region driving quiz", "<h1>Region verification</h1><p>駕駛考試題</p>", "verification_required"],
    [
      "region driving quiz split across lines and tags",
      "<h1>Region\n verification</h1>\n<p>請完成<strong>駕駛</strong>\n<em>考試</em>題</p>",
      "verification_required",
    ],
    ["login wall", '<form><h2>Login</h2><input name="username" /><input type="password" /></form>', "login_wall"],
    [
      "newsletter email field with a login link is not a login wall",
      '<a href="/login">登录</a><form><input type="email" name="email" /></form>',
      "unknown",
    ],
    ["unknown page", "<main>temporarily unavailable</main>", "unknown"],
  ] as const)("classifies %s", (_name, html, expected) => {
    expect(classifyJavbusPage(html)).toBe(expected);
  });
});
