//! Naming rules shared by the schema and the database layer.

/// Maximum length of table names derived from the schema. Leaves room for suffixes
/// (`_lnk`, index names) under the 60-char identifier budget.
pub const MAX_TABLE_NAME: usize = 50;
/// Maximum length of attribute names (and therefore column names).
pub const MAX_ATTRIBUTE_NAME: usize = 50;

/// PostgreSQL allows 63-byte identifiers and MySQL 64; generated names stay under both.
pub const MAX_IDENTIFIER: usize = 60;

/// Truncates `name` to fit [`MAX_IDENTIFIER`], appending an 8-char hash of the full name
/// so that distinct long names stay distinct.
pub fn bounded(name: &str) -> String {
    use sha2::{Digest, Sha256};
    if name.len() <= MAX_IDENTIFIER {
        return name.to_owned();
    }
    let digest = Sha256::digest(name.as_bytes());
    let hash: String = digest.iter().take(4).map(|byte| format!("{byte:02x}")).collect();
    format!("{}_{hash}", &name[..MAX_IDENTIFIER - 9])
}

/// `{table}_{part}_{suffix}`, bounded.
pub fn index_name(table: &str, part: &str, suffix: &str) -> String {
    bounded(&format!("{table}_{part}_{suffix}"))
}

/// Link table of an owning relation attribute: `{table}_{column}_lnk`, bounded.
pub fn link_table_name(table: &str, attribute: &str) -> String {
    bounded(&format!("{table}_{}_lnk", snake_case(attribute)))
}

/// `singularName`, `pluralName`, component categories and names: `^[a-z][a-z0-9-]*$`,
/// without leading, trailing or doubled dashes.
pub fn is_kebab_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some('a'..='z'))
        && name.chars().all(|c| matches!(c, 'a'..='z' | '0'..='9' | '-'))
        && !name.ends_with('-')
        && !name.contains("--")
}

/// SQL identifiers we generate: `^[a-z][a-z0-9_]*$`.
pub fn is_snake_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some('a'..='z'))
        && name.chars().all(|c| matches!(c, 'a'..='z' | '0'..='9' | '_'))
}

/// Attribute names are camelCase: `^[a-z][a-zA-Z0-9]*$`.
pub fn is_attribute_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some('a'..='z')) && name.chars().all(|c| c.is_ascii_alphanumeric())
}

/// `metaTitle` → `meta_title`, `seo2Title` → `seo2_title`.
pub fn snake_case(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 4);
    for c in name.chars() {
        if c.is_ascii_uppercase() {
            if !out.is_empty() {
                out.push('_');
            }
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// `blog-posts` → `blog_posts`.
pub fn kebab_to_snake(name: &str) -> String {
    name.replace('-', "_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kebab_names() {
        assert!(is_kebab_name("article"));
        assert!(is_kebab_name("blog-post2"));
        assert!(!is_kebab_name("Blog"));
        assert!(!is_kebab_name("2blog"));
        assert!(!is_kebab_name("blog-"));
        assert!(!is_kebab_name("blog--post"));
        assert!(!is_kebab_name("blog_post"));
        assert!(!is_kebab_name(""));
    }

    #[test]
    fn attribute_names() {
        assert!(is_attribute_name("title"));
        assert!(is_attribute_name("metaTitle2"));
        assert!(!is_attribute_name("MetaTitle"));
        assert!(!is_attribute_name("meta_title"));
        assert!(!is_attribute_name("meta-title"));
    }

    #[test]
    fn snake_cases() {
        assert_eq!(snake_case("title"), "title");
        assert_eq!(snake_case("metaTitle"), "meta_title");
        assert_eq!(snake_case("seo2Title"), "seo2_title");
        assert_eq!(snake_case("aBC"), "a_b_c");
        assert_eq!(kebab_to_snake("blog-posts"), "blog_posts");
    }
}
