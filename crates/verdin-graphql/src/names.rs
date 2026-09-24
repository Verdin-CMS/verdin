//! GraphQL names, following Strapi v5's GraphQL plugin.

/// `blog-post` → `BlogPost`.
pub fn pascal(kebab: &str) -> String {
    kebab
        .split(['-', '_', '.'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

/// `blog-post` → `blogPost`.
pub fn camel(kebab: &str) -> String {
    let pascal = pascal(kebab);
    let mut chars = pascal.chars();
    match chars.next() {
        Some(first) => first.to_ascii_lowercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

/// `shared.seo` → `ComponentSharedSeo`.
pub fn component(uid: &str) -> String {
    format!("Component{}", pascal(uid))
}

/// A field name as a type-name part: `metaTitle` → `MetaTitle`.
pub fn field(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(pascal("blog-post"), "BlogPost");
        assert_eq!(camel("blog-posts"), "blogPosts");
        assert_eq!(component("shared.seo-meta"), "ComponentSharedSeoMeta");
        assert_eq!(field("metaTitle"), "MetaTitle");
    }
}
