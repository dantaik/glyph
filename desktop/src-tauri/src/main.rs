// Keeps a console window from opening beside the app on Windows. There is no
// Windows build yet (Phase 13 is macOS only), but the attribute costs
// nothing and is what stops that surprise the day there is one.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    xueni_lib::run()
}
