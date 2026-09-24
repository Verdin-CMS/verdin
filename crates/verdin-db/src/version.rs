use std::fmt;

/// Server version reduced to `major.minor`, which is all compatibility checks need.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
}

impl Version {
    pub const fn new(major: u32, minor: u32) -> Self {
        Self { major, minor }
    }

    /// Parses the leading `major.minor` of strings such as `17.2 (Debian 17.2-1)`,
    /// `8.4.3`, `11.4.4-MariaDB-ubu2404` or `5.5.5-10.11.9-MariaDB`.
    pub fn parse(raw: &str) -> Option<Self> {
        // MariaDB may report a fake `5.5.5-` prefix for old-client compatibility.
        let raw = raw.trim().strip_prefix("5.5.5-").unwrap_or(raw.trim());
        let numeric = raw.split(|c: char| !(c.is_ascii_digit() || c == '.')).next()?;
        let mut parts = numeric.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
        Some(Self { major, minor })
    }
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.major, self.minor)
    }
}

#[cfg(test)]
mod tests {
    use super::Version;

    #[test]
    fn parses_server_version_strings() {
        let cases = [
            ("17.2 (Debian 17.2-1.pgdg120+1)", Version::new(17, 2)),
            ("14.13", Version::new(14, 13)),
            ("8.4.3", Version::new(8, 4)),
            ("11.4.4-MariaDB-ubu2404", Version::new(11, 4)),
            ("5.5.5-10.11.9-MariaDB-log", Version::new(10, 11)),
            ("3.46.0", Version::new(3, 46)),
            ("16", Version::new(16, 0)),
        ];
        for (raw, expected) in cases {
            assert_eq!(Version::parse(raw), Some(expected), "{raw}");
        }
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(Version::parse("MariaDB"), None);
        assert_eq!(Version::parse(""), None);
    }

    #[test]
    fn orders_by_major_then_minor() {
        assert!(Version::new(10, 11) > Version::new(10, 6));
        assert!(Version::new(11, 0) > Version::new(10, 11));
        assert!(Version::new(8, 0) < Version::new(8, 4));
    }
}
