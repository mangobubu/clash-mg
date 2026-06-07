# Clash MG Architecture

Clash MG is a Tauri v2 desktop shell around a managed mihomo core. The UI is a
React and MUI application, while Rust owns process management, filesystem paths,
platform integration, and communication with the core.

## Frontend

- `src/app` wires the MUI theme, React Query client, and route definitions.
- `src/layout` contains the persistent desktop shell: sidebar and topbar.
- `src/features` contains page-level feature modules for dashboard, proxies,
  profiles, rules, connections, logs, and settings.
- `src/shared/api` is the only frontend layer that calls Tauri commands.
- `src/shared/types` mirrors the public command payloads returned by Rust.

## Backend

- `src-tauri/src/commands` exposes stable Tauri commands to the frontend.
- `src-tauri/src/core` manages the mihomo process and resolves bundled core
  binaries.
- `src-tauri/src/config` owns settings, profile summaries, and runtime config
  generation.
- `src-tauri/src/platform` isolates OS-specific names and platform checks.
- `src-tauri/src/proxy` currently provides sample proxy, connection, and log
  data; it is the future mihomo REST/WebSocket adapter boundary.
- `src-tauri/src/storage` keeps app state behind mutexes for the first local
  implementation.
- `src-tauri/src/tray` is the placeholder for platform tray menus.

## Core Resources

Place mihomo binaries here before testing real startup:

- Windows: `src-tauri/resources/core/windows/mihomo.exe`
- macOS: `src-tauri/resources/core/macos/mihomo`
- Linux: `src-tauri/resources/core/linux/mihomo`

Without a binary, `start_core` returns a clear missing-core error and the UI can
still run against mock data.
