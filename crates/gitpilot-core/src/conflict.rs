//! Conflict inspection and resolution.

use serde::Serialize;

use crate::error::{Error, Result};
use crate::git::Git;
use crate::repo;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Segment {
    Common {
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Conflict {
        ours: String,
        base: Option<String>,
        theirs: String,
        ours_label: String,
        theirs_label: String,
    },
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDoc {
    pub path: String,
    pub kind: String,
    pub binary: bool,
    /// Text conflicts parsed from the working-tree file's markers.
    pub segments: Vec<Segment>,
    pub ours_exists: bool,
    pub theirs_exists: bool,
    /// Human-readable names of the two sides ("HEAD", branch name...).
    pub ours_name: String,
    pub theirs_name: String,
}

enum State {
    Common,
    Ours,
    Base,
    Theirs,
}

fn marker(line: &str, c: char) -> Option<&str> {
    let prefix = String::from(c).repeat(7);
    let rest = line.strip_prefix(&prefix)?;
    if rest.starts_with(c) {
        return None;
    }
    let rest = rest.trim_end_matches(['\n', '\r']);
    if rest.is_empty() || rest.starts_with(' ') {
        Some(rest.trim())
    } else {
        None
    }
}

/// Split a file containing conflict markers (merge, diff3 or zdiff3 style).
pub fn parse_markers(text: &str) -> Vec<Segment> {
    let mut segs = Vec::new();
    let mut common = String::new();
    let (mut ours, mut base, mut theirs) = (String::new(), None::<String>, String::new());
    let mut ours_label = String::new();
    let mut state = State::Common;

    for line in text.split_inclusive('\n') {
        match state {
            State::Common => {
                if let Some(label) = marker(line, '<') {
                    if !common.is_empty() {
                        segs.push(Segment::Common { text: std::mem::take(&mut common) });
                    }
                    ours_label = label.to_string();
                    state = State::Ours;
                } else {
                    common.push_str(line);
                }
            }
            State::Ours | State::Base => {
                if marker(line, '|').is_some() {
                    base = Some(String::new());
                    state = State::Base;
                } else if marker(line, '=').is_some_and(str::is_empty) {
                    state = State::Theirs;
                } else if let State::Base = state {
                    base.get_or_insert_with(String::new).push_str(line);
                } else {
                    ours.push_str(line);
                }
            }
            State::Theirs => {
                if let Some(label) = marker(line, '>') {
                    segs.push(Segment::Conflict {
                        ours: std::mem::take(&mut ours),
                        base: base.take(),
                        theirs: std::mem::take(&mut theirs),
                        ours_label: std::mem::take(&mut ours_label),
                        theirs_label: label.to_string(),
                    });
                    state = State::Common;
                } else {
                    theirs.push_str(line);
                }
            }
        }
    }
    // Unterminated conflict: keep the text rather than losing it.
    match state {
        State::Common => {}
        _ => {
            common.push_str(&ours);
            common.push_str(&theirs);
        }
    }
    if !common.is_empty() {
        segs.push(Segment::Common { text: common });
    }
    segs
}

fn stage_exists(git: &Git, stage: u8, path: &str) -> bool {
    git.succeeds(["cat-file", "-e", &format!(":{stage}:{path}")]).unwrap_or(false)
}

fn side_names(git: &Git) -> (String, String) {
    let gd = match repo::git_dir(git) {
        Ok(d) => d,
        Err(_) => return ("Nostro".into(), "Loro".into()),
    };
    let ours = git
        .run(["symbolic-ref", "-q", "--short", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "HEAD".into());
    let read = |f: &str| std::fs::read_to_string(gd.join(f)).ok().map(|s| s.trim().to_string());
    let short = |h: String| h.chars().take(8).collect::<String>();
    if gd.join("rebase-merge").exists() || gd.join("rebase-apply").exists() {
        // During a rebase "ours" is the branch being rebased onto.
        let onto = read("rebase-merge/onto").or_else(|| read("rebase-apply/onto")).map(short).unwrap_or_default();
        let head = read("rebase-merge/head-name")
            .or_else(|| read("rebase-apply/head-name"))
            .map(|h| h.trim_start_matches("refs/heads/").to_string())
            .unwrap_or_else(|| "commit in rebase".into());
        return (format!("Base del rebase {onto}").trim().to_string(), head);
    }
    let theirs = read("MERGE_HEAD")
        .or_else(|| read("CHERRY_PICK_HEAD"))
        .or_else(|| read("REVERT_HEAD"))
        .map(|h| {
            let h = h.lines().next().unwrap_or_default().to_string();
            git.run(["name-rev", "--name-only", "--no-undefined", "--exclude=refs/tags/*", &h])
                .map(|n| n.trim().to_string())
                .unwrap_or_else(|_| short(h))
        })
        .unwrap_or_else(|| "Loro".into());
    (ours, theirs)
}

pub fn load(git: &Git, path: &str) -> Result<ConflictDoc> {
    let status = repo::status(git)?;
    let kind = status
        .conflicted
        .iter()
        .find(|c| c.path == path)
        .map(|c| c.kind.clone())
        .ok_or_else(|| Error::msg(format!("{path} non è in conflitto")))?;
    let full = git.dir.join(path);
    let bytes = std::fs::read(&full).unwrap_or_default();
    let binary = bytes.iter().take(8000).any(|&b| b == 0);
    let segments = if binary { vec![] } else { parse_markers(&String::from_utf8_lossy(&bytes)) };
    let (ours_name, theirs_name) = side_names(git);
    Ok(ConflictDoc {
        path: path.to_string(),
        kind,
        binary,
        segments,
        ours_exists: stage_exists(git, 2, path),
        theirs_exists: stage_exists(git, 3, path),
        ours_name,
        theirs_name,
    })
}

/// Write the resolved content and mark the file as resolved.
pub fn resolve_with_content(git: &Git, path: &str, content: &str) -> Result<()> {
    std::fs::write(git.dir.join(path), content)?;
    git.run(["add", "--", path])?;
    Ok(())
}

/// side: "ours" | "theirs" | "delete"
pub fn resolve_with_side(git: &Git, path: &str, side: &str) -> Result<()> {
    match side {
        "delete" => {
            git.run(["rm", "-q", "--ignore-unmatch", "--", path])?;
        }
        "ours" | "theirs" => {
            let stage = if side == "ours" { 2 } else { 3 };
            if stage_exists(git, stage, path) {
                git.run(["checkout", &format!("--{side}"), "--", path])?;
                git.run(["add", "--", path])?;
            } else {
                // That side deleted the file.
                git.run(["rm", "-q", "--ignore-unmatch", "--", path])?;
            }
        }
        _ => return Err(Error::msg(format!("lato sconosciuto: {side}"))),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_merge_and_diff3_markers() {
        let text = "a\n<<<<<<< HEAD\nours\n||||||| base\norig\n=======\ntheirs\n>>>>>>> feature\nz\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> feature\n";
        let s = parse_markers(text);
        assert_eq!(s.len(), 4);
        assert_eq!(s[0], Segment::Common { text: "a\n".into() });
        assert_eq!(
            s[1],
            Segment::Conflict {
                ours: "ours\n".into(),
                base: Some("orig\n".into()),
                theirs: "theirs\n".into(),
                ours_label: "HEAD".into(),
                theirs_label: "feature".into()
            }
        );
        assert_eq!(s[2], Segment::Common { text: "z\n".into() });
        match &s[3] {
            Segment::Conflict { base, ours, .. } => {
                assert!(base.is_none());
                assert_eq!(ours, "x\n");
            }
            _ => panic!("expected conflict"),
        }
    }

    #[test]
    fn ignores_longer_marker_runs() {
        let s = parse_markers("========\n<<<<<<<< not a marker\n");
        assert_eq!(s.len(), 1);
    }
}
