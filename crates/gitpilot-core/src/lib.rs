//! GitPilot core: everything that does not depend on the UI shell.

pub mod accounts;
pub mod conflict;
pub mod diff;
pub mod error;
pub mod git;
pub mod gitflow;
pub mod graph;
pub mod i18n;
pub mod markdown;
pub mod model;
pub mod ops;
pub mod providers;
pub mod remote_url;
pub mod repo;
pub mod settings;
pub mod util;

pub use error::{Error, Result};
pub use git::Git;
