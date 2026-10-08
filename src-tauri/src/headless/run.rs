//! Spawn headless CLI and stream stdout to the UI via `chat:chunk` events.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::cli_detect::ToolInfo;
use crate::headless::argv::{headless_argv, ApprovalMode, HeadlessOpts};
use crate::headless::permission::{self, parse_permission_line};
use crate::headless::stream_parse::visible_delta;
use crate::spawn::spawn_target;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct ChatSendOpts {
    pub request_id: String,
    pub cli_id: String,
    pub cwd: String,
    pub prompt: String,
    pub session_id: Option<String>,
    pub continue_last: bool,
    pub model: Option<String>,
    pub approval: ApprovalMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendResult {
    pub request_id: String,
    pub ok: bool,
    pub text: String,
    pub stderr: String,
    pub exit_code: i32,
    pub needs_auth: bool,
    pub timed_out: bool,
    pub cancelled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatChunkEvent {
    request_id: String,
    delta: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatPermissionEvent {
    request_id: String,
    permission_id: String,
    tool_name: String,
    detail: String,
    cli_id: String,
}

fn json_stream_mode(cli_id: &str) -> bool {
    matches!(cli_id, "claude" | "cursor" | "opencode")
}

pub fn chat_send(
    app: &AppHandle,
    state: &AppState,
    tool: &ToolInfo,
    opts: ChatSendOpts,
) -> Result<ChatSendResult, String> {
    let prompt = opts.prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("消息为空".into());
    }
    if !Path::new(&opts.cwd).is_dir() {
        return Err(format!("目录不存在: {}", opts.cwd));
    }

    let argv = headless_argv(
        &opts.cli_id,
        &HeadlessOpts {
            prompt,
            session_id: opts.session_id,
            continue_last: opts.continue_last,
            model: opts.model,
            approval: opts.approval,
        },
    );
    let target = spawn_target(&tool.path, &tool.command, &argv);
    // Ask mode needs a live stdin for permission replies. Auto mode must use
    // null — Claude warns and waits 3s if stdin is an open pipe with no data.
    let need_stdin = opts.approval == ApprovalMode::Ask;
    let mut cmd = Command::new(&target.file);
    cmd.args(&target.args)
        .current_dir(&opts.cwd)
        .stdin(if need_stdin {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use crate::spawn::CREATE_NO_WINDOW;
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("启动失败: {e}"))?;
    let stdout = child.stdout.take().ok_or_else(|| "无 stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "无 stderr".to_string())?;
    let stdin = if need_stdin { child.stdin.take() } else { None };

    let request_id = opts.request_id.clone();
    let child_pid = child.id();
    let child_arc = Arc::new(Mutex::new(child));
    state
        .chat_procs
        .lock()
        .insert(request_id.clone(), Arc::clone(&child_arc));
    state
        .chat_pids
        .lock()
        .insert(request_id.clone(), child_pid);
    if let Some(stdin) = stdin {
        state
            .chat_stdin
            .lock()
            .insert(request_id.clone(), Arc::new(Mutex::new(stdin)));
    }
    // Stop clicked before spawn finished registering — kill now.
    if state.chat_cancelled.lock().contains(&request_id) {
        let _ = cancel_chat(state, &request_id);
    }

    let cli_id = opts.cli_id.clone();
    let json_mode = json_stream_mode(&cli_id);
    let ask = opts.approval == ApprovalMode::Ask;
    let app_out = app.clone();
    let rid_out = request_id.clone();
    let cli_out = cli_id.clone();
    let acc = Arc::new(Mutex::new(String::new()));
    let acc_out = Arc::clone(&acc);

    let stdout_thread = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        if json_mode {
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        if ask {
                            if let Some(p) = parse_permission_line(&line) {
                                let _ = app_out.emit(
                                    "chat:permission",
                                    ChatPermissionEvent {
                                        request_id: rid_out.clone(),
                                        permission_id: p.permission_id,
                                        tool_name: p.tool_name,
                                        detail: p.detail,
                                        cli_id: cli_out.clone(),
                                    },
                                );
                                continue;
                            }
                        }
                        if let Some(delta) = visible_delta(&cli_id, true, &line) {
                            let _ = app_out.emit(
                                "chat:chunk",
                                ChatChunkEvent {
                                    request_id: rid_out.clone(),
                                    delta: delta.clone(),
                                },
                            );
                            if let Ok(mut g) = acc_out.lock() {
                                g.push_str(&delta);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        } else {
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let piece = String::from_utf8_lossy(&buf[..n]).to_string();
                        if let Some(delta) = visible_delta(&cli_id, false, &piece) {
                            let _ = app_out.emit(
                                "chat:chunk",
                                ChatChunkEvent {
                                    request_id: rid_out.clone(),
                                    delta: delta.clone(),
                                },
                            );
                            if let Ok(mut g) = acc_out.lock() {
                                g.push_str(&delta);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    });

    let stderr_thread = thread::spawn(move || {
        let mut s = String::new();
        let mut r = BufReader::new(stderr);
        let _ = r.read_to_string(&mut s);
        s
    });

    // Poll try_wait; also unwind quickly once Stop sets chat_cancelled.
    let wait = wait_child_poll(state, &request_id, &child_arc)?;
    let cancelled = state.chat_cancelled.lock().contains(&request_id);
    let (exit_code, stderr_text) = if cancelled {
        // Pipe readers may never see EOF if a grandchild still holds the write
        // end — never join forever after Stop.
        detach_join(stdout_thread);
        let stderr_text = take_join_timeout(stderr_thread, Duration::from_millis(200))
            .unwrap_or_default();
        (wait.exit_code(), stderr_text)
    } else {
        let _ = stdout_thread.join();
        let stderr_text = stderr_thread.join().unwrap_or_default();
        (wait.exit_code(), stderr_text)
    };
    state.chat_stdin.lock().remove(&request_id);
    state.chat_procs.lock().remove(&request_id);
    state.chat_pids.lock().remove(&request_id);
    let cancelled = state.chat_cancelled.lock().remove(&request_id);
    let text = acc.lock().map(|g| g.clone()).unwrap_or_default();

    let combined = format!("{text}\n{stderr_text}").to_ascii_lowercase();
    let needs_auth = !cancelled && looks_like_auth_error(&combined);
    let display = if text.trim().is_empty() {
        if cancelled {
            String::new()
        } else {
            stderr_text.trim().to_string()
        }
    } else {
        text
    };
    let ok = !cancelled && exit_code == 0 && !display.is_empty() && !needs_auth;

    Ok(ChatSendResult {
        request_id,
        ok,
        text: display,
        stderr: stderr_text.trim().to_string(),
        exit_code,
        needs_auth,
        timed_out: false,
        cancelled,
    })
}

enum WaitOutcome {
    Exited(ExitStatus),
    /// Process did not reap after kill; treat as cancelled with code -1.
    ForcedStop,
}

impl WaitOutcome {
    fn exit_code(&self) -> i32 {
        match self {
            WaitOutcome::Exited(s) => s.code().unwrap_or(-1),
            WaitOutcome::ForcedStop => -1,
        }
    }
}

fn wait_child_poll(
    state: &AppState,
    request_id: &str,
    child: &Arc<Mutex<Child>>,
) -> Result<WaitOutcome, String> {
    let mut cancelled_for = Duration::ZERO;
    loop {
        {
            let mut guard = child.lock().map_err(|_| "child lock".to_string())?;
            if let Some(status) = guard.try_wait().map_err(|e| format!("等待失败: {e}"))? {
                return Ok(WaitOutcome::Exited(status));
            }
        }
        let cancelled = state.chat_cancelled.lock().contains(request_id);
        if cancelled {
            cancelled_for += Duration::from_millis(40);
            // Re-assert kill a couple times, then give up waiting for reap.
            if cancelled_for.as_millis() == 40 || cancelled_for.as_millis() == 200 {
                force_kill_pid(
                    state
                        .chat_pids
                        .lock()
                        .get(request_id)
                        .copied()
                        .unwrap_or(0),
                );
                if let Ok(mut guard) = child.try_lock() {
                    let _ = guard.kill();
                }
            }
            if cancelled_for >= Duration::from_millis(800) {
                return Ok(WaitOutcome::ForcedStop);
            }
        }
        thread::sleep(Duration::from_millis(40));
    }
}

fn detach_join(handle: thread::JoinHandle<()>) {
    thread::spawn(move || {
        let _ = handle.join();
    });
}

fn take_join_timeout(
    handle: thread::JoinHandle<String>,
    timeout: Duration,
) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(handle.join().unwrap_or_default());
    });
    rx.recv_timeout(timeout).ok()
}

fn force_kill_pid(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(windows)]
    {
        use crate::spawn::CREATE_NO_WINDOW;
        use std::os::windows::process::CommandExt;
        // Do not wait — .status() blocked the UI when chat_cancel was sync.
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

/// Kill headless Chat process (and process tree on Windows). Non-blocking.
pub fn cancel_chat(state: &AppState, request_id: &str) -> Result<(), String> {
    state.chat_cancelled.lock().insert(request_id.to_string());
    // Drop stdin first so some CLIs exit on EOF even if kill is slow.
    state.chat_stdin.lock().remove(request_id);
    let pid = state.chat_pids.lock().get(request_id).copied().unwrap_or(0);
    if pid != 0 {
        force_kill_pid(pid);
    }
    if let Some(child) = state.chat_procs.lock().get(request_id).cloned() {
        if let Ok(mut guard) = child.try_lock() {
            let _ = guard.kill();
        }
    }
    Ok(())
}

pub fn reply_permission(
    state: &AppState,
    request_id: &str,
    permission_id: &str,
    allow: bool,
) -> Result<(), String> {
    let stdin = state
        .chat_stdin
        .lock()
        .get(request_id)
        .cloned()
        .ok_or_else(|| "没有进行中的 Chat 进程可写审批".to_string())?;
    let body = if allow {
        permission::allow_response(permission_id)
    } else {
        permission::deny_response(permission_id)
    };
    let mut guard = stdin.lock().map_err(|_| "stdin lock".to_string())?;
    writeln!(guard, "{body}").map_err(|e| format!("写入审批失败: {e}"))?;
    guard.flush().map_err(|e| format!("flush 失败: {e}"))?;
    Ok(())
}

fn looks_like_auth_error(text: &str) -> bool {
    text.contains("not logged")
        || text.contains("not authenticated")
        || text.contains("please log in")
        || text.contains("please login")
        || text.contains("login required")
        || text.contains("unauthorized")
        || text.contains("authentication required")
        || text.contains("cursor-agent login")
        || text.contains("claude auth login")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_error_heuristic() {
        assert!(looks_like_auth_error("error: not logged in"));
        assert!(!looks_like_auth_error("all good"));
    }
}
