//! Bracket-notation query strings (`filters[title][$eq]=x&sort[0]=title:asc`) → tree.

use indexmap::IndexMap;

use crate::QueryError;

pub const MAX_QUERY_LENGTH: usize = 16 * 1024;
pub const MAX_DEPTH: usize = 12;
pub const MAX_PAIRS: usize = 1000;

/// A parsed query-string value. Lists are maps with numeric keys (`sort[0]`, `sort[]`).
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    Leaf(String),
    Map(IndexMap<String, Node>),
}

impl Node {
    pub fn as_leaf(&self) -> Option<&str> {
        match self {
            Node::Leaf(value) => Some(value),
            Node::Map(_) => None,
        }
    }

    pub fn as_map(&self) -> Option<&IndexMap<String, Node>> {
        match self {
            Node::Map(map) => Some(map),
            Node::Leaf(_) => None,
        }
    }

    /// Items of a list-shaped map (all keys numeric), ordered by index.
    /// A leaf is a one-item list.
    pub fn as_list(&self) -> Option<Vec<&Node>> {
        match self {
            Node::Leaf(_) => Some(vec![self]),
            Node::Map(map) => {
                let mut items: Vec<(usize, &Node)> = map
                    .iter()
                    .map(|(key, node)| key.parse::<usize>().ok().map(|index| (index, node)))
                    .collect::<Option<_>>()?;
                items.sort_by_key(|(index, _)| *index);
                Some(items.into_iter().map(|(_, node)| node).collect())
            }
        }
    }
}

/// Parses a raw (still percent-encoded) query string into a root map.
pub fn parse_query_string(raw: &str) -> Result<IndexMap<String, Node>, QueryError> {
    if raw.len() > MAX_QUERY_LENGTH {
        return Err(QueryError::new(format!("query string exceeds {MAX_QUERY_LENGTH} bytes")));
    }
    let mut root: IndexMap<String, Node> = IndexMap::new();
    for (count, (key, value)) in url::form_urlencoded::parse(raw.as_bytes()).enumerate() {
        if count >= MAX_PAIRS {
            return Err(QueryError::new(format!("more than {MAX_PAIRS} query parameters")));
        }
        let path = split_key(&key)?;
        insert(&mut root, &path, value.into_owned())?;
    }
    Ok(root)
}

/// `filters[title][$eq]` → `["filters", "title", "$eq"]`; `sort[]` → `["sort", ""]`.
fn split_key(key: &str) -> Result<Vec<String>, QueryError> {
    let invalid = || QueryError::new(format!("invalid query parameter name `{key}`"));
    let (head, mut rest) = match key.find('[') {
        Some(index) => (&key[..index], &key[index..]),
        None => (key, ""),
    };
    if head.is_empty() {
        return Err(invalid());
    }
    let mut path = vec![head.to_owned()];
    while !rest.is_empty() {
        let inner = rest.strip_prefix('[').ok_or_else(invalid)?;
        let end = inner.find(']').ok_or_else(invalid)?;
        path.push(inner[..end].to_owned());
        rest = &inner[end + 1..];
    }
    if path.len() > MAX_DEPTH {
        return Err(QueryError::new(format!("query parameter `{key}` is nested too deeply")));
    }
    Ok(path)
}

fn insert(
    map: &mut IndexMap<String, Node>,
    path: &[String],
    value: String,
) -> Result<(), QueryError> {
    let conflict =
        || QueryError::new(format!("conflicting values for query parameter `{}`", path.join(".")));
    let key = if path[0].is_empty() { map.len().to_string() } else { path[0].clone() };

    if path.len() == 1 {
        match map.get_mut(&key) {
            None => {
                map.insert(key, Node::Leaf(value));
            }
            // A repeated key (`sort=a&sort=b`) becomes a list.
            Some(existing @ Node::Leaf(_)) => {
                let first = std::mem::replace(existing, Node::Map(IndexMap::new()));
                let Node::Map(list) = existing else { unreachable!() };
                list.insert("0".into(), first);
                list.insert("1".into(), Node::Leaf(value));
            }
            Some(Node::Map(list)) if list.keys().all(|key| key.parse::<usize>().is_ok()) => {
                list.insert(list.len().to_string(), Node::Leaf(value));
            }
            Some(Node::Map(_)) => return Err(conflict()),
        }
        return Ok(());
    }

    let child = map.entry(key).or_insert_with(|| Node::Map(IndexMap::new()));
    // `sort=a&sort[1]=b`: a leaf followed by list items becomes the list's first item.
    let list_item = path[1].is_empty() || path[1].parse::<usize>().is_ok();
    if list_item && let Node::Leaf(_) = child {
        let first = std::mem::replace(child, Node::Map(IndexMap::new()));
        let Node::Map(list) = child else { unreachable!() };
        list.insert("0".into(), first);
    }
    match child {
        Node::Map(child) => insert(child, &path[1..], value),
        Node::Leaf(_) => Err(conflict()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(value: &str) -> Node {
        Node::Leaf(value.into())
    }

    #[test]
    fn parses_nested_brackets() {
        let root =
            parse_query_string("filters[title][%24eq]=hello%20world&pagination[page]=2").unwrap();
        let title = &root["filters"].as_map().unwrap()["title"];
        assert_eq!(title.as_map().unwrap()["$eq"], leaf("hello world"));
        assert_eq!(root["pagination"].as_map().unwrap()["page"], leaf("2"));
    }

    #[test]
    fn builds_lists() {
        let root = parse_query_string("sort[1]=b&sort[0]=a").unwrap();
        let items: Vec<_> = root["sort"]
            .as_list()
            .unwrap()
            .into_iter()
            .map(|node| node.as_leaf().unwrap())
            .collect();
        assert_eq!(items, ["a", "b"]);

        let root = parse_query_string("fields[]=a&fields[]=b&sort=x&sort=y").unwrap();
        assert_eq!(root["fields"].as_list().unwrap().len(), 2);
        assert_eq!(root["sort"].as_list().unwrap().len(), 2);
        assert!(root["fields"].as_map().unwrap().contains_key("1"), "`[]` appends");
    }

    #[test]
    fn rejects_malformed_and_conflicting_keys() {
        assert!(parse_query_string("filters[title=1").is_err());
        assert!(parse_query_string("[x]=1").is_err());
        assert!(parse_query_string("a=1&a[b]=2").is_err());
        assert!(parse_query_string("a[b]=2&a=1").is_err());
        let deep = format!("a{}=1", "[x]".repeat(MAX_DEPTH));
        assert!(parse_query_string(&deep).is_err());
    }
}
