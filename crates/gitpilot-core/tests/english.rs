//! Backend messages and git output in English. A separate test binary (= process), so the
//! global language set here cannot leak into the Italian assertions of the other tests.

use std::path::Path;

use gitpilot_core::{i18n, ops, Git};

fn new_repo(dir: &Path) -> Git {
    ops::init(dir, "main").unwrap();
    let g = Git::new(dir);
    g.run(["config", "user.name", "Test User"]).unwrap();
    g.run(["config", "user.email", "test@example.com"]).unwrap();
    g.run(["config", "commit.gpgsign", "false"]).unwrap();
    g
}

fn commit_file(g: &Git, file: &str, content: &str, msg: &str) {
    std::fs::write(g.dir.join(file), content).unwrap();
    ops::stage(g, &[file.to_string()]).unwrap();
    ops::commit(g, msg, false).unwrap();
}

#[test]
fn messages_follow_the_english_language() {
    i18n::set_language("en");
    let t = tempfile::tempdir().unwrap();
    let origin_dir = t.path().join("origin.git");
    Git::new(t.path()).run(["init", "--bare", "-b", "main", origin_dir.to_str().unwrap()]).unwrap();
    let a = new_repo(&t.path().join("a"));
    commit_file(&a, "x.txt", "1\n", "one");
    ops::add_remote(&a, "origin", origin_dir.to_str().unwrap()).unwrap();
    ops::push(&a, None, None, false, &vec![], &mut |_| {}).unwrap();
    for name in ["diverged", "old"] {
        ops::create_branch(&a, name, None, false).unwrap();
        ops::push(&a, Some(name), None, false, &vec![], &mut |_| {}).unwrap();
    }

    let dest = t.path().join("b");
    ops::clone(origin_dir.to_str().unwrap(), &dest, &vec![], &mut |_| {}).unwrap();
    let b = Git::new(&dest);
    b.run(["config", "user.name", "B"]).unwrap();
    b.run(["config", "user.email", "b@example.com"]).unwrap();
    b.run(["config", "commit.gpgsign", "false"]).unwrap();
    for name in ["diverged", "old"] {
        b.run(["branch", "--track", name, &format!("origin/{name}")]).unwrap();
    }
    b.run(["branch", "local-only"]).unwrap();

    // Messages composed by GitPilot.
    let err = |r: gitpilot_core::Result<String>| r.unwrap_err().to_string();
    assert_eq!(err(ops::pull_branch(&b, "nope", &vec![], &mut |_| {})), "branch nope does not exist");
    assert_eq!(err(ops::pull_branch(&b, "local-only", &vec![], &mut |_| {})), "local-only has no upstream: set one before pulling");
    assert_eq!(ops::commit(&b, "  ", false).unwrap_err().to_string(), "the commit message is empty");

    ops::checkout(&a, "diverged").unwrap();
    commit_file(&a, "x.txt", "remote\n", "remote work");
    ops::push(&a, None, None, false, &vec![], &mut |_| {}).unwrap();
    ops::checkout(&a, "main").unwrap();
    commit_file(&a, "x.txt", "2\n", "two");
    commit_file(&a, "x.txt", "3\n", "three");
    ops::push(&a, None, None, false, &vec![], &mut |_| {}).unwrap();
    ops::delete_remote_branch(&a, "origin", "old", &vec![]).unwrap();
    ops::checkout(&b, "diverged").unwrap();
    commit_file(&b, "y.txt", "local\n", "local work");
    ops::checkout(&b, "main").unwrap();

    let r = ops::pull_all_branches(&b, &vec![], &mut |_| {}).unwrap();
    let reasons: Vec<(&str, &str)> = r.skipped.iter().map(|s| (s.name.as_str(), s.reason.as_str())).collect();
    assert_eq!(
        reasons,
        [("diverged", "diverged from origin/diverged (1 ahead, 1 behind)"), ("old", "origin/old deleted on the remote")]
    );
    assert_eq!(r.updated.len(), 1);
    assert_eq!(r.updated[0].name, "main");

    // git's own messages follow the language too (LANGUAGE=en).
    let e = b.run(["checkout", "no-such-thing"]).unwrap_err().to_string();
    assert!(e.contains("did not match any file(s) known to git"), "{e}");
}

#[test]
fn plural_of_commits() {
    i18n::set_language("en");
    let t = tempfile::tempdir().unwrap();
    let origin_dir = t.path().join("origin.git");
    Git::new(t.path()).run(["init", "--bare", "-b", "main", origin_dir.to_str().unwrap()]).unwrap();
    let a = new_repo(&t.path().join("a"));
    commit_file(&a, "x.txt", "1\n", "one");
    ops::add_remote(&a, "origin", origin_dir.to_str().unwrap()).unwrap();
    ops::push(&a, None, None, false, &vec![], &mut |_| {}).unwrap();
    let dest = t.path().join("b");
    ops::clone(origin_dir.to_str().unwrap(), &dest, &vec![], &mut |_| {}).unwrap();
    let b = Git::new(&dest);
    ops::create_branch(&b, "topic", None, true).unwrap();

    commit_file(&a, "x.txt", "2\n", "two");
    ops::push(&a, None, None, false, &vec![], &mut |_| {}).unwrap();
    assert_eq!(ops::pull_branch(&b, "main", &vec![], &mut |_| {}).unwrap(), "main fast-forwarded to origin/main (1 commit)");
    commit_file(&a, "x.txt", "3\n", "three");
    commit_file(&a, "x.txt", "4\n", "four");
    ops::push(&a, None, None, false, &vec![], &mut |_| {}).unwrap();
    assert_eq!(ops::pull_branch(&b, "main", &vec![], &mut |_| {}).unwrap(), "main fast-forwarded to origin/main (2 commits)");
    assert_eq!(ops::pull_branch(&b, "main", &vec![], &mut |_| {}).unwrap(), "main is already up to date");
}
