//! End-to-end tests against real temporary repositories.

use std::path::Path;

use gitpilot_core::conflict::{self, Segment};
use gitpilot_core::gitflow::{self, FinishOptions};
use gitpilot_core::model::GitFlowConfig;
use gitpilot_core::{ops, repo, Git};

fn new_repo(dir: &Path) -> Git {
    ops::init(dir, "main").unwrap();
    let g = Git::new(dir);
    g.run(["config", "user.name", "Test User"]).unwrap();
    g.run(["config", "user.email", "test@example.com"]).unwrap();
    g.run(["config", "commit.gpgsign", "false"]).unwrap();
    g.run(["config", "tag.gpgsign", "false"]).unwrap();
    g
}

fn write(g: &Git, file: &str, content: &str) {
    let p = g.dir.join(file);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(p, content).unwrap();
}

fn commit_file(g: &Git, file: &str, content: &str, msg: &str) {
    write(g, file, content);
    ops::stage(g, &[file.to_string()]).unwrap();
    ops::commit(g, msg, false).unwrap();
}

fn branch(g: &Git) -> String {
    g.run(["symbolic-ref", "--short", "HEAD"]).unwrap().trim().to_string()
}

#[test]
fn status_commit_and_graph() {
    let t = tempfile::tempdir().unwrap();
    let g = new_repo(t.path());
    assert!(repo::graph(&g, 100, false).unwrap().rows.is_empty());

    write(&g, "a.txt", "hello\n");
    let st = repo::status(&g).unwrap();
    assert_eq!(st.unstaged[0].status, "?");
    ops::stage_all(&g).unwrap();
    assert_eq!(repo::status(&g).unwrap().staged[0].status, "A");
    // Unstage works without a HEAD commit too.
    ops::unstage_all(&g).unwrap();
    assert!(repo::status(&g).unwrap().staged.is_empty());
    ops::stage_all(&g).unwrap();
    ops::commit(&g, "first", false).unwrap();
    commit_file(&g, "b.txt", "b\n", "second\n\nbody text");

    let ov = repo::overview(&g, &[]).unwrap();
    assert_eq!(ov.head.branch.as_deref(), Some("main"));
    assert_eq!(ov.locals.len(), 1);
    assert!(ov.locals[0].is_head);

    write(&g, "a.txt", "changed\n");
    let gr = repo::graph(&g, 100, true).unwrap();
    assert_eq!(gr.rows.len(), 3);
    assert!(gr.rows[0].wip);
    assert_eq!(gr.rows[1].subject, "second");
    assert_eq!(gr.rows[1].refs[0].name, "main");
    assert!(gr.rows[1].refs[0].current);

    let d = repo::commit_details(&g, &gr.rows[1].hash).unwrap();
    assert_eq!(d.subject, "second");
    assert_eq!(d.body, "body text");
    assert_eq!(d.files.len(), 1);
    // Root commit file list.
    let root = repo::commit_details(&g, &gr.rows[2].hash).unwrap();
    assert_eq!(root.files[0].path, "a.txt");
    let fd = repo::commit_file_diff(&g, &gr.rows[2].hash, "a.txt", None).unwrap();
    assert_eq!(fd.added, 1);

    // Amend keeps a single commit.
    ops::stage_all(&g).unwrap();
    ops::commit(&g, "", true).unwrap();
    assert_eq!(repo::graph(&g, 100, false).unwrap().rows.len(), 2);
    assert_eq!(repo::last_message(&g).unwrap(), "second\n\nbody text");
}

#[test]
fn hunk_stage_unstage_discard() {
    let t = tempfile::tempdir().unwrap();
    let g = new_repo(t.path());
    let original: String = (1..=40).map(|i| format!("line {i}\n")).collect();
    commit_file(&g, "f.txt", &original, "base");
    let changed = original.replace("line 2\n", "LINE TWO\n").replace("line 38\n", "LINE 38\n");
    write(&g, "f.txt", &changed);

    let d = repo::working_diff(&g, "f.txt", None, false, false).unwrap();
    assert_eq!(d.hunks.len(), 2);
    ops::apply_hunk(&g, "f.txt", None, &d.hunks[0].header, "stage").unwrap();
    let staged = repo::working_diff(&g, "f.txt", None, true, false).unwrap();
    assert_eq!(staged.hunks.len(), 1);
    assert!(staged.hunks[0].lines.iter().any(|l| l.text == "LINE TWO"));
    let unstaged = repo::working_diff(&g, "f.txt", None, false, false).unwrap();
    assert_eq!(unstaged.hunks.len(), 1);

    ops::apply_hunk(&g, "f.txt", None, &staged.hunks[0].header, "unstage").unwrap();
    assert!(repo::working_diff(&g, "f.txt", None, true, false).unwrap().hunks.is_empty());

    let d = repo::working_diff(&g, "f.txt", None, false, false).unwrap();
    ops::apply_hunk(&g, "f.txt", None, &d.hunks[1].header, "discard").unwrap();
    let content = std::fs::read_to_string(g.dir.join("f.txt")).unwrap();
    assert!(content.contains("LINE TWO") && content.contains("line 38\n"));

    // Untracked file diff.
    write(&g, "new.txt", "x\ny\n");
    let u = repo::working_diff(&g, "new.txt", None, false, true).unwrap();
    assert_eq!(u.added, 2);
}

fn conflicting_branches(g: &Git) {
    commit_file(g, "c.txt", "top\nmiddle\nbottom\n", "base");
    ops::create_branch(g, "feature", None, true).unwrap();
    commit_file(g, "c.txt", "top\nFEATURE\nbottom\n", "feature change");
    ops::checkout(g, "main").unwrap();
    commit_file(g, "c.txt", "top\nMAIN\nbottom\n", "main change");
}

#[test]
fn merge_conflict_resolution() {
    let t = tempfile::tempdir().unwrap();
    let g = new_repo(t.path());
    conflicting_branches(&g);

    let out = ops::merge(&g, "feature", "ff").unwrap();
    assert!(out.conflicts);
    let ov = repo::overview(&g, &[]).unwrap();
    assert_eq!(ov.state.kind, "merge");
    assert!(ov.state.message.unwrap().contains("feature"));

    let doc = conflict::load(&g, "c.txt").unwrap();
    assert_eq!(doc.kind, "both-modified");
    assert_eq!(doc.theirs_name, "feature");
    assert_eq!(doc.segments.len(), 3);
    match &doc.segments[1] {
        Segment::Conflict { ours, theirs, .. } => {
            assert_eq!(ours, "MAIN\n");
            assert_eq!(theirs, "FEATURE\n");
        }
        _ => panic!("expected conflict"),
    }

    assert!(ops::continue_op(&g).is_err(), "continue must refuse while conflicted");
    conflict::resolve_with_content(&g, "c.txt", "top\nMAIN\nFEATURE\nbottom\n").unwrap();
    let out = ops::continue_op(&g).unwrap();
    assert!(!out.conflicts);
    assert_eq!(repo::overview(&g, &[]).unwrap().state.kind, "none");

    let gr = repo::graph(&g, 100, false).unwrap();
    assert_eq!(gr.rows[0].parents.len(), 2);
    assert_eq!(gr.lanes, 2);
    // Merge commit files are computed against the first parent.
    let files = repo::commit_files(&g, &gr.rows[0].hash).unwrap();
    assert_eq!(files.len(), 1);
}

#[test]
fn rebase_conflict_abort_and_take_side() {
    let t = tempfile::tempdir().unwrap();
    let g = new_repo(t.path());
    conflicting_branches(&g);
    ops::checkout(&g, "feature").unwrap();
    let out = ops::rebase(&g, "main").unwrap();
    assert!(out.conflicts);
    let st = repo::repo_state(&repo::git_dir(&g).unwrap());
    assert_eq!(st.kind, "rebase");
    ops::abort_op(&g).unwrap();
    assert_eq!(branch(&g), "feature");

    // Cherry-pick conflict resolved by taking "theirs".
    ops::checkout(&g, "main").unwrap();
    let feature_tip = g.run(["rev-parse", "feature"]).unwrap().trim().to_string();
    let out = ops::cherry_pick(&g, &feature_tip).unwrap();
    assert!(out.conflicts);
    conflict::resolve_with_side(&g, "c.txt", "theirs").unwrap();
    ops::continue_op(&g).unwrap();
    assert_eq!(std::fs::read_to_string(g.dir.join("c.txt")).unwrap(), "top\nFEATURE\nbottom\n");
}

#[test]
fn stash_roundtrip() {
    let t = tempfile::tempdir().unwrap();
    let g = new_repo(t.path());
    commit_file(&g, "a.txt", "1\n", "base");
    write(&g, "a.txt", "2\n");
    write(&g, "u.txt", "untracked\n");
    ops::stash_save(&g, "work in progress", true).unwrap();
    assert!(repo::status(&g).unwrap().is_clean());
    let ov = repo::overview(&g, &[]).unwrap();
    assert_eq!(ov.stashes.len(), 1);
    assert!(ov.stashes[0].message.contains("work in progress"));
    let out = ops::stash_apply(&g, 0, true).unwrap();
    assert!(!out.conflicts);
    assert_eq!(repo::status(&g).unwrap().unstaged.len(), 2);
    assert!(repo::overview(&g, &[]).unwrap().stashes.is_empty());
}

#[test]
fn gitflow_feature_and_release() {
    let t = tempfile::tempdir().unwrap();
    let g = new_repo(t.path());
    commit_file(&g, "readme.md", "# demo\n", "init");

    let cfg = gitflow::suggest_config(&g);
    assert_eq!(cfg.master, "main");
    let cfg = GitFlowConfig { version_tag: "v".into(), ..cfg };
    gitflow::init(&g, &cfg).unwrap();
    assert_eq!(gitflow::read_config(&g).unwrap(), Some(cfg.clone()));
    assert_eq!(branch(&g), "develop");

    let b = gitflow::start(&g, "feature", "login", None).unwrap();
    assert_eq!(b, "feature/login");
    commit_file(&g, "login.rs", "fn login() {}\n", "add login");
    let opts = FinishOptions { delete_branch: true, tag_message: None, push: false };

    // Dirty tree blocks finish.
    write(&g, "readme.md", "dirty\n");
    assert!(gitflow::finish(&g, "feature", "login", &opts, &vec![]).is_err());
    ops::discard(&g, &["readme.md".into()], &[]).unwrap();

    let out = gitflow::finish(&g, "feature", "login", &opts, &vec![]).unwrap();
    assert!(!out.conflicts, "{}", out.message);
    assert_eq!(branch(&g), "develop");
    assert!(!g.succeeds(["show-ref", "--verify", "--quiet", "refs/heads/feature/login"]).unwrap());
    assert!(g.dir.join("login.rs").exists());

    gitflow::start(&g, "release", "1.0.0", None).unwrap();
    commit_file(&g, "VERSION", "1.0.0\n", "bump version");
    let out = gitflow::finish(&g, "release", "1.0.0", &opts, &vec![]).unwrap();
    assert!(out.message.contains("v1.0.0"));
    let tag_commit = g.run(["rev-list", "-n1", "v1.0.0"]).unwrap();
    let main_commit = g.run(["rev-parse", "main"]).unwrap();
    assert_eq!(tag_commit, main_commit);
    assert!(g.succeeds(["merge-base", "--is-ancestor", "main", "develop"]).unwrap());

    gitflow::start(&g, "hotfix", "1.0.1", None).unwrap();
    assert!(!g.dir.join("unrelated").exists());
    commit_file(&g, "fix.txt", "fix\n", "hotfix");
    gitflow::finish(&g, "hotfix", "1.0.1", &opts, &vec![]).unwrap();
    let ov = repo::overview(&g, &[]).unwrap();
    assert!(ov.tags.iter().any(|t| t.name == "v1.0.1" && t.annotated));
    assert_eq!(ov.tags[0].name, "v1.0.1");
    assert!(ov.gitflow.is_some());
}

#[test]
fn gitflow_init_on_empty_repo() {
    let t = tempfile::tempdir().unwrap();
    let g = new_repo(t.path());
    gitflow::init(&g, &GitFlowConfig::default()).unwrap();
    assert_eq!(branch(&g), "develop");
    assert!(g.succeeds(["show-ref", "--verify", "--quiet", "refs/heads/main"]).unwrap());
}

#[test]
fn clone_push_pull_with_upstream() {
    let t = tempfile::tempdir().unwrap();
    let origin_dir = t.path().join("origin.git");
    Git::new(t.path()).run(["init", "--bare", "-b", "main", origin_dir.to_str().unwrap()]).unwrap();

    let a = new_repo(&t.path().join("a"));
    commit_file(&a, "x.txt", "1\n", "one");
    ops::add_remote(&a, "origin", origin_dir.to_str().unwrap()).unwrap();
    let mut lines = Vec::new();
    let msg = ops::push(&a, None, None, false, &vec![], &mut |l| lines.push(l.to_string())).unwrap();
    assert!(msg.contains("pubblicato"));
    let ov = repo::overview(&a, &[]).unwrap();
    assert_eq!(ov.head.upstream.as_deref(), Some("origin/main"));

    let dest = t.path().join("b");
    ops::clone(origin_dir.to_str().unwrap(), &dest, &vec![], &mut |_| {}).unwrap();
    let b = Git::new(&dest);
    b.run(["config", "user.name", "B"]).unwrap();
    b.run(["config", "user.email", "b@example.com"]).unwrap();

    commit_file(&a, "x.txt", "2\n", "two");
    ops::push(&a, None, None, false, &vec![], &mut |_| {}).unwrap();
    ops::fetch(&b, None, &vec![], &mut |_| {}).unwrap();
    assert_eq!(repo::overview(&b, &[]).unwrap().head.behind, 1);
    let out = ops::pull(&b, "ff-only", &vec![], &mut |_| {}).unwrap();
    assert!(!out.conflicts);
    assert_eq!(std::fs::read_to_string(dest.join("x.txt")).unwrap(), "2\n");

    // Remote branch checkout creates a tracking branch.
    ops::create_branch(&a, "topic", None, false).unwrap();
    ops::push(&a, Some("topic"), None, false, &vec![], &mut |_| {}).unwrap();
    ops::fetch(&b, Some("origin"), &vec![], &mut |_| {}).unwrap();
    assert_eq!(ops::checkout_remote(&b, "origin/topic").unwrap(), "topic");
    let ov = repo::overview(&b, &[]).unwrap();
    assert_eq!(ov.head.branch.as_deref(), Some("topic"));
    assert_eq!(ov.head.upstream.as_deref(), Some("origin/topic"));
}
