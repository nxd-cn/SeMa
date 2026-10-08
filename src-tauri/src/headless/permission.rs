//! Detect / answer tool-permission prompts in stream-json (Claude host mode).

use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub struct PermissionAsk {
    pub permission_id: String,
    pub tool_name: String,
    pub detail: String,
}

pub fn parse_permission_line(line: &str) -> Option<PermissionAsk> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    if ty == "control_request" {
        let pid = v
            .get("request_id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let req = v.get("request")?;
        let subtype = req.get("subtype").and_then(|x| x.as_str()).unwrap_or("");
        if subtype.contains("tool") || subtype == "can_use_tool" || subtype.contains("permission") {
            let tool = req
                .get("tool_name")
                .or_else(|| req.get("toolName"))
                .and_then(|x| x.as_str())
                .unwrap_or("tool")
                .to_string();
            let detail = req
                .get("input")
                .map(|i| i.to_string())
                .unwrap_or_default();
            if !pid.is_empty() {
                return Some(PermissionAsk {
                    permission_id: pid,
                    tool_name: tool,
                    detail: detail.chars().take(400).collect(),
                });
            }
        }
    }
    // Generic heuristics
    if ty.contains("permission") || ty.contains("tool_request") {
        let pid = v
            .get("id")
            .or_else(|| v.get("request_id"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let tool = v
            .get("tool_name")
            .or_else(|| v.get("name"))
            .and_then(|x| x.as_str())
            .unwrap_or("tool")
            .to_string();
        if !pid.is_empty() {
            return Some(PermissionAsk {
                permission_id: pid,
                tool_name: tool,
                detail: line.chars().take(200).collect(),
            });
        }
    }
    None
}

pub fn allow_response(permission_id: &str) -> String {
    json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": permission_id,
            "response": { "behavior": "allow" }
        }
    })
    .to_string()
}

pub fn deny_response(permission_id: &str) -> String {
    json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": permission_id,
            "response": { "behavior": "deny" }
        }
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_control_request() {
        let line = r#"{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"ls"}}}"#;
        let p = parse_permission_line(line).unwrap();
        assert_eq!(p.permission_id, "r1");
        assert_eq!(p.tool_name, "Bash");
    }
}
