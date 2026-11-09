//! Language of the texts composed by the backend (errors, outcomes) and of git's own messages.
//!
//! The frontend resolves the user's choice ("system" included) and sets it once at startup and
//! on every change; until then everything is in Italian.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

/// Set the active language: `"en"` for English, anything else for Italian.
pub fn set_language(code: &str) {
    ENGLISH.store(code == "en", Ordering::Relaxed);
}

pub fn is_english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// Value of `LANGUAGE` for git processes, so that git's own messages follow the UI language.
pub fn git_language() -> &'static str {
    if is_english() {
        "en"
    } else {
        "it"
    }
}

/// `format!` with an Italian and an English text; the active language picks one.
/// Both format strings receive the same arguments and implicit captures:
/// `tr!("il branch {branch} non esiste", "branch {branch} does not exist")`.
#[macro_export]
macro_rules! tr {
    ($it:literal, $en:literal $(, $($args:tt)*)?) => {
        if $crate::i18n::is_english() {
            format!($en $(, $($args)*)?)
        } else {
            format!($it $(, $($args)*)?)
        }
    };
}
