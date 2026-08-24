//! Read/write UTF-8 text files with a size cap (artifact preview).

use std::path::Path;

pub const DEFAULT_MAX_BYTES: u64 = 2_000_000;

pub fn read_text_file(path: &str, max_bytes: Option<u64>) -> Result<String, String> {
    let max = max_bytes.unwrap_or(DEFAULT_MAX_BYTES);
    let p = Path::new(path);
    if !p.exists() {
        return Err("not found".into());
    }
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not found".into());
    }
    if meta.len() > max {
        return Err("too large".into());
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

pub fn write_text_file(path: &str, contents: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err("not found".into());
    }
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    std::fs::write(p, contents.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{read_text_file, write_text_file};

    #[test]
    fn read_ok_and_too_large() {
        let dir = std::env::temp_dir().join(format!("sema-fs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.md");
        std::fs::write(&p, "hi").unwrap();
        assert_eq!(read_text_file(p.to_str().unwrap(), Some(10)).unwrap(), "hi");
        std::fs::write(&p, vec![b'x'; 20]).unwrap();
        assert!(read_text_file(p.to_str().unwrap(), Some(10))
            .unwrap_err()
            .contains("too large"));
    }

    #[test]
    fn read_not_found() {
        assert_eq!(
            read_text_file("/nonexistent/sema-fs-text-test.md", None).unwrap_err(),
            "not found"
        );
    }

    #[test]
    fn write_round_trip() {
        let dir = std::env::temp_dir().join(format!("sema-fs-w-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("b.txt");
        std::fs::write(&p, "old").unwrap();
        write_text_file(p.to_str().unwrap(), "new content").unwrap();
        assert_eq!(
            read_text_file(p.to_str().unwrap(), None).unwrap(),
            "new content"
        );
    }

    #[test]
    fn write_requires_existing_file() {
        let dir = std::env::temp_dir().join(format!("sema-fs-w-miss-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("missing.txt");
        assert_eq!(
            write_text_file(p.to_str().unwrap(), "x").unwrap_err(),
            "not found"
        );
    }
}
