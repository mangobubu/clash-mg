# clash-mg

全新一代的跨平台代理客户端，致力于提供极致轻量、优雅且开箱即用的网络体验。基于最新的 Tauri 2.0 与 React 19 构建，以极低的系统资源占用提供极其流畅的交互响应。

**核心亮点：**

- **无感 TUN 体验**：深度定制的系统级服务（支持 Windows SCM, macOS launchd, Linux systemd）。仅需在首次安装服务时授权，日常开启与关闭 TUN 模式均通过本地 IPC 认证，**彻底告别烦人的反复提权弹窗**，实现真正的无缝切换。
- **开箱即用**：应用在构建时会根据目标平台与架构精准内置对应的 Mihomo 内核，用户下载安装后无需进行任何内核配置或额外下载即可直接使用。
- **纯粹的高性能**：Rust 后端接管所有核心逻辑，包括本地状态管理、订阅解析、实时连接监控与系统代理设置，前端只负责纯粹的视图渲染，带来肉眼可见的性能提升。
- **现代化 UI**：采用最新的前端生态链打造极简且富有设计感的操作界面，数据图表与状态反馈一目了然。

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
