//! In-flight ↻ / discover claims so split panes do not collide.

use std::collections::{HashMap, HashSet};

use parking_lot::Mutex;

#[derive(Default)]
pub struct ClaimState {
    by_key: HashMap<String, HashSet<String>>,
    resume_by_session: HashMap<String, ClaimRec>,
    discover_by_session: HashMap<String, ClaimRec>,
}

#[derive(Clone)]
struct ClaimRec {
    cli_id: String,
    cwd: String,
    resume_id: String,
}

fn claim_key(cli_id: &str, cwd: &str) -> String {
    let norm = cwd
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    format!("{cli_id}\0{norm}")
}

impl ClaimState {
    pub fn claimed_ids(&self, cli_id: &str, cwd: &str, except_session_id: Option<&str>) -> Vec<String> {
        let set = match self.by_key.get(&claim_key(cli_id, cwd)) {
            Some(s) if !s.is_empty() => s,
            _ => return Vec::new(),
        };
        let Some(except) = except_session_id else {
            return set.iter().cloned().collect();
        };
        let mut own = HashSet::new();
        if let Some(a) = self.resume_by_session.get(except) {
            own.insert(a.resume_id.clone());
        }
        if let Some(b) = self.discover_by_session.get(except) {
            own.insert(b.resume_id.clone());
        }
        if own.is_empty() {
            return set.iter().cloned().collect();
        }
        set.iter()
            .filter(|id| !own.contains(*id))
            .cloned()
            .collect()
    }

    fn add(&mut self, cli_id: &str, cwd: &str, id: &str) {
        if id.is_empty() {
            return;
        }
        self.by_key
            .entry(claim_key(cli_id, cwd))
            .or_default()
            .insert(id.to_string());
    }

    fn release(&mut self, cli_id: &str, cwd: &str, id: &str) {
        if id.is_empty() {
            return;
        }
        if let Some(set) = self.by_key.get_mut(&claim_key(cli_id, cwd)) {
            set.remove(id);
        }
    }

    pub fn clear_resume(&mut self, session_id: &str) {
        if let Some(prev) = self.resume_by_session.remove(session_id) {
            self.release(&prev.cli_id, &prev.cwd, &prev.resume_id);
        }
    }

    pub fn clear_discover(&mut self, session_id: &str) {
        if let Some(prev) = self.discover_by_session.remove(session_id) {
            self.release(&prev.cli_id, &prev.cwd, &prev.resume_id);
        }
    }

    pub fn bind_resume(&mut self, session_id: &str, cli_id: &str, cwd: &str, resume_id: Option<&str>) {
        self.clear_discover(session_id);
        self.clear_resume(session_id);
        let Some(id) = resume_id.filter(|s| !s.is_empty()) else {
            return;
        };
        self.add(cli_id, cwd, id);
        self.resume_by_session.insert(
            session_id.to_string(),
            ClaimRec {
                cli_id: cli_id.to_string(),
                cwd: cwd.to_string(),
                resume_id: id.to_string(),
            },
        );
    }

    pub fn bind_discover(
        &mut self,
        session_id: &str,
        cli_id: &str,
        cwd: &str,
        resume_id: Option<&str>,
    ) {
        self.clear_resume(session_id);
        self.clear_discover(session_id);
        let Some(id) = resume_id.filter(|s| !s.is_empty()) else {
            return;
        };
        self.add(cli_id, cwd, id);
        self.discover_by_session.insert(
            session_id.to_string(),
            ClaimRec {
                cli_id: cli_id.to_string(),
                cwd: cwd.to_string(),
                resume_id: id.to_string(),
            },
        );
    }
}

pub type SharedClaims = Mutex<ClaimState>;
