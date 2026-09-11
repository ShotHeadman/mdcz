# Docker 部署与维护

推荐使用仓库根目录提供的 `compose.yaml` 进行部署。镜像支持 Linux amd64 与 arm64 架构；服务内置 SQLite 数据库，无需额外部署 MySQL / PostgreSQL 等数据库容器。

## 首次部署

1. 将仓库根目录的 `compose.yaml` 复制到部署目录，并在同级目录下将 `docker/compose.env.example` 复制命名为 `.env`。
2. 编辑 `.env` 文件：
   - 前往项目 [Releases](https://github.com/ShotHeadman/mdcz/releases) 页面查看最新版本号并填入 `MDCZ_VERSION`（例如 `0.15.0`，注意不要带 `v` 前缀）。
   - 填写宿主机上真实的影片目录绝对路径 `MDCZ_MEDIA_PATH`。
   - 配置目录所有者的数字用户与组 ID（`PUID`、`PGID`，可在宿主机终端运行 `id` 命令获取）。
   - 若在 NAS 或局域网服务器部署，建议将 `MDCZ_BIND_IP` 改为 `0.0.0.0` 或 NAS 的局域网 IP。
3. 创建数据存放目录（默认命令 `mkdir -p ./data`）。为防止因路径手误拼错而挂载出空目录，Compose 默认不会自动创建不存在的宿主机挂载目录。
4. 启动服务并查看日志：

```sh
docker compose up -d
docker compose logs -f mdcz
```

5. 在浏览器中打开 `http://<服务器IP>:3838`。首次访问时，直接设置管理员密码即可完成初始化。密码无特殊字符或长度限制，系统没有默认 `admin` 密码。
6. 登录后进入系统设置添加媒体库。

> [!IMPORTANT]
> **媒体库路径填写提示**：在 WebUI 设置中添加媒体库时，**必须填写容器内映射的路径**（例如 `/media` 或 `/media/movies`），切勿填写宿主机的物理路径（如群晖的 `/volume1/...` 或 Unraid 的 `/mnt/user/...`）。

> [!TIP]
> **关于环境变量密码**：如果你希望跳过网页初始化、直接在容器启动时指定管理员密码，可以在 `.env` 中取消注释并配置 `MDCZ_ADMIN_PASSWORD`。该环境变量优先级高于网页设置的密码，且不会写入磁盘文件。

## 持久化与权限

| 容器路径 | 用途 |
| --- | --- |
| `/data/config` | 配置文件目录：存放 TOML 规则档案及管理员密码哈希（`auth-state.json`） |
| `/data/data` | 运行数据目录：存放 SQLite 数据库、任务记录与运行缓存 |
| `/media` | 媒体挂载目录：挂载宿主机上的影片文件夹 |

- **账号凭据安全**：管理员密码以加盐哈希（scrypt）的形式安全保存在 `auth-state.json`（文件权限为 `0600`）。管理员账号一旦设置便长期有效，即使媒体库中没有任何影片或被清空，也不会重新要求注册。
- **旧版本明文凭据说明**：旧版本明文格式的认证文件不做自动迁移。从旧版升级前，请先停止服务并备份数据，删除旧的 `auth-state.json` 后启动，随后在网页上重新设置管理员密码即可（这不会影响数据库与已有影片）。
- **用户权限（PUID / PGID）**：容器启动时会自动降权为你指定的 `PUID`/`PGID` 用户（默认 1000:1000）运行，确保 MDCz 生成的刮削海报与 NFO 文件在宿主机上能被正常读写。创建文件的掩码默认为 `UMASK=022`；若共享文件夹组内需要写权限，可设置为 `002`。
  - **注意**：容器不会递归修改宿主机上已有媒体文件的所有权。请确保宿主机上的媒体目录对所配置的 `PUID`/`PGID` 用户具备读写权限。若需补充宿主机用户组，可利用 Compose 的 `group_add` 参数。
  - 若你希望完全不使用 root 引导，也可以在 Compose 中直接声明 `user: "1026:100"`，此时环境中的 `PUID`/`PGID` 必须与之保持一致。
- **数据库存储位置限制**：运行中的 SQLite 数据库（`mdcz.sqlite`）**必须存放在宿主机的本地硬盘上**（NAS 本地的存储池属于本地磁盘，可放心使用）。**切勿将数据目录挂载在远程 NFS / SMB 网络共享上**，因为网络文件系统不支持 SQLite 严格的文件锁机制，极易导致数据库损坏。同目录下的 `.lock.sqlite` 是防多实例并发写入锁，正常退出后由系统自动释放，请勿手动删除。
- **文件自动整理建议**：如果你的工作流包含自动整理（将未刮削的影片移动到整理库），强烈建议将“下载目录”与“影片库目录”挂载在同一个 `/media` 目录下（如 `/media/downloads` 和 `/media/movies`）。如果是跨挂载卷移动，系统底层无法实现秒级的原子移动，而会触发耗时的全量文件拷贝；软链接与硬链接也要求路径在同一个容器卷内可解析。

## 健康检查与诊断

- `/health`：仅检查 HTTP 服务进程是否存活。
- `/ready`：检查数据库连接是否可用（镜像默认以此作为健康检查依据），不探测外部刮削网站。
- 注意：Docker 的健康状态仅供监控，不会自动重启容器；容器的自动拉起由 `restart: unless-stopped` 策略在进程异常退出时代为处理。

常用排错命令：

```sh
# 查看容器状态与健康情况
docker compose ps

# 查看实时运行日志
docker compose logs --tail=200 -f mdcz

# 运行自检工具（检查数据库路径、SQLite 版本、数据完整性及外键约束）
docker compose exec mdcz docker-entrypoint.sh node server.js doctor
```

`doctor` 命令仅输出系统自检状态，不会暴露密码或任何敏感配置。当容器处于停止状态时，也可通过独立容器运行自检：

```sh
docker compose run --rm --no-deps mdcz node server.js doctor
```

**优雅停机机制**：当执行 `docker compose stop` 时，程序会在 25 秒的缓冲期内依次平滑关闭前端推送长连接、中止正在执行的任务并安全断开数据库连接（Compose 预留了 30 秒停机缓冲）。若发生超时强制退出，下次启动时会自动恢复中断的任务。

## 备份与恢复

### 1. 数据库热备份（服务运行中直接备份）

```sh
docker compose exec mdcz docker-entrypoint.sh node server.js database backup /data/backups/manual.sqlite
docker compose exec mdcz docker-entrypoint.sh node server.js database verify /data/backups/manual.sqlite
```

备份命令基于 SQLite 官方 Backup API，可安全生成一致的快照副本。
> [!WARNING]
> **切勿在运行中直接 `cp` 拷贝数据库**：由于 SQLite 采用 WAL（预写日志）模式，在服务运行期间直接复制 `mdcz.sqlite` 主文件会导致数据不一致甚至损坏，请务必使用官方命令热备份。注意备份目标路径必须是一个尚未存在的新文件。

### 2. 完整整机备份（最推荐）
停止服务后，将宿主机上的整个数据持久化目录（即 `./data` 目录，包含 `config` 与 `data`）打包备份到其他独立的存储介质。仅备份数据库不包含账号凭据（`auth-state.json`）与自定义 TOML 配置。

### 3. 恢复数据库（需先停止服务）

```sh
# 1. 停止容器服务
docker compose stop mdcz

# 2. 执行恢复命令（必须带有 --confirm 参数）
docker compose run --rm --no-deps mdcz node server.js database restore /data/backups/manual.sqlite --confirm

# 3. 重新启动服务
docker compose up -d
```

恢复程序会自动校验备份文件的完整性与 MDCz 表结构，并在覆盖前**先将当前旧数据库自动备份为 `*.before-restore-*.sqlite`**。
注意：数据库恢复仅还原刮削历史、元数据与任务状态，**不会撤销或回滚磁盘上已经移动、重命名或生成的影片文件及海报**。

## 升级与版本

1. 停止当前服务：`docker compose stop mdcz`。
2. 备份数据持久化目录。
3. 修改 `.env` 中的 `MDCZ_VERSION` 为新版本号。
4. 拉取新镜像并启动：`docker compose pull && docker compose up -d`。
5. 查看日志与容器状态：`docker compose logs -f mdcz`。

> [!NOTE]
> 服务启动时会自动执行增量数据库迁移。如果升级后需要降级回滚，必须同时恢复升级前匹配的数据库备份，仅切换旧镜像可能因数据库结构向前不兼容而报错。生产部署建议锁定具体的版本号，避免使用 `latest` 引起非预期的破坏性更新。

## 反向代理与网络设置

如果需要通过 Nginx 反向代理访问 MDCz，可参考以下配置：

```nginx
location / {
  proxy_pass http://127.0.0.1:3838;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}

# SSE 实时任务事件流（必须禁用缓冲并保持长连接）
location /events/tasks {
  proxy_pass http://127.0.0.1:3838;
  proxy_http_version 1.1;
  proxy_buffering off;
  proxy_read_timeout 90s;
  proxy_set_header Host $host;
  proxy_set_header Connection "";
}
```

上述配置适用于 Nginx 部署在宿主机上的场景。如果 Nginx 同样运行在 Docker 容器中，请将它们接入同一个 Docker 网络，并将代理目标设置为 `http://mdcz:3838`。

> [!WARNING]
> **外部刮削代理配置注意**：如果在 WebUI 的网络设置中配置刮削代理（HTTP / SOCKS5），**请勿填写 `127.0.0.1` 或 `localhost`**（在容器内部它指向容器自己，无法访问到宿主机上的代理软件）。请填写宿主机的真实局域网 IP（例如 `http://192.168.1.100:7890`）或局域网中代理服务器的实际 IP。

