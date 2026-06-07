# Clash MG Development Roadmap

## Milestone 1: Foundation

- Install and lock dependencies for MUI, Emotion, lucide, TanStack Query, and
  Zustand.
- Keep all frontend calls behind Tauri command wrappers.
- Keep Rust commands stable while internal implementations evolve.

## Milestone 2: UI

- Replace the first prototype with MUI-based dashboard, proxies, profiles,
  rules, connections, logs, and settings pages.
- Use typed mock data until the mihomo adapter is connected.
- Preserve compact desktop density and light/dark theme support.

## Milestone 3: Core Management

- Add mihomo binaries for each target platform.
- Start, stop, restart, and health-check the core from Rust.
- Generate runtime config under the app config directory.

## Milestone 4: Profiles

- Import local YAML files.
- Import and update remote subscriptions.
- Activate profiles and refresh proxy/rule state.

## Milestone 5: Live Data

- Replace mock proxy groups and connections with mihomo REST API calls.
- Stream logs and traffic through Tauri events.
- Add latency tests and connection closing.

## Milestone 6: System Integration

- Implement platform-specific system proxy toggles.
- Add tray actions for show, hide, start, stop, and quit.
- Add auto-start and TUN capability detection per platform.

## Milestone 7: Release

- Add icons and bundle metadata.
- Build Windows installer first.
- Validate macOS and Linux bundles on their native systems.
