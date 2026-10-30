# Docker 部署与维护指南

MDCz 官方提供多架构 Docker 镜像（支持 Linux x86_64 / amd64 与 ARM64），内置轻量 SQLite 数据库，开箱即用，无需额外配置 MySQL 或 PostgreSQL。

---

## 快速上手

### 1. 编写配置文件
推荐新建一个专属目录（例如 `~/mdcz` 或群晖上的 `/volume1/docker/mdcz`），并在该目录下创建 `docker-compose.yml`：

```yaml
services:
  mdcz:
    # 请前往 Releases 页面查看最新版本号（例如 0.15.0，不要带 v）
    image: ghcr.io/shotheadman/mdcz:0.15.0
    container_name: mdcz
    restart: unless-stopped
    stop_grace_period: 30s
    ports:
      # 0.0.0.0 允许局域网设备访问，若仅允许本机访问可改为 127.0.0.1:3838:3838
      - "0.0.0.0:3838:3838"
    environment:
      # 建议设置为媒体目录所有者的数字用户与组 ID（在宿主机运行 id 命令查看）
      PUID: 1000
      PGID: 1000
      UMASK: 022
      # 【可选】直接指定管理员密码（留空则首次打开网页时设置）
      # MDCZ_ADMIN_PASSWORD: ""
    volumes:
      # 数据目录：存放数据库、配置文件与刮削记录
      - ./data:/data
      # 媒体目录：请修改为宿主机真实的影片存放路径（必须已存在）
      - /volume1/video:/media
    logging:
      driver: local
      options:
        max-size: "10m"
        max-file: "3"
```

> [!TIP]
> **喜欢使用 `.env` 环境变量解耦？**  
> 仓库根目录提供了标准版 [`compose.yaml`](file:///home/doublechu/Documents/mdcz/compose.yaml) 与 [`docker/compose.env.example`](file:///home/doublechu/Documents/mdcz/docker/compose.env.example)，可将其复制到部署目录并重命名为 `.env` 进行分离配置。

---

### 2. 启动服务与访问

在 `docker-compose.yml` 所在目录执行：

```sh
# 创建数据存储目录（请确保此目录与媒体目录在宿主机上均已存在）
mkdir -p ./data

# 启动容器
docker compose up -d

# 查看实时日志
docker compose logs -f mdcz
```

1. **打开网页**：浏览器访问 `http://<服务器或NAS的IP>:3838`。
2. **初始化**：首次访问直接输入密码，即可完成管理员账号初始化。
3. **添加媒体库**：登录后在【设置】->【媒体库】中添加影片目录。

---

## NAS 用户避坑指南（必读）

1. **媒体库路径填写规则（最常见错误）**：  
   在 WebUI 设置中添加媒体库时，**必须填写容器内部映射的路径**（如 `/media` 或 `/media/movies`），**千万不要**填写宿主机的物理路径（如 `/volume1/video` 或 `/mnt/user/...`）。
2. **局域网连不上 Web 界面**：  
   如果打不开 `http://<IP>:3838`，检查端口映射是否写成了 `127.0.0.1:3838:3838`（仅允许宿主机访问）。NAS / 家庭服务器请务必写为 `0.0.0.0:3838:3838`。
3. **文件权限与刮削失败（PUID / PGID）**：  
   容器启动后会自动降权运行。请在宿主机终端输入 `id` 查看你当前用户的数字 ID，并将 `PUID` 和 `PGID` 填入配置，确保容器有权限在宿主机的媒体文件夹中创建海报与 `.nfo` 文件。
4. **网页中设置刮削网络代理**：  
   若在 WebUI【系统设置 -> 网络代理】中配置代理（HTTP / SOCKS5），**严禁填写 `127.0.0.1`**。容器内的 `127.0.0.1` 指向容器本身，请填写宿主机或软路由在局域网中的真实 IP（例如 `http://192.168.1.100:7890`）。
5. **秒级整理建议**：  
   如果启用自动整理功能，建议把“下载目录”和“归档影片库”放在**同一个挂载卷**下（例如映射宿主机 `/volume1/media` 到容器 `/media`，内部划分为 `/media/downloads` 和 `/media/movies`）。跨挂载卷移动无法秒级完成，而会变成漫长耗时的全量拷贝。
6. **数据库存储限制**：  
   数据目录（`/data`）内置 SQLite 数据库，**必须存放在本地物理磁盘或本地存储池**，切勿挂载在远程 SMB / NFS 网络共享文件夹上，否则极易发生文件锁失效导致数据库损坏。

---

## 日常管理与更新

### 常用命令
```sh
# 查看容器状态与健康情况
docker compose ps

# 查看最近 200 行日志
docker compose logs --tail=200 -f mdcz

# 重启服务
docker compose restart mdcz

# 停止服务
docker compose stop mdcz
```

### 备份与迁移（最推荐）
停止容器后，将宿主机上的数据目录（即 `./data`）整体打包即可完成全量备份：
```sh
docker compose stop mdcz
tar -czvf mdcz-backup-$(date +%Y%m%d).tar.gz ./data
docker compose up -d
```
> `./data` 中包含登录账号凭据、自定义 TOML 规则、SQLite 数据库及任务缓存。恢复时只需解压回原处并启动容器。

### 版本升级
1. 前往 [Releases 页面](https://github.com/ShotHeadman/mdcz/releases) 确认最新版本号。
2. 修改 `docker-compose.yml`（或 `.env`）中的版本号。
3. 执行更新：
   ```sh
   docker compose pull
   docker compose up -d
   ```
> 容器启动时会自动处理增量数据库升级迁移。

---

## 高级运维与进阶配置

<details>
<summary><strong>1. 系统体检命令 (Doctor)</strong></summary>

MDCz 内置了体检工具，可快速检查数据库路径、SQLite 版本、数据完整性及外键约束：

```sh
# 容器运行中执行
docker compose exec mdcz docker-entrypoint.sh node server.js doctor

# 容器已停止时执行
docker compose run --rm --no-deps mdcz node server.js doctor
```
若输出中 `"healthy": true` 表示系统与数据状态良好。
</details>

<details>
<summary><strong>2. 数据库在线热备份与还原 (CLI)</strong></summary>

除了直接复制 `./data` 目录外，你也可以在**容器不停止运行**的情况下安全热备份数据库（基于 SQLite Backup API）：

```sh
# 热备份数据库（目标文件必须是不存在的新路径）
docker compose exec mdcz docker-entrypoint.sh node server.js database backup /data/backups/manual.sqlite

# 校验备份文件完整性
docker compose exec mdcz docker-entrypoint.sh node server.js database verify /data/backups/manual.sqlite
```

**还原数据库**（需停止服务）：
```sh
docker compose stop mdcz
docker compose run --rm --no-deps mdcz node server.js database restore /data/backups/manual.sqlite --confirm
docker compose up -d
```
> 还原程序会在覆盖前自动将现有数据库保留为 `*.before-restore-*.sqlite` 备份副本。注意数据库还原不会修改或回滚磁盘上已移动的文件或海报。
</details>

<details>
<summary><strong>3. 跨版本异常：数据库重建</strong></summary>

若跨越多个旧版本升级遇到数据库无法自动升级报错，可执行强制重建命令：

```sh
docker compose stop mdcz
docker compose run --rm --no-deps mdcz node server.js database rebuild /data/data/mdcz.sqlite --confirm
docker compose up -d
```
> 重建会将旧库备份为 `mdcz.sqlite.bak-*`，并初始化全新数据库；管理员账号与配置均会保留，媒体库重新扫描即可重新建立索引。
</details>

<details>
<summary><strong>4. 反向代理配置 (Nginx / SSE 实时任务流)</strong></summary>

若使用 Nginx 反向代理，**必须对任务流接口禁用缓冲**，否则前端无法实时获取扫描与刮削进度推送：

```nginx
# 主站点反代
location / {
    proxy_pass http://127.0.0.1:3838;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# SSE 任务事件流（必须禁用缓冲）
location /events/tasks {
    proxy_pass http://127.0.0.1:3838;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 90s;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
}
```
</details>
