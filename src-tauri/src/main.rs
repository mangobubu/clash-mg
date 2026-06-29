#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(exit_code) = clash_mg_lib::try_run_tun_service_cli() {
        std::process::exit(exit_code);
    }
    clash_mg_lib::run();
}
