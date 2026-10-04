<p align="center">
  中文 | <a href="README_EN.md">English</a>
</p>

<p align="center">
  <img src="apps/desktop/build/icon.png" width="96" alt="MDCz" />
</p>

<h1 align="center">MDCz</h1>

<p align="center">
  <strong>高效、现代的影片元数据刮削与媒体库管理工具</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-39-47848F.svg?style=flat&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-61DAFB.svg?style=flat&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/pnpm-10-F69220.svg?style=flat&logo=pnpm&logoColor=white" alt="pnpm" />
  <img src="https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat" alt="License" />
  <a href="https://linux.do"><img src="https://img.shields.io/badge/LINUXDO-社区讨论-0086c9?style=flat" alt="LINUXDO" /></a>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/f67aecee-d960-4bb8-9442-d90da9f351a3" width="92%" alt="MDCz 概览" />
</p>

---

## MDCz 是什么？

MDCz 是一款现代化的本地影片元数据刮削与整理工具。

配合 Emby、Jellyfin 等媒体库管理软件，通过智能识别影片番号或文件名，自动抓取多站点的元数据、高清封面、剧照及演职员信息，生成标准化 NFO 文件，并自动规范化重命名与归类本地影片。

---

## 核心功能

- **多站点聚合刮削** — 支持 DMM、FC2、AVBase、AVWikiDB、JavBus、JavDB、MGStage、Prestige 等主流数据源
- **双端支持** — 提供开箱即用的跨平台桌面客户端与轻量 WebUI / Docker 自托管方案
- **演员别名归一** — 支持自定义演员名称映射，将不同来源的别名自动合并为标准规范名
- **Emby / Jellyfin 深度集成** — 自动同步人物头像、生成规范 NFO 文件及多级剧照
- **多媒体格式兼容** — 完善支持分段影片（CD1/CD2/Part）、STRM 流媒体文件及外挂字幕文件关联移动
- **批量工作台** — 具备可视化批量任务队列与执行前变更对比（Diff Preview）
- **实用工具箱** — 提供重名查重、规则重命名及媒体库数据维护能力

---

## 下载与安装

### 桌面客户端

前往 [Releases](https://github.com/ShotHeadman/mdcz/releases) 下载对应文件：

| 文件 | 适用于 | 自动更新 | 数据目录 |
|---|---|---|---|
| `MDCz-<版本>-win-x64-setup.exe` | Windows 10 及以上，**推荐** | 应用内下载，重启后安装 | `%APPDATA%\mdcz` |
| `MDCz-<版本>-win-x64-portable.zip` | Windows 便携版，解压即用 | 提示新版本，需手动下载替换 | 程序目录下的 `data\` |
| `MDCz-<版本>-mac-arm64.dmg` | macOS Apple Silicon（不提供 Intel 版） | 提示新版本，需手动下载替换 | `~/Library/Application Support/mdcz` |
| `MDCz-<版本>-linux-x86_64.AppImage` | Linux x64 | 应用内下载，重启后安装 | `~/.config/mdcz` |

便携版的配置、数据库和日志都在 `data\` 里，升级时保留这个文件夹，替换其余文件即可。

> [!NOTE]
> 应用没有代码签名，首次运行时系统会拦截：
> - **Windows** 提示「Windows 已保护你的电脑」：点「更多信息」→「仍要运行」。
> - **macOS** 提示「已损坏，无法打开」：把 MDCz 拖进「应用程序」后，在终端执行 `xattr -cr /Applications/MDCz.app`。
> - **Linux**：先执行 `chmod +x MDCz-*.AppImage` 再运行。

### Docker 部署（推荐 NAS / 服务器）

推荐使用仓库提供的 [compose.yaml](compose.yaml) 进行部署，详细步骤请参考 [Docker 部署与维护指南](docker/README.md)。

- **快速上手**：将配置模板复制为 `.env`，填写真实版本号与媒体路径后，执行 `docker compose up -d` 即可启动。
- **首次访问**：浏览器打开 `http://<服务器IP>:3838`（默认绑定 `127.0.0.1`，NAS 局域网访问请在 `.env` 中调整绑定 IP）。系统无默认密码，首次访问直接按提示设置管理员密码，随后即可在设置中添加媒体库。

### WebUI 压缩包（不使用 Docker）

Releases 中的 `mdcz-<版本>.tar.gz` 可直接在装有 Node.js >= 24 的机器上运行，安装和启动方式见包内 README。

### 源码运行

环境准备与开发命令见 [CONTRIBUTING.md](CONTRIBUTING.md)。


---

## 界面预览

| 刮削结果 | 剧照和预告片 |
| :---: | :---: |
| <img src="https://github.com/user-attachments/assets/c4a46270-710f-4ca8-a0aa-a7c93c583b67" width="100%" alt="刮削结果" /> | <img src="https://github.com/user-attachments/assets/4a98023b-f935-4ff4-b3c1-115995d44f4e" width="100%" alt="剧照和预告片" /> |

> [!TIP]
> 这里使用奥德赛的相关信息只是为了演示，大家都知道这个软件暂时获取不了正经电影的这些信息。

---

## 注意事项

> [!WARNING]
> 本项目处于活跃迭代阶段。核心刮削与整理功能已就绪，部分高级设置项仍在完善中。遇到异常欢迎提交 [Issue](https://github.com/ShotHeadman/mdcz/issues)。

> [!IMPORTANT]
> **网络环境提示**：不同数据源存在地域访问限制。例如 DMM 仅支持日本 IP，部分站点会屏蔽特定代理。请根据目标数据源在网络设置中配置合适的代理分流规则。

---

## 上游与致谢

- 上游项目：[MDCx](https://github.com/sqzw-x/mdcx)，感谢原作者的卓越贡献。

---

## 授权许可

本项目采用 GPLv3 开源协议。使用本项目即代表同意以下条款：

- 本项目仅供技术研究与个人交流使用。
- 请勿在公共社交平台大范围传播或商业化。
- 使用过程中请严格遵守当地法律法规，用户自行承担法律责任及后果。

---

<p align="center">
  <a href="https://github.com/ShotHeadman/mdcz/issues">问题反馈</a> · <a href="https://linux.do">LINUXDO 社区</a>
</p>
