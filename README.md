# <img src="apps/desktop/build/icon.png" width="28"> MDCz

![Electron](https://img.shields.io/badge/Electron-39-47848F.svg?style=flat&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB.svg?style=flat&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?style=flat&logo=typescript&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220.svg?style=flat&logo=pnpm&logoColor=white)

高效、现代的影片元数据刮削与管理工具。

配合 Emby、Jellyfin 等本地媒体库管理软件，通过识别影片识别码（番号）自动抓取元数据、封面、缩略图等信息，供本地影片分类整理使用。

## 功能

- 多站点元数据刮削（DMM、FC2 等）
- Emby 演员信息同步
- NFO 文件生成
- 批量处理
- 影片文件自动归类整理

## 快速开始

### 下载使用

WebUI / 自托管用户推荐使用 Docker：

```bash
docker run -d \
  --name mdcz \
  -p 3838:3838 \
  -v mdcz-data:/data \
  --restart unless-stopped \
  ghcr.io/shotheadman/mdcz:latest
```

打开 `http://localhost:3838`。如需不用 Docker，可下载 `mdcz-<version>.tar.gz`，安装 Node.js 24 或更新版本。解压后运行安装脚本；

NAS bind mount 可通过 `PUID`、`PGID` 与 `UMASK` 对齐宿主机权限（默认值分别为
`1000`、`1000`、`022`）：

```bash
docker run -d \
  --name mdcz \
  -p 3838:3838 \
  -e PUID=1026 \
  -e PGID=100 \
  -e UMASK=002 \
  -v /volume1/docker/mdcz:/data \
  -v /volume1/media:/media \
  --restart unless-stopped \
  ghcr.io/shotheadman/mdcz:latest
```

容器只会调整 `/data` 挂载点本身，不会递归修改已有数据，也不会修改 `/media`
的所有权。媒体目录应预先授予对应用户或用户组访问权限；需要补充组时可使用
Docker 的 `--group-add <gid>`。

```bash
tar -xzf mdcz-<version>.tar.gz
cd mdcz-<version>
./install.sh
./start.sh
```

Windows 使用：

```powershell
.\install.ps1
.\start.bat
```

### 本地开发

```bash
pnpm install
pnpm dev:webui
```

### 构建

```bash
pnpm build:win     # Windows
pnpm build:mac     # macOS (DMG)
pnpm build:linux   # Linux (AppImage)
```

## 演员别名

在 active profile 的 TOML 中加入以下配置，可将不同来源的演员写法统一为一个规范名称。规范名称必须使用引号；每行是一个独立的演员组：

```toml
[personSync.actorAliases]
"河北彩花" = ["河北彩伽", "河北彩花（河北彩伽）"]
"三上悠亚" = ["鬼頭桃菜", "鬼头桃菜"]
```

新刮削会以键名输出演员、`{actor}` 路径和 NFO 名称，同时保留原始写法为人物资料别名，用于头像和资料查询。修改 active profile 文件后，请重启 Desktop 或 Server；也可以通过导入或切换 profile 使配置重新加载。已有影片和 NFO 不会被自动重命名。

## 注意事项

> [!WARNING]
> 本项目仍处于活跃迭代阶段。当前刮削核心功能已就绪，部分高级设置项仍在测试完善中。如遇异常，欢迎提交 [Issue](https://github.com/ShotHeadman/mdcz/issues) 进行反馈。

> [!IMPORTANT]
> **网络环境提示**：不同数据源存在地域访问限制。例如 DMM 仅支持日本 IP，而部分站点可能会屏蔽特定地区的代理。请根据目标数据源，配置合适的代理节点及分流规则。

## 上游项目

[MDCx](https://github.com/sqzw-x/mdcx)，感谢原作者的卓越贡献。

## 授权许可

本项目采用 GPLv3 开源协议。使用本项目即代表您同意以下条款：

- 本项目仅供技术研究与交流使用。
- 请勿在公共社交平台大范围传播或商业化。
- 使用过程中请严格遵守当地法律法规，用户需自行承担法律责任及后果。

## 预览截图

<img width="2560" height="1536" alt="overview" src="https://github.com/user-attachments/assets/f67aecee-d960-4bb8-9442-d90da9f351a3" />
<img width="2560" height="1536" alt="workbench" src="https://github.com/user-attachments/assets/e859b0c0-09f8-44d3-ab95-226acdab58cf" />
<img width="2560" height="1536" alt="tools" src="https://github.com/user-attachments/assets/4562e899-c250-49ae-ab01-8a059645502e" />
<img width="2560" height="1536" alt="settings" src="https://github.com/user-attachments/assets/01f1d2bd-c58c-4525-9ddd-dc262ff51cc6" />

## 友情链接

[![LINUXDO](https://img.shields.io/badge/%E7%A4%BE%E5%8C%BA-LINUXDO-0086c9?style=for-the-badge&labelColor=555555)](https://linux.do)
