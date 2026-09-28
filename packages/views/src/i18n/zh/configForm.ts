import type { Messages } from "../en";

export const configForm: Messages["configForm"] = {
  cookieCheckStatus: {
    not_configured: () => "未配置 Cookie",
    ready_without_cookie: (site) => `${site} 影片页面可匿名访问，无需 Cookie`,
    ready_with_cookie: (site) => `${site} Cookie 有效`,
    invalid_or_expired: (site) => `${site} Cookie 无效或已过期`,
    verification_required: (site) => `${site} 需要年龄/地区验证，请在浏览器中完成验证后重新复制 Cookie`,
    login_wall: (site) => `检测到 ${site} 登录墙，当前 Cookie 无法访问影片内容`,
    unexpected_page: (site) => `${site} 未返回可识别的页面，请稍后重试`,
    request_failed: (site) => `${site} 请求失败`,
  },
  cookieCheckFailed: (site, error) => `${site} Cookie 验证失败: ${error}`,
  cookieCheckNoResult: "未找到验证结果",
  cookieCheckRequestFailed: "验证请求失败",
  verifying: "验证中...",
  verifyCookie: "验证 Cookie",
  selectOption: "选择选项",
  selectAll: "全选",
  selectNone: "全不选",
  chipArray: {
    noneSelected: "未选择可选字段",
    allSelected: (count) => `已选择 ${count} 个字段`,
    someSelected: (count, preview) => `已选择 ${count} 个字段 (${preview} 等)`,
    searchPlaceholder: "搜索字段...",
    selectedCount: (selected, total) => `已选 ${selected}/${total}`,
    noMatches: "无匹配字段",
    inputPlaceholder: "输入文本，按 Enter 或逗号添加...",
    empty: "暂无配置词汇",
  },
  orderedSite: {
    enabledCount: (enabled, total) => `已启用 ${enabled}/${total}`,
    moveUp: (label) => `上移 ${label}`,
    moveDown: (label) => `下移 ${label}`,
  },
  pathArray: {
    firstPlaceholder: "绝对路径或扫描目录下的子目录",
    remove: "移除目录",
    add: "添加目录",
  },
  secondsUnit: "秒",
};
