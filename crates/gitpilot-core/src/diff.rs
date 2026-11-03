//! Unified diff parsing and single-hunk patch extraction.

use crate::model::{DiffLine, FileDiff, Hunk};

const MAX_LINES: usize = 20_000;

fn parse_range(s: &str) -> (u32, u32) {
    let s = s.trim_start_matches(['-', '+']);
    match s.split_once(',') {
        Some((a, b)) => (a.parse().unwrap_or(0), b.parse().unwrap_or(0)),
        None => (s.parse().unwrap_or(0), 1),
    }
}

fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    // @@ -a,b +c,d @@ context
    let rest = line.strip_prefix("@@ ")?;
    let end = rest.find(" @@")?;
    let mut parts = rest[..end].split_whitespace();
    let (os, ol) = parse_range(parts.next()?);
    let (ns, nl) = parse_range(parts.next()?);
    Some((os, ol, ns, nl))
}

fn strip_path(p: &str) -> String {
    let p = p.trim_end_matches('\t');
    p.strip_prefix("a/").or_else(|| p.strip_prefix("b/")).unwrap_or(p).to_string()
}

/// Parse the output of `git diff`/`git show` (one or more files).
pub fn parse(text: &str) -> Vec<FileDiff> {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut total = 0usize;
    let mut old_no = 0u32;
    let mut new_no = 0u32;
    let mut in_hunk = false;

    for raw in text.split_inclusive('\n') {
        let line = raw.strip_suffix('\n').unwrap_or(raw);
        let line = line.strip_suffix('\r').unwrap_or(line);

        if line.starts_with("diff --git ") || line.starts_with("diff --cc ") || line.starts_with("diff --combined ") {
            in_hunk = false;
            let mut f = FileDiff { header: format!("{line}\n"), ..Default::default() };
            // diff --git a/path b/path  (paths without spaces are the common case;
            // the ---/+++ lines below give the authoritative names)
            if let Some(rest) = line.strip_prefix("diff --git ") {
                if let Some(idx) = rest.find(" b/") {
                    f.old_path = Some(strip_path(&rest[..idx]));
                    f.path = rest[idx + 1..].trim_start_matches("b/").to_string();
                }
            }
            files.push(f);
            continue;
        }
        let Some(f) = files.last_mut() else {
            // `git diff --no-index` output always starts with "diff --git"; ignore stray lines.
            continue;
        };

        if !in_hunk || line.starts_with("@@ ") {
            if let Some((os, ol, ns, nl)) = parse_hunk_header(line) {
                in_hunk = true;
                old_no = os;
                new_no = ns;
                f.hunks.push(Hunk {
                    header: line.to_string(),
                    old_start: os,
                    old_lines: ol,
                    new_start: ns,
                    new_lines: nl,
                    lines: Vec::new(),
                });
                continue;
            }
            if !in_hunk {
                f.header.push_str(line);
                f.header.push('\n');
                if let Some(p) = line.strip_prefix("--- ") {
                    if p != "/dev/null" {
                        f.old_path = Some(strip_path(p));
                    } else {
                        f.old_path = None;
                    }
                } else if let Some(p) = line.strip_prefix("+++ ") {
                    if p != "/dev/null" {
                        f.path = strip_path(p);
                    }
                } else if let Some(p) = line.strip_prefix("rename to ") {
                    f.path = p.to_string();
                } else if let Some(p) = line.strip_prefix("rename from ") {
                    f.old_path = Some(p.to_string());
                } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
                    f.binary = true;
                }
                continue;
            }
        }

        if total >= MAX_LINES {
            f.truncated = true;
            continue;
        }
        total += 1;
        let hunk = f.hunks.last_mut().expect("in hunk");
        let (kind, text) = match line.chars().next() {
            Some('+') => ("+", &line[1..]),
            Some('-') => ("-", &line[1..]),
            Some('\\') => ("\\", line),
            Some(' ') => (" ", &line[1..]),
            _ => (" ", line),
        };
        let (o, n) = match kind {
            "+" => {
                f.added += 1;
                new_no += 1;
                (None, Some(new_no - 1))
            }
            "-" => {
                f.removed += 1;
                old_no += 1;
                (Some(old_no - 1), None)
            }
            "\\" => (None, None),
            _ => {
                old_no += 1;
                new_no += 1;
                (Some(old_no - 1), Some(new_no - 1))
            }
        };
        hunk.lines.push(DiffLine { kind: kind.to_string(), old_no: o, new_no: n, text: text.to_string() });
    }

    // Old path equal to new path is not a rename.
    for f in &mut files {
        if f.old_path.as_deref() == Some(f.path.as_str()) {
            f.old_path = None;
        }
    }
    files
}

/// Build a patch containing only the hunk whose header matches `hunk_header`,
/// suitable for `git apply [--cached] [-R]`.
pub fn single_hunk_patch(file: &FileDiff, hunk_header: &str) -> Option<String> {
    let hunk = file.hunks.iter().find(|h| h.header == hunk_header)?;
    let mut out = file.header.clone();
    out.push_str(&hunk.header);
    out.push('\n');
    for l in &hunk.lines {
        if l.kind == "\\" {
            out.push_str(&l.text);
        } else {
            out.push_str(&l.kind);
            out.push_str(&l.text);
        }
        out.push('\n');
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "diff --git a/src/a.txt b/src/a.txt
index 1111111..2222222 100644
--- a/src/a.txt
+++ b/src/a.txt
@@ -1,3 +1,3 @@ fn main
 one
-two
+TWO
 three
@@ -10 +10,2 @@
 ten
+eleven
\\ No newline at end of file
";

    #[test]
    fn parses_hunks_and_line_numbers() {
        let files = parse(SAMPLE);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.path, "src/a.txt");
        assert_eq!(f.old_path, None);
        assert_eq!(f.hunks.len(), 2);
        assert_eq!((f.added, f.removed), (2, 1));
        let h = &f.hunks[0];
        assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines), (1, 3, 1, 3));
        assert_eq!(h.lines[1], DiffLine { kind: "-".into(), old_no: Some(2), new_no: None, text: "two".into() });
        assert_eq!(h.lines[2].new_no, Some(2));
        assert_eq!(f.hunks[1].lines[1].new_no, Some(11));
        assert_eq!(f.hunks[1].lines[2].kind, "\\");
    }

    #[test]
    fn single_hunk_roundtrip() {
        let files = parse(SAMPLE);
        let p = single_hunk_patch(&files[0], "@@ -10 +10,2 @@").unwrap();
        assert!(p.starts_with("diff --git a/src/a.txt b/src/a.txt\nindex"));
        assert!(p.ends_with("@@ -10 +10,2 @@\n ten\n+eleven\n\\ No newline at end of file\n"));
        assert!(!p.contains("TWO"));
    }

    #[test]
    fn detects_binary_and_new_file() {
        let t = "diff --git a/img.png b/img.png\nnew file mode 100644\nindex 0000000..abc\nBinary files /dev/null and b/img.png differ\n";
        let f = &parse(t)[0];
        assert!(f.binary);
        assert_eq!(f.path, "img.png");
    }
}
