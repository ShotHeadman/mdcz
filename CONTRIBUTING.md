# 开发

## 环境准备

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10+

## 安装与启动

```bash
git clone https://github.com/ShotHeadman/mdcz.git
cd mdcz
pnpm install
pnpm dev
```

## 测试

```bash
pnpm test
```

## 代码风格

使用 [Biome](https://biomejs.dev/) 进行格式化和代码检查：

```bash
pnpm format
```

## 类型检查

```bash
pnpm typecheck
```

## 代码结构

```
apps/desktop/src/
├── main/                # Electron 主进程
│   ├── ipc/             # IPC 通信路由
│   ├── services/        # 业务逻辑
│   │   ├── crawler/     # 各网站爬虫
│   │   ├── scraper/     # 刮削服务
│   │   ├── config/      # 配置管理
│   │   ├── emby/        # Emby 集成
│   │   └── network/     # HTTP 客户端
│   └── utils/           # 工具函数
├── preload/             # Electron preload 脚本
├── renderer/src/        # React 前端
│   ├── routes/          # 页面组件
│   ├── components/      # 可复用 UI 组件
│   ├── store/           # Zustand 状态管理
│   └── client/          # IPC 客户端
└── types/               # Desktop-only TypeScript 类型

packages/
├── shared/              # 跨进程共享代码
├── client/              # 客户端 DTO/contract 类型
├── storage/             # 挂载文件系统与媒体根路径
├── persistence/         # Drizzle/SQLite 持久化
└── core/                # 后续抽离的领域工作流逻辑
```
