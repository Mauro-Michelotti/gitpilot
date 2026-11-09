//! Thin wrapper around the `git` executable.
//!
//! GitPilot drives the real git CLI instead of libgit2: SSH agents, credential
//! helpers, hooks, GPG signing, LFS and `includeIf` configs keep working exactly
//! as they do in the user's terminal.

use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;

use crate::error::{Error, Result};

static GIT_BIN: OnceLock<PathBuf> = OnceLock::new();

/// Locate the git executable. GUI apps on macOS start with a minimal PATH, so
/// the usual Homebrew locations are probed explicitly.
pub fn git_binary() -> &'static Path {
    GIT_BIN.get_or_init(|| {
        if let Some(p) = std::env::var_os("GITPILOT_GIT") {
            return PathBuf::from(p);
        }
        let exe = if cfg!(windows) { "git.exe" } else { "git" };
        let mut candidates: Vec<PathBuf> = Vec::new();
        if cfg!(target_os = "macos") {
            candidates.push("/opt/homebrew/bin/git".into());
            candidates.push("/usr/local/bin/git".into());
        }
        if let Some(path) = std::env::var_os("PATH") {
            candidates.extend(std::env::split_paths(&path).map(|d| d.join(exe)));
        }
        candidates.push("/usr/bin/git".into());
        candidates
            .into_iter()
            .find(|p| p.is_file())
            .unwrap_or_else(|| PathBuf::from(exe))
    })
}

pub fn git_version() -> Result<String> {
    let out = Command::new(git_binary()).arg("--version").stdin(Stdio::null()).output()?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[derive(Clone, Debug)]
pub struct Git {
    pub dir: PathBuf,
    env: Vec<(String, String)>,
    /// Extra `-c key=value` passed through GIT_CONFIG_* env vars (not visible in `ps`).
    config: Vec<(String, String)>,
}

impl Git {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Git { dir: dir.into(), env: Vec::new(), config: Vec::new() }
    }

    pub fn env(mut self, key: &str, value: &str) -> Self {
        self.env.push((key.to_string(), value.to_string()));
        self
    }

    pub fn config(mut self, key: &str, value: &str) -> Self {
        self.config.push((key.to_string(), value.to_string()));
        self
    }

    fn command<I, S>(&self, args: I) -> Command
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut cmd = Command::new(git_binary());
        cmd.current_dir(&self.dir)
            .args(["-c", "color.ui=false", "-c", "core.quotepath=false", "-c", "log.showSignature=false"])
            .args(args)
            .stdin(Stdio::null())
            // Never block on an interactive prompt: there is no terminal.
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .env("GIT_PAGER", "cat")
            .env("GIT_MERGE_AUTOEDIT", "no")
            // git's own messages (shown in errors) follow the UI language.
            .env("LANGUAGE", crate::i18n::git_language());
        if !self.config.is_empty() {
            cmd.env("GIT_CONFIG_COUNT", self.config.len().to_string());
            for (i, (k, v)) in self.config.iter().enumerate() {
                cmd.env(format!("GIT_CONFIG_KEY_{i}"), k);
                cmd.env(format!("GIT_CONFIG_VALUE_{i}"), v);
            }
        }
        for (k, v) in &self.env {
            cmd.env(k, v);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        cmd
    }

    pub fn output<I, S>(&self, args: I) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut cmd = self.command(args);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                Error::msg(crate::tr!(
                    "eseguibile git non trovato: installa git o imposta GITPILOT_GIT",
                    "git executable not found: install git or set GITPILOT_GIT"
                ))
            } else {
                Error::Io(e)
            }
        })
    }

    /// Run and return stdout; non-zero exit is an error.
    pub fn run<I, S>(&self, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let args: Vec<_> = args.into_iter().map(|a| a.as_ref().to_os_string()).collect();
        let out = self.output(&args)?;
        check(&args, &out)?;
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    pub fn run_bytes<I, S>(&self, args: I) -> Result<Vec<u8>>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let args: Vec<_> = args.into_iter().map(|a| a.as_ref().to_os_string()).collect();
        let out = self.output(&args)?;
        check(&args, &out)?;
        Ok(out.stdout)
    }

    /// Run and report only whether the exit status was zero.
    pub fn succeeds<I, S>(&self, args: I) -> Result<bool>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        Ok(self.output(args)?.status.success())
    }

    /// Run feeding `input` on stdin.
    pub fn run_stdin<I, S>(&self, args: I, input: &[u8]) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        use std::io::Write;
        let args: Vec<_> = args.into_iter().map(|a| a.as_ref().to_os_string()).collect();
        let mut cmd = self.command(&args);
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn()?;
        {
            let mut stdin = child.stdin.take().expect("stdin piped");
            stdin.write_all(input)?;
        }
        let out = child.wait_with_output()?;
        check(&args, &out)?;
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    /// Run a long operation (clone/fetch/push) streaming stderr progress lines.
    pub fn run_progress<I, S>(&self, args: I, on_progress: &mut dyn FnMut(&str)) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let args: Vec<_> = args.into_iter().map(|a| a.as_ref().to_os_string()).collect();
        let mut cmd = self.command(&args);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn()?;
        let mut stdout = child.stdout.take().expect("stdout piped");
        let reader = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stdout.read_to_end(&mut buf);
            buf
        });
        let mut stderr = child.stderr.take().expect("stderr piped");
        let mut all = Vec::new();
        let mut line = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = stderr.read(&mut buf)?;
            if n == 0 {
                break;
            }
            for &b in &buf[..n] {
                all.push(b);
                if b == b'\r' || b == b'\n' {
                    if !line.is_empty() {
                        on_progress(String::from_utf8_lossy(&line).trim());
                        line.clear();
                    }
                } else {
                    line.push(b);
                }
            }
        }
        if !line.is_empty() {
            on_progress(String::from_utf8_lossy(&line).trim());
        }
        let status = child.wait()?;
        let stdout = reader.join().unwrap_or_default();
        if !status.success() {
            return Err(git_error(&args, status.code(), &all, &stdout));
        }
        Ok(String::from_utf8_lossy(&stdout).into_owned())
    }
}

fn check(args: &[std::ffi::OsString], out: &Output) -> Result<()> {
    if out.status.success() {
        Ok(())
    } else {
        Err(git_error(args, out.status.code(), &out.stderr, &out.stdout))
    }
}

fn git_error(args: &[std::ffi::OsString], code: Option<i32>, stderr: &[u8], stdout: &[u8]) -> Error {
    let cmd = args
        .iter()
        .map(|a| a.to_string_lossy())
        .find(|a| !a.starts_with('-'))
        .unwrap_or_default()
        .into_owned();
    let mut message = clean_stderr(&String::from_utf8_lossy(stderr));
    if message.is_empty() {
        message = String::from_utf8_lossy(stdout).trim().to_string();
    }
    if message.is_empty() {
        message = crate::tr!("terminato con codice {}", "exited with code {}", code.map_or("?".into(), |c| c.to_string()));
    }
    Error::Git { cmd, code, message }
}

/// Drop transfer-progress noise, keep the meaningful lines.
fn clean_stderr(s: &str) -> String {
    let lines: Vec<&str> = s
        .split('\n')
        .map(|l| l.rsplit('\r').next().unwrap_or(l).trim_end())
        .filter(|l| !l.is_empty())
        .filter(|l| {
            let progress = l.contains('%')
                && ["objects", "deltas", "Counting", "Compressing", "Receiving", "Resolving", "Writing", "Enumerating"]
                    .iter()
                    .any(|k| l.contains(k));
            !progress
        })
        .collect();
    let start = lines.len().saturating_sub(25);
    lines[start..].join("\n")
}
