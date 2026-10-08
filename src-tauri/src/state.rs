use std::collections::{HashMap, HashSet};
use std::process::{Child, ChildStdin};
use std::sync::{Arc, Mutex as StdMutex};

use parking_lot::Mutex;

use crate::claims::ClaimState;
use crate::cli_detect::ToolInfo;
use crate::pty::PtyState;

pub struct AppState {
    pub tools: Mutex<Vec<ToolInfo>>,
    pub pty: Arc<PtyState>,
    pub claims: Mutex<ClaimState>,
    /// pane id -> child webview label (`pane-wv-...`)
    pub pane_webviews: Mutex<HashMap<String, String>>,
    /// Serialize child webview open/close/bounds/visible (WKWebView races can panic wry).
    pub pane_webview_ops: Mutex<()>,
    /// Active Chat headless stdin by `requestId` (for permission replies).
    pub chat_stdin: Mutex<HashMap<String, Arc<StdMutex<ChildStdin>>>>,
    /// Active Chat child processes by `requestId` (for Stop / cancel).
    pub chat_procs: Mutex<HashMap<String, Arc<StdMutex<Child>>>>,
    /// OS pids for cancel without waiting on Child lock.
    pub chat_pids: Mutex<HashMap<String, u32>>,
    /// requestIds cancelled via `chat_cancel` (survives until chat_send finishes).
    pub chat_cancelled: Mutex<HashSet<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            tools: Mutex::new(Vec::new()),
            pty: Arc::new(PtyState::default()),
            claims: Mutex::new(ClaimState::default()),
            pane_webviews: Mutex::new(HashMap::new()),
            pane_webview_ops: Mutex::new(()),
            chat_stdin: Mutex::new(HashMap::new()),
            chat_procs: Mutex::new(HashMap::new()),
            chat_pids: Mutex::new(HashMap::new()),
            chat_cancelled: Mutex::new(HashSet::new()),
        }
    }
}
