# MDCz Server

`@mdcz/server` is the single-port runtime for the browser WebUI. The production build ships a Node server entry, SQLite migrations, and the Vite WebUI static bundle.

## Build And Run

```bash
pnpm build:webui
cd apps/server
node dist/server.js
```

The server listens on `127.0.0.1:3838` by default and serves the WebUI from the same origin. Open `http://127.0.0.1:3838` after startup. Use `pnpm build:server` only when you need the Node server bundle without rebuilding or embedding the WebUI static files.

## Deploy (Docker - recommended for self-hosters)

```bash
docker run -d \
  --name mdcz \
  -p 3838:3838 \
  -v mdcz-data:/data \
  --restart unless-stopped \
  ghcr.io/shotheadman/mdcz:latest
```

The image (`linux/amd64` + `linux/arm64`) is published from `apps/server/Dockerfile` on every release. State persists in the `mdcz-data` volume (`/data`).

For bind mounts on Unraid, Synology, and other NAS systems, set the container
identity to the numeric owner of the host directories:

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

`PUID` and `PGID` default to `1000`; `UMASK` defaults to `022`. All three
values are optional. IDs must be positive decimal numbers and `UMASK` must be
an octal value from `0000` through `0777`. The image adjusts only the `/data`
mountpoint itself; it never recursively changes existing data or media
ownership. Ensure the host media tree is already accessible to the configured
identity. Docker `--group-add <gid>` can grant an additional host group when
required.

## Release Artifact

The GitHub release workflow uploads `mdcz-<version>.tar.gz` next to the Desktop installers. This is a lightweight no-Docker bundle: it does not include `node_modules` or a bundled Node runtime, so the first install stays small and compiles/downloads platform-specific native dependencies on the target machine.

The archive contains:

- `server.js` - Node server entrypoint;
- `web/` - bundled WebUI static files served by the server;
- `persistence/drizzle/` - SQLite migration files;
- `package.json` - minimal runtime dependency manifest with `npm start`;
- `.env.example` - deployment environment reference;
- `install.sh` / `install.ps1` - setup helpers that check for Node 24+, skip Node setup when it is already installed, create `.env` if needed, and install runtime dependencies;
- `start.sh` / `start.bat` - launchers that load `./.env` (POSIX) and apply defaults;
- `systemd/mdcz.service` - systemd unit template (edit `# REPLACE_ME` lines);
- `README.md` - end-user deployment guide (Docker -> portable -> systemd).

Extract the archive, run the setup helper once, then start:

```bash
tar -xzf mdcz-<version>.tar.gz
cd mdcz-<version>
./install.sh
./start.sh
```

Windows users run `.\install.ps1` and then `.\start.bat`.

For the systemd / AUR / Deb path, see the bundled `README.md` and `systemd/mdcz.service`.

## Runtime Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port. | `3838` |
| `MDCZ_HOST` | Bind address for the HTTP listener. Set to `0.0.0.0` to expose to the network (the Docker image already does this). | `127.0.0.1` |
| `MDCZ_HOME` | Base directory for server config and data. | Linux: `$XDG_STATE_HOME/mdcz` or `~/.local/state/mdcz`; other platforms: `~/.mdcz` |
| `MDCZ_CONFIG_DIR` | Directory for TOML profiles and auth state. | `$MDCZ_HOME/config` |
| `MDCZ_DATA_DIR` | Directory for server data. | `$MDCZ_HOME/data` |
| `MDCZ_DATABASE_PATH` | SQLite database path. | `$MDCZ_DATA_DIR/mdcz.sqlite` |
| `MDCZ_ADMIN_PASSWORD` | Overrides the persisted single-admin password. | unset |
| `MDCZ_WEB_DIST_DIR` | Static WebUI bundle directory. | `dist/web` in repo builds, `web` in release bundles |
| `MDCZ_SERVER_BUILD` | Optional build label shown on About. | unset |
| `MDCZ_WEB_BUILD` | Optional Web build label shown on About. | unset |
| `MDCZ_AUTOMATION_WEBHOOK_URL` | Optional outbound automation webhook URL. | unset |
| `MDCZ_AUTOMATION_WEBHOOK_SECRET` | Optional value sent as `x-mdcz-webhook-secret` on outbound webhooks. | unset |

## Automation REST

Automation endpoints use the same single-admin bearer token as the WebUI:

```bash
Authorization: Bearer <token>
```

- `POST /api/automation/scrape/start` starts a scrape from `refs` or a scan from `rootId`.
- `GET /api/automation/library/recent?limit=20` returns recent task webhook payloads.
- `GET /api/automation/webhooks/status` returns outbound webhook delivery status.

Webhook payload shape:

```json
{
  "taskId": "task-id",
  "kind": "scan",
  "status": "completed",
  "startedAt": "2026-05-01T00:00:00.000Z",
  "completedAt": "2026-05-01T00:01:00.000Z",
  "summary": "扫描 Media: completed",
  "errors": []
}
```

When `MDCZ_AUTOMATION_WEBHOOK_URL` is set, task updates are also delivered to that URL with the same JSON payload.

## Reverse Proxy

Terminate TLS at the proxy and forward one origin to the Node server:

```nginx
location / {
  proxy_pass http://127.0.0.1:3838;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

For task updates, keep SSE buffering disabled:

```nginx
location /events/tasks {
  proxy_pass http://127.0.0.1:3838;
  proxy_buffering off;
  proxy_set_header Connection "";
}
```
