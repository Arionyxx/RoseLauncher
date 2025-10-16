# RoseLauncher

A sleek, Catppuccin-themed desktop launcher for managing your FitGirl repacks (and any other games you curate). Built with **Rust + Tauri** on the backend and a **React + Vite** front-end, RoseLauncher helps you catalogue existing downloads, queue fresh ones, and launch your games with style.

## ✨ Features

- **Dark, Catppuccin-inspired UI** with elegant gradients and glassmorphism touches.
- **Game library management**
  - Track archive, install and executable paths for every title.
  - Store metadata such as version, repacker, checksum, notes and custom accent colours.
  - Tag support plus quick status toggles (Not installed, Downloading, Installed, Archived).
  - Automatic size detection for archives or install folders.
- **Download manager**
  - Queue new downloads by supplying a URL and destination.
  - Real-time progress events with completion and error reporting.
- **Deep OS integration**
  - Open install folders or archive files directly from the UI.
  - Launch executable straight from RoseLauncher.
- **Persistent storage** for your library inside your OS-specific application data directory.

## 🚀 Getting started

### Prerequisites

- **Rust** (latest stable) with the Tauri prerequisites for your platform (Windows: MSVC toolchain + WebView2 runtime).
- **Node.js 18+** and npm or pnpm/yarn.

### Install dependencies

```bash
npm install
```

### Run in development

In one terminal:

```bash
npm run dev
```

In another terminal:

```bash
npm run tauri:dev
```

Tauri will proxy the Vite dev server and open the desktop window with hot reload.

### Build a release bundle

```bash
npm run build
npm run tauri:build
```

This will produce native builds (MSI/NSIS on Windows, DMG on macOS, etc.) inside `src-tauri/target/`.

## 🧱 Project structure

```
├── index.html              # Vite entry point
├── package.json
├── src/
│   ├── App.tsx             # Main application shell
│   ├── components/         # UI building blocks (cards, modals, download drawer)
│   ├── lib/types.ts        # Shared TypeScript types & helpers
│   └── index.css           # Base Catppuccin styling
└── src-tauri/
    ├── Cargo.toml          # Rust dependencies
    ├── src/main.rs         # Tauri commands & storage/download logic
    └── tauri.conf.json     # Tauri configuration
```

## 📝 Notes

- Library data is stored as JSON at your platform-specific `AppData`/`AppData/Local` directory. You can safely back it up or sync it via cloud storage.
- Download manager uses a simple built-in HTTP client; feel free to extend it with torrent/aria2 integrations if needed.
- Icons are customisable via the standard Tauri `src-tauri/icons` folder.

Enjoy your cosy Catppuccin gaming setup! 🐾
