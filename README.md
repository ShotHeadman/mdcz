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

```bash
pnpm install
pnpm dev
```

### 构建

```bash
pnpm build:win     # Windows
pnpm build:mac     # macOS (DMG)
pnpm build:linux   # Linux (AppImage)
```

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
