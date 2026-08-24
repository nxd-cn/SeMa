//! CLI catalog and PATH detection.

use serde::Serialize;

use crate::spawn::resolve_command;

#[derive(Debug, Clone, Serialize)]
pub struct ToolInfo {
    pub id: String,
    pub label: String,
    pub command: String,
    pub path: String,
}

struct CatalogEntry {
    id: &'static str,
    label: &'static str,
    candidates: &'static [&'static str],
}

const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        id: "claude",
        label: "Claude Code",
        candidates: &["claude"],
    },
    CatalogEntry {
        id: "opencode",
        label: "OpenCode",
        candidates: &["opencode"],
    },
    CatalogEntry {
        id: "kimi",
        label: "Kimi Code",
        candidates: &["kimi"],
    },
    CatalogEntry {
        id: "cursor",
        label: "Cursor Agent",
        candidates: &["cursor-agent", "cursor"],
    },
    CatalogEntry {
        id: "codex",
        label: "Codex",
        candidates: &["codex"],
    },
    CatalogEntry {
        id: "gemini",
        label: "Gemini",
        candidates: &["gemini"],
    },
    CatalogEntry {
        id: "pi",
        label: "Pi",
        candidates: &["pi"],
    },
];

pub fn detect_tools() -> Vec<ToolInfo> {
    let mut tools = Vec::new();
    for entry in CATALOG {
        for name in entry.candidates {
            if let Some(path) = resolve_command(name) {
                tools.push(ToolInfo {
                    id: entry.id.to_string(),
                    label: entry.label.to_string(),
                    command: (*name).to_string(),
                    path,
                });
                break;
            }
        }
    }
    tools
}

pub fn tool_for_id<'a>(tools: &'a [ToolInfo], cli_id: &str) -> Option<&'a ToolInfo> {
    tools.iter().find(|t| t.id == cli_id)
}

pub fn sort_tools_by_usage(
    tools: &[ToolInfo],
    counts: &std::collections::HashMap<String, u64>,
) -> Vec<ToolInfo> {
    let mut indexed: Vec<(usize, &ToolInfo)> = tools.iter().enumerate().collect();
    indexed.sort_by(|(ia, a), (ib, b)| {
        let ca = counts.get(&a.id).copied().unwrap_or(0);
        let cb = counts.get(&b.id).copied().unwrap_or(0);
        cb.cmp(&ca).then_with(|| ia.cmp(ib))
    });
    indexed.into_iter().map(|(_, t)| t.clone()).collect()
}
