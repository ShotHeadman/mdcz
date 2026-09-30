<p align="center">
  <a href="README.md">中文</a> | English
</p>

<p align="center">
  <img src="apps/desktop/build/icon.png" width="96" alt="MDCz" />
</p>

<h1 align="center">MDCz</h1>

<p align="center">
  <strong>Efficient, modern media metadata scraping and organization system</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-39-47848F.svg?style=flat&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-61DAFB.svg?style=flat&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/pnpm-10-F69220.svg?style=flat&logo=pnpm&logoColor=white" alt="pnpm" />
  <img src="https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat" alt="License" />
  <a href="https://linux.do"><img src="https://img.shields.io/badge/LINUXDO-Discussion-0086c9?style=flat" alt="LINUXDO" /></a>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/f67aecee-d960-4bb8-9442-d90da9f351a3" width="92%" alt="MDCz Overview" />
</p>

---

## What is MDCz?

MDCz is a modern media metadata scraping and organization tool for local video collections.

Designed to work seamlessly alongside Emby, Jellyfin, and local media libraries, MDCz automatically identifies movie codes/IDs, fetches rich metadata, covers, backdrops, and actor profiles from multiple provider sites, generates standard NFO files, and neatly categorizes files into standardized directory structures.

---

## Features

- **Multi-Provider Scraping** — Aggregated scraping support for DMM, FC2, AVBase, AVWikiDB, JavBus, JavDB, MGStage, Prestige, and more
- **Dual Form Factors** — Cross-platform desktop application and lightweight Docker self-hosted WebUI
- **Actor Alias Normalization** — Merge disparate naming variants from different sources into unified canonical actor names
- **Emby / Jellyfin Integration** — Automated actor headshot synchronization, standardized NFO generation, and backdrop fetching
- **Media Format Support** — Robust handling of multipart videos (CD1/CD2/Part), STRM streaming files, and sidecar subtitles
- **Batch Workbench** — Visual task queue management with pre-execution diff preview
- **Utility Tools** — Duplicate scanning, filename formatting, and media maintenance utilities

---

## Download & Install

### Desktop Application

Download the file for your system from [Releases](https://github.com/ShotHeadman/mdcz/releases):

| File | For | Auto-update | Data directory |
|---|---|---|---|
| `MDCz-<version>-win-x64-setup.exe` | Windows 10 or later, **recommended** | Downloads in-app, installs on restart | `%APPDATA%\mdcz` |
| `MDCz-<version>-win-x64-portable.zip` | Windows portable, runs after unzipping | Notifies only, replace manually | `data\` next to the executable |
| `MDCz-<version>-mac-arm64.dmg` | macOS Apple Silicon (no Intel build) | Notifies only, replace manually | `~/Library/Application Support/mdcz` |
| `MDCz-<version>-linux-x86_64.AppImage` | Linux x64 | Downloads in-app, installs on restart | `~/.config/mdcz` |

The portable build keeps its config, database, and logs in `data\`. To upgrade, keep that folder and replace everything else.

> [!NOTE]
> The apps are not code-signed, so the OS blocks the first launch:
> - **Windows** shows "Windows protected your PC": click "More info" → "Run anyway".
> - **macOS** says the app "is damaged and can't be opened": move MDCz to Applications, then run `xattr -cr /Applications/MDCz.app` in Terminal.
> - **Linux**: run `chmod +x MDCz-*.AppImage` before launching.

### Docker (Recommended for NAS / Server)

We recommend deploying with the maintained [compose.yaml](compose.yaml). See the [deployment and maintenance guide](docker/README.md) for detailed configuration, permissions, backups, and upgrades.

- **Quick Start**: Copy `docker/compose.env.example` as `.env`, configure your version and media path, and run `docker compose up -d`.
- **First Visit**: Open `http://<server-ip>:3838` in your browser (defaults to `127.0.0.1`; set `MDCZ_BIND_IP` in `.env` for LAN access). There is no default password; set the administrator password directly in the WebUI on first visit, then add your media directory under `/media` in settings.

### WebUI Bundle (without Docker)

`mdcz-<version>.tar.gz` on the Releases page runs on any machine with Node.js >= 24; see the README inside the bundle for install and startup.

### Local Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the toolchain setup and development commands.


---

## Screenshots

| Scraping Results | Backdrops & Trailers |
| :---: | :---: |
| <img src="https://github.com/user-attachments/assets/c4a46270-710f-4ca8-a0aa-a7c93c583b67" width="100%" alt="Scraping Results" /> | <img src="https://github.com/user-attachments/assets/4a98023b-f935-4ff4-b3c1-115995d44f4e" width="100%" alt="Backdrops & Trailers" /> |

> [!TIP]
> The information regarding "The Odyssey" shown here is solely for demonstration purposes. As is widely known, this software does not currently fetch metadata for mainstream theatrical films.

---

## Notices

> [!WARNING]
> MDCz is under active development. Core scraping and organizing features are functional, while certain advanced options continue to be refined. Issues and feedback are welcomed via [GitHub Issues](https://github.com/ShotHeadman/mdcz/issues).

> [!IMPORTANT]
> **Network Requirements**: Some providers enforce regional IP restrictions (e.g., DMM requires Japanese IP addresses, and certain proxies may be blocked). Configure appropriate proxy routing rules in network settings according to target sources.

---

## Acknowledgments & Upstream

- Upstream project: [MDCx](https://github.com/sqzw-x/mdcx). Special thanks to the original author.

---

## License

This project is licensed under GPLv3. By using this software, you agree to the following:

- This project is strictly intended for technical research and personal communication.
- Do not distribute broadly on public social platforms or use for commercial purposes.
- Strictly adhere to local laws and regulations; users assume full legal responsibility for their use.

---

<p align="center">
  <a href="https://github.com/ShotHeadman/mdcz/issues">Issues</a>
</p>
