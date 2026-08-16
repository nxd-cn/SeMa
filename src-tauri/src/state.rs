use std::sync::Arc;

use parking_lot::Mutex;

use crate::claims::ClaimState;
use crate::cli_detect::ToolInfo;
use crate::pty::PtyState;

pub struct AppState {
    pub tools: Mutex<Vec<ToolInfo>>,
    pub pty: Arc<PtyState>,
    pub claims: Mutex<ClaimState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            tools: Mutex::new(Vec::new()),
            pty: Arc::new(PtyState::default()),
            claims: Mutex::new(ClaimState::default()),
        }
    }
}
