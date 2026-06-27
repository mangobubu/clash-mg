# clash-mg

基于设计稿实现的 Clash 桌面客户端交互原型。当前数据由 Mock 层驱动，所有主要页面、表单、筛选、弹窗、开关和列表操作均可交互。

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

## 质量检查

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
Set-Location src-tauri
cargo check
```

## 原型说明

- Mock 状态会持久化到浏览器 `localStorage`。
- 点击设置页的“重置默认”可恢复初始配置。
- 自定义窗口按钮仅在 Tauri 桌面环境执行实际最小化、最大化和关闭操作；浏览器调试环境会显示提示。
- 后续接入 Clash API 时，可用真实服务替换 `src/mocks` 与状态层的数据动作，页面组件无需重写。
