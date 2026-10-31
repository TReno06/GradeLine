// GradeLine desktop shell (PLAN.md Stage 5). All app logic lives in the
// web frontend (app/), loaded unchanged into a WebView2 window; this only
// opens that window and hands the frontend a .gradeline file Windows
// passed on the command line (a double-clicked job — see
// bundle.fileAssociations in tauri.conf.json).

// No console window behind the app in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::ipc::Response;

// The .gradeline file this process was launched with, if any. These two
// commands only ever read that one file — never an arbitrary path the
// frontend asks for.
fn launch_path() -> Option<PathBuf> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| {
            p.extension().map_or(false, |e| e.eq_ignore_ascii_case("gradeline")) && p.is_file()
        })
}

#[tauri::command]
fn launch_file_name() -> Option<String> {
    launch_path().and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
}

// Raw bytes (an ArrayBuffer on the JS side), not a JSON number array —
// job files hold the whole survey and can run to several MB.
#[tauri::command]
fn launch_file_bytes() -> Result<Response, String> {
    let path = launch_path().ok_or("no .gradeline file was passed at launch")?;
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![launch_file_name, launch_file_bytes])
        .run(tauri::generate_context!())
        .expect("error while running GradeLine");
}
