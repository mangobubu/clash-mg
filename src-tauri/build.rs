fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new()
                .commands(&["open_connections_window", "open_connection_detail_window"]),
        ),
    )
    .expect("运行 Tauri 构建脚本失败");
}
