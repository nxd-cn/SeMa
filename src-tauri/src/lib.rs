mod artifacts;
mod badge;
mod claims;
mod cli_detect;
mod commands;
mod fs_text;
mod git;
#[cfg(target_os = "macos")]
mod mac_traffic_lights;
mod pane_webview;
mod platform;
mod prefs;
mod pty;
mod resume;
mod spawn;
mod state;
mod trust_args;

use std::sync::Arc;

use tauri::Manager;

use crate::badge::apply_badge;
use crate::cli_detect::detect_tools;
use crate::platform::enrich_path_for_gui_launch;
use crate::prefs::write_cli_cache;
use crate::pty::kill_all;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    enrich_path_for_gui_launch();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Windows taskbar / window chrome: apply embedded default icon explicitly.
            // macOS Dock in `tauri dev` is set by Tauri from icons/icon.icns|png on Ready.
            if let Some(icon) = app.default_window_icon().cloned() {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_icon(icon);
                }
            }
            #[cfg(target_os = "macos")]
            if let Some(win) = app.get_webview_window("main") {
                mac_traffic_lights::configure_window(&win);
            }
            // Do not block setup/first paint on PATH probes (where/which).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let tools = detect_tools();
                let _ = write_cli_cache(&handle, &tools);
                if let Some(state) = handle.try_state::<AppState>() {
                    *state.tools.lock() = tools;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::prefs_get,
            commands::prefs_set,
            commands::cli_list,
            commands::dialog_pick_folder,
            commands::window_focus,
            commands::badge_set,
            commands::session_create,
            commands::session_respawn,
            commands::session_discover_cli_session,
            commands::session_follow_cli_session,
            commands::session_kill,
            commands::session_write,
            commands::session_resize,
            commands::git_branch,
            commands::read_text_file,
            commands::write_text_file,
            commands::session_artifacts,
            commands::open_external,
            pane_webview::pane_webview_open,
            pane_webview::pane_webview_set_bounds,
            pane_webview::pane_webview_set_visible,
            pane_webview::pane_webview_close,
        ])
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::Resized(_) = event {
                // Windowed + fullscreen: keep lights in the same 38px strip as HTML bar.
                mac_traffic_lights::reapply(window);
                let win = window.clone();
                std::thread::spawn(move || {
                    for ms in [100_u64, 400] {
                        std::thread::sleep(std::time::Duration::from_millis(ms));
                        let w = win.clone();
                        let _ = win.run_on_main_thread(move || {
                            mac_traffic_lights::reapply(&w);
                        });
                    }
                });
            }
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                apply_badge(window.app_handle(), 0);
                #[cfg(windows)]
                {
                    // Kill PTY tree + force exit so nothing headless remains for uninstallers.
                    if let Some(state) = window.try_state::<AppState>() {
                        let pty = Arc::clone(&state.pty);
                        std::thread::spawn(move || {
                            kill_all(&pty);
                            kill_self_process_tree();
                        });
                    } else {
                        std::thread::spawn(kill_self_process_tree);
                    }
                    window.app_handle().exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                apply_badge(app_handle, 0);
                // Windows close path already kill_all + taskkill; sync ConPTY teardown here
                // can hang the process and leave a headless zombie for uninstallers.
                #[cfg(not(windows))]
                if let Some(state) = app_handle.try_state::<AppState>() {
                    kill_all(&state.pty);
                }
            }
        });
}

/// `taskkill /T` on our pid: drops ConPTY cmd/CLI grandchildren that survive ChildKiller.
#[cfg(windows)]
fn kill_self_process_tree() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let pid = std::process::id().to_string();
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

// silence unused import in some cfgs
#[allow(dead_code)]
fn _arc_marker() -> Arc<()> {
    Arc::new(())
}
