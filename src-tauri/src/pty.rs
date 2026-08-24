//! portable-pty session map + event fan-out.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::spawn::SpawnTarget;

pub struct PtySession {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub child_killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
    /// Monotonic per-slot id so an old reader cannot tear down a respawned PTY.
    pub generation: u64,
}

pub struct PtyState {
    pub sessions: Mutex<HashMap<String, PtySession>>,
    pub replacing: Mutex<HashSet<String>>,
    next_generation: AtomicU64,
}

impl Default for PtyState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            replacing: Mutex::new(HashSet::new()),
            next_generation: AtomicU64::new(1),
        }
    }
}

#[derive(Clone, Serialize)]
pub struct SessionDataEvent {
    pub id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExitEvent {
    pub id: String,
    pub exit_code: i32,
}

fn pty_env() -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    // Match former node-pty `name: "xterm-256color"` — TUIs (Cursor/Claude) need this
    // for box-drawing / alt-screen; missing TERM often yields broken chrome.
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("COLORTERM".into(), "truecolor".into());
    env.insert("PYTHONUTF8".into(), "1".into());
    env.insert("PYTHONIOENCODING".into(), "utf-8".into());
    env
}

pub fn spawn_session(
    app: AppHandle,
    state: Arc<PtyState>,
    id: String,
    target: &SpawnTarget,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&target.file);
    cmd.args(&target.args);
    cmd.cwd(cwd);
    for (k, v) in pty_env() {
        cmd.env(k, v);
    }

    // Keep slave only until spawn; dropping it avoids some hang-on-exit cases.
    let slave = pair.slave;
    let master = pair.master;
    let child = slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {e}"))?;
    drop(slave);
    let killer = child.clone_killer();

    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master.take_writer().map_err(|e| e.to_string())?;
    let generation = state.next_generation.fetch_add(1, Ordering::Relaxed);

    {
        let mut map = state.sessions.lock();
        map.insert(
            id.clone(),
            PtySession {
                writer,
                master,
                child_killer: killer,
                generation,
            },
        );
    }

    let app_r = app.clone();
    let state_r = state.clone();
    let id_r = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_r.emit(
                        "session:data",
                        SessionDataEvent {
                            id: id_r.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        // Wait briefly for process exit code
        thread::sleep(Duration::from_millis(50));
        if state_r.replacing.lock().contains(&id_r) {
            return;
        }
        // Same session id may already hold a newer PTY after ↻ — do not steal it.
        {
            let mut map = state_r.sessions.lock();
            match map.get(&id_r) {
                Some(sess) if sess.generation == generation => {
                    map.remove(&id_r);
                }
                _ => return,
            }
        }
        let _ = app_r.emit(
            "session:exit",
            SessionExitEvent {
                id: id_r,
                exit_code: 0,
            },
        );
    });

    // Keep child wait on another thread so we don't zombie.
    thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });

    Ok(())
}

pub fn write_session(state: &PtyState, id: &str, data: &str) -> Result<(), String> {
    // Take the writer out so a blocking write does not hold `sessions` (resize /
    // kill / reader cleanup can still proceed).
    let mut writer = {
        let mut map = state.sessions.lock();
        let Some(sess) = map.get_mut(id) else {
            return Ok(());
        };
        std::mem::replace(&mut sess.writer, Box::new(std::io::sink()))
    };
    let result = writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|e| e.to_string());
    {
        let mut map = state.sessions.lock();
        if let Some(sess) = map.get_mut(id) {
            sess.writer = writer;
        }
    }
    result
}

pub fn resize_session(state: &PtyState, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    if cols < 20 || rows < 5 {
        return Ok(());
    }
    let map = state.sessions.lock();
    let Some(sess) = map.get(id) else {
        return Ok(());
    };
    sess.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

pub fn kill_session(state: &PtyState, id: &str) {
    // Remove under the lock, kill/drop outside — ConPTY drop must not run while
    // reader threads are blocked on `sessions` (MSI Restart Manager hangs here).
    let sess = {
        let mut map = state.sessions.lock();
        map.remove(id)
    };
    if let Some(mut sess) = sess {
        let _ = sess.child_killer.kill();
        forget_pty_on_windows(sess);
    }
}

pub fn kill_all(state: &PtyState) {
    let sessions: Vec<PtySession> = {
        let mut map = state.sessions.lock();
        map.drain().map(|(_, s)| s).collect()
    };
    for mut sess in sessions {
        let _ = sess.child_killer.kill();
        forget_pty_on_windows(sess);
    }
}

/// On Windows, dropping ConPTY master/writer during teardown can block the UI
/// thread (and MSI uninstall) if a reader is still winding down. Process exit
/// reclaims the handles; leaking on purpose is fine here.
fn forget_pty_on_windows(sess: PtySession) {
    #[cfg(windows)]
    {
        std::mem::forget(sess);
    }
    #[cfg(not(windows))]
    {
        drop(sess);
    }
}

/// Keep `replacing` set briefly after ↻ so the dying process's reader does not
/// emit `session:exit` for the new PTY (same as Electron's 800ms window).
pub fn clear_replacing_later(state: Arc<PtyState>, id: String) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(800));
        state.replacing.lock().remove(&id);
    });
}

pub fn new_session_id() -> String {
    format!("s-{}", Uuid::new_v4())
}
