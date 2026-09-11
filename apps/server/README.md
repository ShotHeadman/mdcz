# MDCz Server

`@mdcz/server` is the single-port runtime for the browser WebUI. The production build ships a Node server entry, SQLite migrations, and the Vite WebUI static bundle.

## Build And Run

```bash
pnpm build:webui
cd apps/server
node dist/server.js
```

The server listens on `127.0.0.1:3838` by default and serves the WebUI from the same origin. Open `http://127.0.0.1:3838` after startup. Use `pnpm build:server` only when you need the Node server bundle without rebuilding or embedding the WebUI static files.

## Deploy (Docker — recommended for self-hosters)

Use the maintained [Compose file](../../compose.yaml) and [deployment guide](../../docker/README.md).
The image supports Linux amd64 and arm64, stores application state in `/data`, and uses `/media` for mounted movies.
The guide covers initialization, NAS permissions, health checks, proxying, backups, upgrades and offline recovery.

## Release Artifact

The GitHub release workflow uploads `mdcz-<version>.tar.gz` next to the Desktop installers. This is a lightweight no-Docker bundle: it does not include `node_modules` or a bundled Node runtime, so the first install stays small and compiles/downloads platform-specific native dependencies on the target machine.

The archive contains:

- `server.js` - Node server entrypoint;
- `web/` - bundled WebUI static files served by the server;
- `persistence/drizzle/` - SQLite migration files;
- `package.json` - runtime dependency manifest and `pnpm-lock.yaml` with `pnpm start`;
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
| `MDCZ_CONFIG_DIR` | Directory for TOML profiles and the hashed administrator credential. | `$MDCZ_HOME/config` |
| `MDCZ_DATA_DIR` | Directory for server data. | `$MDCZ_HOME/data` |
| `MDCZ_DATABASE_PATH` | SQLite database path. | `$MDCZ_DATA_DIR/mdcz.sqlite` |
| `MDCZ_ADMIN_PASSWORD` | Overrides the persisted single-admin password. Never persisted. | unset |
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

When `MDCZ_AUTOMATION_WEBHOOK_URL` is set, the server sends the same JSON payload when a task first enters `running` and when it first reaches `completed` or `failed`. Deliveries use one in-process FIFO per configured URL and a 10-second request timeout. They are best-effort notifications: the server does not persist an outbox, retry failed requests, or replay deliveries after a restart. Use `GET /api/automation/library/recent` to reconcile task state.

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
