use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A git process exited with a non-zero status.
    #[error("git {cmd}: {message}")]
    Git {
        cmd: String,
        code: Option<i32>,
        message: String,
    },
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    /// Error returned by the GitHub/GitLab REST APIs.
    #[error("{0}")]
    Api(String),
    #[error("{0}")]
    Msg(String),
}

impl Error {
    pub fn msg(s: impl Into<String>) -> Self {
        Error::Msg(s.into())
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::Api(format!("errore di rete: {e}"))
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Msg(format!("JSON non valido: {e}"))
    }
}

impl From<keyring::Error> for Error {
    fn from(e: keyring::Error) -> Self {
        Error::Msg(format!("portachiavi di sistema: {e}"))
    }
}

/// Errors cross the Tauri bridge as plain strings.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
