//! The content locales (Settings → Internationalization): codes documents of localized
//! types may be written in, and the default one used when a request names none. Shared by
//! every Document Service and updated in place when an admin changes them.

use std::sync::{Arc, RwLock};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Locale {
    pub code: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocaleSet {
    pub locales: Vec<Locale>,
    pub default: String,
}

impl Default for LocaleSet {
    fn default() -> Self {
        Self {
            locales: vec![Locale { code: "en".into(), name: "English".into() }],
            default: "en".into(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Locales(Arc<RwLock<LocaleSet>>);

impl Locales {
    pub fn new(set: LocaleSet) -> Self {
        Self(Arc::new(RwLock::new(set)))
    }

    pub fn get(&self) -> LocaleSet {
        self.0.read().expect("locales lock").clone()
    }

    pub fn set(&self, set: LocaleSet) {
        *self.0.write().expect("locales lock") = set;
    }

    pub fn default_code(&self) -> String {
        self.0.read().expect("locales lock").default.clone()
    }

    pub fn contains(&self, code: &str) -> bool {
        self.0.read().expect("locales lock").locales.iter().any(|locale| locale.code == code)
    }
}

/// Whether `code` looks like a locale code (`en`, `pt-BR`, `zh-Hans`, `es-419`…).
pub fn valid_code(code: &str) -> bool {
    let mut parts = code.split('-');
    let language = parts.next().unwrap_or_default();
    (2..=3).contains(&language.len())
        && language.chars().all(|c| c.is_ascii_lowercase())
        && parts.all(|part| {
            (2..=8).contains(&part.len()) && part.chars().all(|c| c.is_ascii_alphanumeric())
        })
        && code.len() <= 35
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes() {
        for good in ["en", "fr", "pt-BR", "zh-Hans", "es-419", "ast"] {
            assert!(valid_code(good), "{good}");
        }
        for bad in ["", "e", "EN", "en_US", "en-", "english-long-name-x", "fr-$"] {
            assert!(!valid_code(bad), "{bad}");
        }
    }
}
