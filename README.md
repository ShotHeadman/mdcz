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

## 平台支持

| 平台 | 形式 | 运行要求 |
|---|---|---|
| Windows | 桌面客户端 (.exe) | Windows 10 及以上 |
| macOS | 桌面客户端 (.dmg) | Apple Silicon / Intel |
| Linux | 桌面客户端 (.AppImage) | 主流 Linux 发行版 |
| NAS / 服务器 | Docker / WebUI | Docker 引擎 / Node.js >= 24 |

---

## 快速开始

### 桌面客户端

前往 [Releases](https://github.com/ShotHeadman/mdcz/releases) 页面下载对应系统的安装包直接运行。

### Docker 部署（推荐 NAS / 服务器）

#### Docker Run

```bash
docker run -d \
  --name mdcz \
  -p 3838:3838 \
  -e PUID=1000 \
  -e PGID=1000 \
  -e UMASK=022 \
  -v /path/to/data:/data \
  -v /path/to/media:/media \
  --restart unless-stopped \
  ghcr.io/shotheadman/mdcz:latest
```

#### Docker Compose

```yaml
services:
  mdcz:
    image: ghcr.io/shotheadman/mdcz:latest
    container_name: mdcz
    restart: unless-stopped
    ports:
      - "3838:3838"
    environment:
      - PUID=1000
      - PGID=1000
      - UMASK=022
    volumes:
      - ./data:/data
      - /path/to/media:/media
```

运行后在浏览器访问 `http://localhost:3838`。

> [!TIP]
> **权限说明**：通过 `PUID`、`PGID` 与 `UMASK` 对齐宿主机权限（默认 `1000`、`1000`、`022`）。容器仅调整 `/data` 挂载点自身，不会递归修改已有文件所有权。如需补充从属组权限可使用 Docker `--group-add <gid>` 参数。

### 源码运行

```bash
pnpm install
pnpm dev:webui      # 启动 WebUI 模式
pnpm dev:desktop    # 启动桌面端模式
```


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
- 社区讨论：[LINUXDO](https://linux.do)。

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
