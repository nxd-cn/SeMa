//! Tauri commands mirroring Electron `window.tui` IPC.

use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::artifacts::ArtifactsResult;
use crate::badge::apply_badge;
use crate::cli_detect::{detect_tools, sort_tools_by_usage, tool_for_id, ToolInfo};
use crate::fs_text;
use crate::git;
use crate::platform::{folder_name, home_dir};
use crate::prefs::{load_prefs, merge_prefs, save_prefs, write_cli_cache, PrefsWithHome};
use crate::pty::{self, new_session_id};
use crate::resume::{
    can_resume, follow_rotated_session, list_session_ids, pick_created_since,
    resolve_resume_selection, ResumeOpts,
};
use crate::spawn::spawn_target;
use crate::state::AppState;
use crate::trust_args::launch_args_for;
use tauri::Emitter;

#[derive(Serialize)]
pub struct CliListResult {
    pub tools: Vec<ToolInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    pub id: String,
    pub label: String,
    pub can_resume: bool,
    pub cli_session_id: Option<String>,
    pub known_before: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RespawnResult {
    pub ok: bool,
    pub used_bound: bool,
    pub cli_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverResult {
    pub cli_session_id: Option<String>,
}

#[derive(Serialize)]
pub struct FolderResult {
    pub canceled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

fn refresh_tools(app: &AppHandle, state: &AppState) -> Vec<ToolInfo> {
    let tools = detect_tools();
    let _ = write_cli_cache(app, &tools);
    *state.tools.lock() = tools.clone();
    tools
}

#[tauri::command]
pub fn prefs_get(app: AppHandle) -> PrefsWithHome {
    PrefsWithHome {
        prefs: load_prefs(&app),
        home_dir: home_dir().to_string_lossy().to_string(),
    }
}

#[tauri::command]
pub fn prefs_set(app: AppHandle, partial: Value) -> Result<PrefsWithHome, String> {
    let prefs = merge_prefs(load_prefs(&app), &partial);
    save_prefs(&app, &prefs)?;
    Ok(PrefsWithHome {
        prefs,
        home_dir: home_dir().to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn cli_list(app: AppHandle, state: State<'_, AppState>) -> CliListResult {
    let tools = {
        let guard = state.tools.lock();
        if guard.is_empty() {
            drop(guard);
            refresh_tools(&app, &state)
        } else {
            guard.clone()
        }
    };
    let prefs = load_prefs(&app);
    CliListResult {
        tools: sort_tools_by_usage(&tools, &prefs.cli_counts),
    }
}

#[tauri::command]
pub async fn dialog_pick_folder(app: AppHandle) -> FolderResult {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });
    match rx.recv() {
        Ok(Some(fp)) => FolderResult {
            canceled: false,
            path: Some(fp.to_string()),
        },
        _ => FolderResult {
            canceled: true,
            path: None,
        },
    }
}

#[tauri::command]
pub fn window_focus(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn badge_set(app: AppHandle, count: Option<i64>) -> Result<(), String> {
    apply_badge(&app, count.unwrap_or(0));
    Ok(())
}

#[tauri::command]
pub fn session_create(
    app: AppHandle,
    state: State<'_, AppState>,
    cwd: Option<String>,
    cli_id: Option<String>,
) -> Result<CreateResult, String> {
    let cwd = cwd.unwrap_or_else(|| home_dir().to_string_lossy().to_string());
    if !Path::new(&cwd).is_dir() {
        return Err(format!("目录不存在: {cwd}"));
    }
    let tools = {
        let g = state.tools.lock();
        if g.is_empty() {
            drop(g);
            refresh_tools(&app, &state)
        } else {
            g.clone()
        }
    };
    let cli_id = cli_id
        .or_else(|| tools.first().map(|t| t.id.clone()))
        .ok_or_else(|| "未检测到可用 CLI".to_string())?;
    let tool = tool_for_id(&tools, &cli_id).ok_or_else(|| format!("未找到 CLI: {cli_id}"))?;

    let id = new_session_id();
    let label = format!("{} · {}", tool.command, folder_name(&cwd));
    let known_before: Vec<String> = list_session_ids(&cli_id, &cwd, None)
        .into_iter()
        .map(|e| e.id)
        .collect();

    let mut launch_extra: Vec<String> = Vec::new();
    let mut assigned: Option<String> = None;
    if cli_id == "pi" {
        let sid = uuid::Uuid::new_v4().to_string();
        launch_extra = vec!["--session-id".into(), sid.clone()];
        assigned = Some(sid);
    }

    let target = spawn_target(
        &tool.path,
        &tool.command,
        &launch_args_for(&cli_id, &launch_extra),
    );
    pty::spawn_session(
        app.clone(),
        state.pty.clone(),
        id.clone(),
        &target,
        &cwd,
        120,
        40,
    )?;

    let mut prefs = load_prefs(&app);
    prefs.last = Some(serde_json::json!({ "cwd": cwd, "cliId": cli_id }));
    *prefs.cli_counts.entry(cli_id.clone()).or_insert(0) += 1;
    save_prefs(&app, &prefs)?;

    let resume_ok = can_resume(&cli_id, &cwd, None) && assigned.is_none();
    Ok(CreateResult {
        id,
        label,
        can_resume: resume_ok,
        cli_session_id: assigned,
        known_before,
    })
}

fn clamp_pty_size(cols: Option<u16>, rows: Option<u16>) -> (u16, u16) {
    let c = cols.unwrap_or(120).max(20);
    let r = rows.unwrap_or(40).max(5);
    (c, r)
}

fn spawn_plain(
    app: &AppHandle,
    state: &AppState,
    id: &str,
    tool: &ToolInfo,
    cli_id: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let target = spawn_target(&tool.path, &tool.command, &launch_args_for(cli_id, &[]));
    pty::spawn_session(
        app.clone(),
        state.pty.clone(),
        id.to_string(),
        &target,
        cwd,
        cols,
        rows,
    )
}

#[tauri::command]
pub fn session_respawn(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cwd: Option<String>,
    cli_id: String,
    cli_session_id: Option<String>,
    exclude_ids: Option<Vec<String>>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<RespawnResult, String> {
    let (pty_cols, pty_rows) = clamp_pty_size(cols, rows);
    let cwd = cwd.unwrap_or_else(|| home_dir().to_string_lossy().to_string());
    if !Path::new(&cwd).is_dir() {
        return Err(format!("目录不存在: {cwd}"));
    }
    let tools = state.tools.lock().clone();
    let tool = tool_for_id(&tools, &cli_id)
        .cloned()
        .ok_or_else(|| format!("未找到 CLI: {cli_id}"))?;

    let claimed = state.claims.lock().claimed_ids(&cli_id, &cwd, Some(&id));
    let selection = resolve_resume_selection(
        &cli_id,
        &cwd,
        &ResumeOpts {
            resume: true,
            cli_session_id: cli_session_id.clone(),
            exclude_ids: exclude_ids.unwrap_or_default(),
            claimed_ids: claimed,
        },
        None,
    );

    {
        let mut claims = state.claims.lock();
        if let Some(ref rid) = selection.resolved_id {
            claims.bind_resume(&id, &cli_id, &cwd, Some(rid));
        } else {
            claims.clear_resume(&id);
        }
    }

    state.pty.replacing.lock().insert(id.clone());
    pty::kill_session(&state.pty, &id);

    let target = spawn_target(
        &tool.path,
        &tool.command,
        &launch_args_for(&cli_id, &selection.args),
    );

    let spawn_res = pty::spawn_session(
        app.clone(),
        state.pty.clone(),
        id.clone(),
        &target,
        &cwd,
        pty_cols,
        pty_rows,
    );

    match spawn_res {
        Ok(()) => {
            // Do NOT clear `replacing` immediately — old PTY EOF would then emit
            // session:exit and the UI would close the freshly respawned pane.
            pty::clear_replacing_later(state.pty.clone(), id.clone());
            Ok(RespawnResult {
                ok: true,
                used_bound: selection.used_bound,
                cli_session_id: selection.resolved_id,
                fallback: None,
            })
        }
        Err(err) => {
            state.claims.lock().clear_resume(&id);
            if !selection.args.is_empty() {
                if spawn_plain(&app, &state, &id, &tool, &cli_id, &cwd, pty_cols, pty_rows).is_ok()
                {
                    let _ = app.emit(
                        "session:data",
                        pty::SessionDataEvent {
                            id: id.clone(),
                            data: "\r\n[SeMa] 续聊失败，已打开新会话。\r\n".into(),
                        },
                    );
                    pty::clear_replacing_later(state.pty.clone(), id.clone());
                    return Ok(RespawnResult {
                        ok: true,
                        used_bound: false,
                        cli_session_id: None,
                        fallback: Some(true),
                    });
                }
            }
            state.pty.replacing.lock().remove(&id);
            Err(format!("无法启动会话: {err}"))
        }
    }
}

/// Poll on-disk session ids after user submit. Must stay async — a sync
/// `thread::sleep` loop blocks Tauri's runtime so PTY `session:data` / writes
/// stall (looks like a freeze after Claude trust Enter, etc.).
#[tauri::command]
pub async fn session_discover_cli_session(
    app: AppHandle,
    cli_id: String,
    cwd: String,
    session_id: Option<String>,
    exclude_ids: Option<Vec<String>>,
) -> Result<DiscoverResult, String> {
    if cli_id.is_empty() || cli_id == "terminal" || cwd.is_empty() {
        return Ok(DiscoverResult {
            cli_session_id: None,
        });
    }
    let known_before: Vec<String> = list_session_ids(&cli_id, &cwd, None)
        .into_iter()
        .map(|e| e.id)
        .collect();
    let sid = session_id.clone().unwrap_or_default();
    if !sid.is_empty() {
        app.state::<AppState>().claims.lock().clear_discover(&sid);
    }
    let exclude = exclude_ids.unwrap_or_default();
    let deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < deadline {
        let entries = list_session_ids(&cli_id, &cwd, None);
        let claimed = {
            let state = app.state::<AppState>();
            let ids = state.claims.lock().claimed_ids(
                &cli_id,
                &cwd,
                if sid.is_empty() { None } else { Some(&sid) },
            );
            ids
        };
        let mut exclude_all = exclude.clone();
        exclude_all.extend(claimed);
        if let Some(picked) = pick_created_since(&entries, &known_before, &exclude_all) {
            if !sid.is_empty() {
                app.state::<AppState>().claims.lock().bind_discover(
                    &sid,
                    &cli_id,
                    &cwd,
                    Some(&picked),
                );
            }
            return Ok(DiscoverResult {
                cli_session_id: Some(picked),
            });
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    Ok(DiscoverResult {
        cli_session_id: None,
    })
}

/// If the CLI rotated session ids (e.g. Claude `/clear`), move our binding to the
/// newest on-disk id that is not owned by another pane.
///
/// When `timeout_ms` is omitted, polls up to 25s (rotation often lands after Enter).
/// Pass `0` for a single sync-style check (restore / idle).
#[tauri::command]
pub async fn session_follow_cli_session(
    state: State<'_, AppState>,
    cli_id: String,
    cwd: String,
    current_id: Option<String>,
    exclude_ids: Option<Vec<String>>,
    session_id: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<DiscoverResult, String> {
    if cli_id.is_empty() || cli_id == "terminal" || cwd.is_empty() {
        return Ok(DiscoverResult {
            cli_session_id: None,
        });
    }
    let current = current_id.unwrap_or_default();
    if current.trim().is_empty() {
        return Ok(DiscoverResult {
            cli_session_id: None,
        });
    }
    let mut exclude = exclude_ids.unwrap_or_default();
    let sid = session_id.unwrap_or_default();
    {
        let claimed = state.claims.lock().claimed_ids(
            &cli_id,
            &cwd,
            if sid.is_empty() { None } else { Some(&sid) },
        );
        exclude.extend(claimed);
    }
    let wait_ms = timeout_ms.unwrap_or(25_000);
    let deadline = Instant::now() + Duration::from_millis(wait_ms);
    loop {
        let entries = list_session_ids(&cli_id, &cwd, None);
        if let Some(picked) = follow_rotated_session(&entries, &current, &exclude) {
            if !sid.is_empty() {
                state
                    .claims
                    .lock()
                    .bind_discover(&sid, &cli_id, &cwd, Some(&picked));
            }
            return Ok(DiscoverResult {
                cli_session_id: Some(picked),
            });
        }
        if wait_ms == 0 || Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    Ok(DiscoverResult {
        cli_session_id: None,
    })
}

#[tauri::command]
pub fn session_kill(state: State<'_, AppState>, id: String) {
    state.claims.lock().clear_resume(&id);
    state.claims.lock().clear_discover(&id);
    pty::kill_session(&state.pty, &id);
}

#[tauri::command]
pub fn session_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    pty::write_session(&state.pty, &id, &data)
}

#[tauri::command]
pub fn session_resize(
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty::resize_session(&state.pty, &id, cols, rows)
}

/// Read-only current git branch for pane footer.
/// Always returns a display string (`~` on any failure); never rejects the invoke.
#[tauri::command]
pub async fn git_branch(cwd: String) -> String {
    // Off the async runtime: git/where/which must not block or panic the UI.
    let joined = tokio::time::timeout(Duration::from_secs(3), async move {
        tokio::task::spawn_blocking(move || git::current_branch(&cwd)).await
    })
    .await;
    match joined {
        Ok(Ok(name)) => {
            if name.trim().is_empty() {
                git::BRANCH_FALLBACK.to_string()
            } else {
                name
            }
        }
        // JoinError (panic in worker), timeout, or unexpected → footer stays "~".
        _ => git::BRANCH_FALLBACK.to_string(),
    }
}

#[tauri::command]
pub async fn read_text_file(path: String, max_bytes: Option<u64>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || fs_text::read_text_file(&path, max_bytes))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || fs_text::write_text_file(&path, &contents))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn session_artifacts(
    cli_id: String,
    cwd: String,
    cli_session_id: Option<String>,
    since_seq: Option<u64>,
) -> ArtifactsResult {
    let id = cli_session_id.unwrap_or_default();
    if id.trim().is_empty() {
        return ArtifactsResult::default();
    }
    let session_id = id.trim().to_string();
    let since = since_seq;
    let joined = tokio::time::timeout(Duration::from_secs(3), async move {
        tokio::task::spawn_blocking(move || {
            crate::artifacts::extract_artifacts(
                &cli_id,
                &cwd,
                &session_id,
                Some(home_dir().as_path()),
                since,
            )
        })
        .await
    })
    .await;
    match joined {
        Ok(Ok(result)) => result,
        _ => ArtifactsResult::default(),
    }
}

#[tauri::command]
pub async fn session_artifacts_seq(
    cli_id: String,
    cwd: String,
    cli_session_id: Option<String>,
) -> Result<u64, String> {
    let id = cli_session_id.unwrap_or_default();
    if id.trim().is_empty() {
        return Ok(0);
    }
    let session_id = id.trim().to_string();
    tokio::time::timeout(Duration::from_secs(3), async move {
        tokio::task::spawn_blocking(move || {
            crate::artifacts::session_seq_cursor(
                &cli_id,
                &cwd,
                &session_id,
                Some(home_dir().as_path()),
            )
        })
        .await
    })
    .await
    .map_err(|_| "session artifacts seq timed out".to_string())?
    .map_err(|e| e.to_string())
}

/// Quote a path/URL for `cmd /C start "" <quoted>` so `&` is not a command separator.
#[cfg(any(windows, test))]
pub(crate) fn quote_cmd_start_target(target: &str) -> String {
    let escaped = target.replace('"', "\"\"");
    format!("\"{escaped}\"")
}

fn file_url_from_path(path: &Path) -> Result<String, String> {
    if !path.is_file() {
        return Err("not found".into());
    }
    let unified = path.to_string_lossy().replace('\\', "/");
    let url = if unified.starts_with('/') {
        format!("file://{unified}")
    } else {
        format!("file:///{unified}")
    };
    Ok(url)
}

fn resolve_open_external_target(target: &str) -> Result<String, String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("empty target".into());
    }
    if trimmed.starts_with("file://") {
        let parsed = trimmed
            .parse::<tauri::Url>()
            .map_err(|e| format!("invalid url: {e}"))?;
        let path = parsed
            .to_file_path()
            .map_err(|_| "file url is not a local path".to_string())?;
        return file_url_from_path(&path);
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        if !crate::openable_url::is_openable_http_url(trimmed) {
            return Err("invalid url".into());
        }
        return Ok(trimmed.to_string());
    }
    file_url_from_path(Path::new(trimmed))
}

#[tauri::command]
pub fn open_external(target: String) -> Result<(), String> {
    let open_target = resolve_open_external_target(&target)?;

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(&open_target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(windows)]
    {
        use crate::spawn::CREATE_NO_WINDOW;
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        let quoted = quote_cmd_start_target(&open_target);
        Command::new(comspec)
            .args(["/C", "start"])
            .raw_arg("\"\"")
            .raw_arg(&quoted)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{quote_cmd_start_target, resolve_open_external_target};
    use std::fs;
    use std::path::Path;

    #[test]
    fn quotes_windows_start_target_with_ampersand() {
        assert_eq!(
            quote_cmd_start_target("https://example.com/q?a=1&b=2"),
            "\"https://example.com/q?a=1&b=2\""
        );
    }

    #[test]
    fn resolve_open_external_accepts_file_url_for_existing_file() {
        let dir = std::env::temp_dir().join(format!("sema-open-ext-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let page = dir.join("page.html");
        fs::write(&page, "<html></html>").unwrap();
        let unified = page.to_string_lossy().replace('\\', "/");
        let url = if unified.starts_with('/') {
            format!("file://{unified}")
        } else {
            format!("file:///{unified}")
        };
        assert!(resolve_open_external_target(&url).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_open_external_maps_existing_path_to_file_url() {
        let dir = std::env::temp_dir().join(format!("sema-open-path-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let page = dir.join("notes.md");
        fs::write(&page, "# x").unwrap();
        let resolved = resolve_open_external_target(page.to_str().unwrap()).unwrap();
        assert!(resolved.starts_with("file://"));
        assert!(Path::new(page.to_str().unwrap()).is_file());
        let _ = fs::remove_dir_all(&dir);
    }
}
