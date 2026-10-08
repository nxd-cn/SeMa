//! Headless / print-mode runners for AI CLIs (Chat UI, no PTY).

mod argv;
mod auth;
mod config;
mod format_blocks;
mod history;
mod models;
mod permission;
mod run;
mod stream_parse;

pub use argv::ApprovalMode;
pub use auth::{auth_status, auth_status_for_tool, spawn_login, AuthStatus};
pub use config::{
    config_view, open_config_dir, set_opencode_provider, set_pi_defaults, CliConfigView,
};
pub use history::{load_chat_history, ChatHistoryMessage, ChatHistoryResult};
pub use models::{list_models, ModelsResult};
pub use run::{cancel_chat, chat_send, reply_permission, ChatSendOpts, ChatSendResult};

/// AI CLIs that use Chat + headless (not Terminal PTY).
pub fn is_chat_cli(cli_id: &str) -> bool {
    matches!(
        cli_id,
        "claude" | "opencode" | "kimi" | "cursor" | "codex" | "gemini" | "pi"
    )
}
