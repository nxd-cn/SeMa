use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use super::types::{ArtifactsResult, DocArtifact, LinkArtifact};

const DOC_EXTENSIONS: [&str; 4] = [".md", ".txt", ".rst", ".markdown"];

pub fn collect_from_texts(texts: &[(u64, String)], cwd: &str) -> ArtifactsResult {
    let mut link_map: HashMap<String, (u64, LinkArtifact)> = HashMap::new();
    let mut doc_map: HashMap<String, (u64, DocArtifact)> = HashMap::new();

    for (seq, text) in texts {
        for url in extract_urls(text) {
            if !is_embeddable_http_url(&url) {
                continue;
            }
            link_map.insert(url.clone(), (*seq, LinkArtifact { url, label: None }));
        }
        for rel in extract_doc_paths(text) {
            let resolved = resolve_doc_path(&rel, cwd);
            if !path_is_readable_file(&resolved) {
                continue;
            }
            let key = normalize_path_key(&resolved);
            let label = Path::new(&resolved)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_string();
            let mtime_ms = file_mtime_ms(&resolved);
            doc_map.insert(
                key,
                (
                    *seq,
                    DocArtifact {
                        path: resolved,
                        label,
                        mtime_ms,
                    },
                ),
            );
        }
    }

    let mut links: Vec<(u64, LinkArtifact)> = link_map.into_values().collect();
    links.sort_by(|a, b| b.0.cmp(&a.0));
    let links = links.into_iter().map(|(_, link)| link).collect();

    let mut docs: Vec<(u64, DocArtifact)> = doc_map.into_values().collect();
    docs.sort_by(|a, b| b.0.cmp(&a.0));
    let docs = docs.into_iter().map(|(_, doc)| doc).collect();

    ArtifactsResult { docs, links }
}

pub fn is_doc_path(path: &str) -> bool {
    let trimmed = trim_trailing_punct(path.trim());
    let lower = trimmed.to_lowercase();
    DOC_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

pub fn normalize_path_key(path: &str) -> String {
    let unified = path.replace('\\', "/");
    if cfg!(windows) {
        unified.to_lowercase()
    } else {
        unified
    }
}

fn resolve_doc_path(rel: &str, cwd: &str) -> String {
    let rel = rel.trim();
    let path = Path::new(rel);
    if path.is_absolute() {
        path.to_string_lossy().into_owned()
    } else {
        Path::new(cwd).join(rel).to_string_lossy().into_owned()
    }
}

/// Drop transcript paths that are missing, not a file, or unreadable.
pub fn path_is_readable_file(path: &str) -> bool {
    let p = Path::new(path);
    if !p.is_file() {
        return false;
    }
    File::open(p).is_ok()
}

fn file_mtime_ms(path: &str) -> Option<u64> {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

/// Same rules as pane webview: http(s) + host, no whitespace / angle brackets.
pub fn is_embeddable_http_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.is_empty()
        || trimmed
            .chars()
            .any(|c| c.is_whitespace() || c == '<' || c == '>')
    {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let prefix_len = if lower.starts_with("https://") {
        "https://".len()
    } else if lower.starts_with("http://") {
        "http://".len()
    } else {
        return false;
    };
    let rest = &trimmed[prefix_len..];
    let host_port = rest
        .split(|c| c == '/' || c == '?' || c == '#')
        .next()
        .unwrap_or("");
    if host_port.is_empty() {
        return false;
    }
    let host = host_port.split('@').next_back().unwrap_or(host_port);
    let host_only = host.split(':').next().unwrap_or(host);
    !host_only.is_empty()
        && (host_only.contains('.')
            || host_only.eq_ignore_ascii_case("localhost")
            || host_only.chars().all(|c| c.is_ascii_digit() || c == '.'))
}

fn trim_trailing_punct(token: &str) -> &str {
    token.trim_end_matches(|c: char| matches!(c, '.' | ',' | ')' | ']' | '>' | ';' | ':'))
}

fn is_http_url(s: &str) -> bool {
    let lower = s.trim().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn extract_urls(text: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut pos = 0;
    while pos < text.len() {
        let rest = &text[pos..];
        let scheme_len = if rest.starts_with("https://") {
            8
        } else if rest.starts_with("http://") {
            7
        } else {
            pos += rest.chars().next().map(|c| c.len_utf8()).unwrap_or(1);
            continue;
        };

        let start = pos;
        pos += scheme_len;
        while pos < text.len() {
            let Some(ch) = text[pos..].chars().next() else {
                break;
            };
            if ch.is_whitespace() || matches!(ch, ')' | ']' | '>' | ',') {
                break;
            }
            pos += ch.len_utf8();
        }

        let mut url = text[start..pos].to_string();
        while url.ends_with('.') || url.ends_with(',') || url.ends_with(')') || url.ends_with(']') {
            url.pop();
        }
        if !url.is_empty() {
            urls.push(url);
        }
    }
    urls
}

fn extract_doc_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    paths.extend(find_paren_doc_paths(text));
    paths.extend(find_json_doc_paths(text));
    paths.extend(find_bare_doc_paths(text));
    paths
}

fn is_paren_path_like(inner: &str) -> bool {
    if inner.is_empty() || inner.chars().any(char::is_whitespace) {
        return false;
    }
    if is_http_url(inner) {
        return false;
    }
    inner.contains("./") || inner.contains('/') || inner.contains('\\')
}

fn find_paren_doc_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for (idx, _) in text.match_indices('(') {
        let rest = &text[idx + 1..];
        if let Some(end) = rest.find(')') {
            let inner = rest[..end].trim();
            if is_paren_path_like(inner) && is_doc_path(inner) {
                paths.push(inner.to_string());
            }
        }
    }
    paths
}

fn find_json_doc_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for pat in ["\"path\":\"", "\"path\": \""] {
        let mut search_from = 0;
        while let Some(rel_idx) = text[search_from..].find(pat) {
            let start = search_from + rel_idx + pat.len();
            let rest = &text[start..];
            if let Some(end) = rest.find('"') {
                let path = rest[..end].trim();
                if is_doc_path(path) {
                    paths.push(path.to_string());
                }
            }
            search_from = start;
        }
    }
    paths
}

fn find_from_ascii_ci(haystack: &str, needle: &str, from: usize) -> Option<usize> {
    if from > haystack.len() || !haystack.is_char_boundary(from) {
        return None;
    }
    let nlen = needle.len();
    if nlen == 0 {
        return None;
    }
    for (rel, _) in haystack[from..].char_indices() {
        let abs = from + rel;
        let end = abs.checked_add(nlen)?;
        if end > haystack.len() {
            return None;
        }
        if !haystack.is_char_boundary(end) {
            continue;
        }
        if haystack[abs..end].eq_ignore_ascii_case(needle) {
            return Some(abs);
        }
    }
    None
}

fn scan_token_start(text: &str, from: usize) -> usize {
    let mut token_start = from;
    loop {
        let Some((prev_idx, prev_ch)) = text[..token_start].char_indices().next_back() else {
            break;
        };
        if prev_ch.is_whitespace() || matches!(prev_ch, '(' | '[' | '"' | '\'') {
            break;
        }
        token_start = prev_idx;
    }
    token_start
}

fn find_bare_doc_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for ext in DOC_EXTENSIONS {
        let mut search_from = 0;
        while let Some(ext_start) = find_from_ascii_ci(text, ext, search_from) {
            let ext_end = ext_start + ext.len();
            if let Some(next) = text[ext_end..].chars().next() {
                if next.is_ascii_alphanumeric() || next == '_' {
                    search_from = ext_end;
                    continue;
                }
            }
            let token_start = scan_token_start(text, ext_start);
            let path = trim_trailing_punct(&text[token_start..ext_end]);
            if is_doc_path(path) && !is_http_url(path) {
                paths.push(path.to_string());
            }
            search_from = ext_end;
        }
    }
    paths
}

pub(crate) fn collect_json_strings(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(s) if !s.is_empty() => out.push(s.clone()),
        Value::Array(arr) => {
            for v in arr {
                collect_json_strings(v, out);
            }
        }
        Value::Object(map) => {
            for v in map.values() {
                collect_json_strings(v, out);
            }
        }
        _ => {}
    }
}

pub(crate) fn texts_from_jsonl(path: &Path) -> Vec<(u64, String)> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    let mut texts = Vec::new();
    for (i, line) in BufReader::new(file).lines().enumerate() {
        let Ok(line) = line else {
            continue;
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let mut parts = Vec::new();
        collect_json_strings(&value, &mut parts);
        if !parts.is_empty() {
            texts.push((i as u64, parts.join("\n")));
        }
    }
    texts
}

pub(crate) fn texts_from_json_or_jsonl(path: &Path) -> Vec<(u64, String)> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.ends_with(".jsonl") {
        return texts_from_jsonl(path);
    }
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    if let Ok(value) = serde_json::from_str::<Value>(&raw) {
        let mut parts = Vec::new();
        collect_json_strings(&value, &mut parts);
        if parts.is_empty() {
            return Vec::new();
        }
        return vec![(0, parts.join("\n"))];
    }
    texts_from_jsonl(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_urls_and_strips_trailing_punct() {
        let texts = vec![(
            1,
            "see https://example.com/a). and https://example.com/a".into(),
        )];
        let r = collect_from_texts(&texts, "/tmp/proj");
        assert_eq!(r.links.len(), 1);
        assert_eq!(r.links[0].url, "https://example.com/a");
    }

    #[test]
    fn docs_whitelist_and_resolve_relative() {
        let dir = std::env::temp_dir().join(format!("sema-art-docs-{}", std::process::id()));
        let docs = dir.join("docs");
        std::fs::create_dir_all(&docs).unwrap();
        let plan = docs.join("plan.md");
        std::fs::write(&plan, "# plan\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        let texts = vec![(1, "wrote docs/plan.md and secret.env".into())];
        let r = collect_from_texts(&texts, &cwd);
        assert_eq!(r.docs.len(), 1);
        assert!(
            r.docs[0].path.ends_with("docs/plan.md") || r.docs[0].path.contains("docs/plan.md")
        );
        assert_eq!(r.docs[0].label, "plan.md");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn docs_missing_file_filtered_out() {
        let texts = vec![(1, "wrote /no/such/sema-missing-plan.md".into())];
        let r = collect_from_texts(&texts, "/tmp");
        assert!(r.docs.is_empty());
    }

    #[test]
    fn newer_appearance_wins_dedupe_and_sort() {
        let texts = vec![
            (1, "https://old.example/x".into()),
            (2, "https://new.example/y".into()),
            (3, "https://old.example/x".into()),
        ];
        let r = collect_from_texts(&texts, "/tmp");
        assert_eq!(r.links.len(), 2);
        assert_eq!(r.links[0].url, "https://old.example/x"); // seq 3 newest
        assert_eq!(r.links[1].url, "https://new.example/y");
    }

    #[test]
    fn markdown_link_doc_path() {
        let dir = std::env::temp_dir().join(format!("sema-art-md-{}", std::process::id()));
        let specs = dir.join("specs");
        std::fs::create_dir_all(&specs).unwrap();
        std::fs::write(specs.join("foo.md"), "x\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        let texts = vec![(1, "see [spec](./specs/foo.md)".into())];
        let r = collect_from_texts(&texts, &cwd);
        assert_eq!(r.docs.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cjk_prefix_does_not_panic_on_url() {
        let texts = vec![(1, "见 https://example.com/a".into())];
        let r = collect_from_texts(&texts, "/tmp/proj");
        assert_eq!(r.links.len(), 1);
        assert_eq!(r.links[0].url, "https://example.com/a");
    }

    #[test]
    fn cjk_prefix_does_not_panic_on_doc_path() {
        let dir = std::env::temp_dir().join(format!("sema-art-cjk-{}", std::process::id()));
        let docs = dir.join("docs");
        std::fs::create_dir_all(&docs).unwrap();
        std::fs::write(docs.join("plan.md"), "x\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        let texts = vec![(1, "写了 docs/plan.md".into())];
        let r = collect_from_texts(&texts, &cwd);
        assert_eq!(r.docs.len(), 1);
        assert!(
            r.docs[0].path.ends_with("docs/plan.md") || r.docs[0].path.contains("docs/plan.md")
        );
        assert_eq!(r.docs[0].label, "plan.md");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn paren_skips_http_url_even_with_md_suffix() {
        let texts = vec![(1, "see (https://example.com/foo.md)".into())];
        let r = collect_from_texts(&texts, "/tmp/proj");
        assert!(r.docs.is_empty());
        assert_eq!(r.links.len(), 1);
        assert_eq!(r.links[0].url, "https://example.com/foo.md");
    }

    #[test]
    fn paren_skips_inner_with_spaces() {
        let dir = std::env::temp_dir().join(format!("sema-art-paren-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("notes.md"), "x\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        let texts = vec![(1, "see (the notes.md)".into())];
        let paren = find_paren_doc_paths("see (the notes.md)");
        assert!(paren.is_empty());
        let r = collect_from_texts(&texts, &cwd);
        assert_eq!(r.docs.len(), 1);
        assert_eq!(r.docs[0].label, "notes.md");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_non_embeddable_urls() {
        assert!(!is_embeddable_http_url("https://"));
        assert!(!is_embeddable_http_url("file:///tmp/x"));
        assert!(is_embeddable_http_url("https://example.com/a"));
    }
}
