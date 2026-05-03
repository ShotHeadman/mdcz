# MDCz Server

`@mdcz/server` is the single-port runtime for the browser WebUI. The production build ships a Node server entry, SQLite migrations, and the Vite WebUI static bundle.

## Build And Run

```bash
pnpm build:server
cd apps/server
node dist/server.js
```

The server listens on `127.0.0.1:3838` by default and serves the WebUI from the same origin. Open `http://127.0.0.1:3838` after startup.

## Runtime Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port. | `3838` |
| `MDCZ_HOME` | Base directory for server config and data. | Linux: `$XDG_STATE_HOME/mdcz` or `~/.local/state/mdcz`; other platforms: `~/.mdcz` |
| `MDCZ_CONFIG_DIR` | Directory for TOML profiles and auth state. | `$MDCZ_HOME/config` |
| `MDCZ_DATA_DIR` | Directory for server data. | `$MDCZ_HOME/data` |
| `MDCZ_DATABASE_PATH` | SQLite database path. | `$MDCZ_DATA_DIR/mdcz.sqlite` |
| `MDCZ_ADMIN_PASSWORD` | Overrides the persisted single-admin password. | unset |
| `MDCZ_WEB_DIST_DIR` | Static WebUI bundle directory. | `dist/web` |
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
