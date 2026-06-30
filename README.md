# clash-mg

基于 Tauri、React 与 Mihomo 构建的跨平台 Clash 桌面客户端。应用通过 Rust 后端管理本地状态、订阅、Mihomo 配置、实时连接与系统代理。

## 技术栈

- Tauri 2.11.3
- React 19.2.7
- Ant Design React 6.4.4
- Vite 8.1.0 + TypeScript 6.0.3
- Zustand 5.0.14 + Recharts 3.9.0

## 本地运行

```powershell
npm.cmd install
npm.cmd run dev
```

浏览器调试地址为 `http://localhost:8220`。

桌面端开发模式：

```powershell
npm.cmd run tauri dev
```

`tauri dev` 和 `tauri build` 会在编译前自动准备 Mihomo 内核。构建脚本根据 Rust 目标三元组只下载并打包当前系统与 CPU 架构对应的 Mihomo `v1.19.27`，同时校验官方 SHA-256；终端用户启动应用时不再下载内核。

如需单独准备当前构建平台的内核：

```powershell
npm.cmd run prepare:mihomo
```

交叉编译时可显式指定目标，例如：

```powershell
npm.cmd run prepare:mihomo -- --target aarch64-apple-darwin
```

## 质量检查

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run prepare:mihomo
Set-Location src-tauri
cargo check
```

## TUN 系统服务

- TUN 开关仅在系统服务安装完成且版本匹配时可用。
- 首次安装服务需要管理员权限，日常开启和关闭 TUN 通过本地认证 IPC 完成，不再重复提权。
- Windows 使用 SCM 服务，macOS 使用 launchd，Linux 使用 systemd 与 polkit。
- 服务只允许查询状态、启动 TUN 和停止 TUN，并运行安装到系统保护目录中的 Mihomo。
- 删除或修复系统服务属于系统级变更，可能再次请求管理员权限。
