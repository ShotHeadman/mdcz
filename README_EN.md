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

## Platform Support

| Platform | Type | Requirements |
|---|---|---|
| Windows | Desktop App (.exe) | Windows 10 or later |
| macOS | Desktop App (.dmg) | Apple Silicon / Intel |
| Linux | Desktop App (.AppImage) | Major Linux distributions |
| NAS / Server | Docker / WebUI | Docker Engine / Node.js >= 24 |

---

## Quick Start

### Desktop Application

Download the pre-built installer for your operating system from the [Releases](https://github.com/ShotHeadman/mdcz/releases) page.

### Docker (Recommended for NAS / Server)

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

Access the WebUI at `http://localhost:3838`.

> [!TIP]
> **NAS Permission Notice**: Use `PUID`, `PGID`, and `UMASK` to align container permissions with your host user (defaults: `1000`, `1000`, `022`). The container only manages the `/data` mount and does not recursively alter ownership of existing media files. Use `--group-add <gid>` if supplementary group permissions are required.

### Local Development

```bash
pnpm install
pnpm dev:webui      # Start WebUI mode
pnpm dev:desktop    # Start Desktop mode
```


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
  <a href="https://github.com/ShotHeadman/mdcz/issues">Issues</a> · <a href="https://linux.do">LINUXDO Community</a>
</p>
