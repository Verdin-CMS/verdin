//! Full-text search (`_q`). A [`SearchIndex`] (the `search` feature) ranks documents;
//! without one, `_q` matches the text fields with `$containsi`, as Strapi does.

use std::collections::HashSet;
use std::sync::Arc;

use serde_json::Value as Json;
use verdin_db::{ColumnKind, SqlValue};
use verdin_query::sql::{FilterContext, SqlBuilder};
use verdin_query::{Condition, Filter, Op, Operand, PageMode, Query};
use verdin_schema::{Attribute, AttributeKind};

use super::{
    BASE, DRAFT, DocumentService, PUBLISHED, Scope, public_fields, state_for, write_scope,
};
use crate::{Page, PageMeta, Result, TypeModel};

/// Most ranked matches considered per search.
pub const MAX_HITS: usize = 1000;

/// A ranked full-text index of document versions.
pub trait SearchIndex: Send + Sync {
    /// The `documentId`s of `uid` matching `text` in one version (`published`, `locale`;
    /// empty for types that are not localized), best first. `None` when the index cannot
    /// answer (still building): `_q` then falls back to `$containsi`.
    fn search(
        &self,
        uid: &str,
        published: bool,
        locale: &str,
        text: &str,
        limit: usize,
    ) -> Option<Vec<String>>;
}

/// The searchable text of one version.
#[derive(Debug, Clone, PartialEq)]
pub struct SearchText {
    pub uid: String,
    pub document_id: String,
    /// Empty for types that are not localized.
    pub locale: String,
    pub published: bool,
    /// The first text attribute (boosted).
    pub title: String,
    /// Every other text: attributes, blocks, components.
    pub body: String,
}

impl DocumentService {
    /// Ranks `_q` with `index`.
    pub fn with_search(mut self, index: Arc<dyn SearchIndex>) -> Self {
        self.search = Some(index);
        self
    }

    /// `_q` resolved: with a ranked index and no `sort`, the page in rank order;
    /// otherwise the query with the search as a filter.
    pub(super) async fn search_many(&self, uid: &str, query: &Query, text: &str) -> Result<Page> {
        let model = self.registry.get(uid)?;
        let state = state_for(model, query.status);
        let locale = self.locale_of(model)?;
        let ranked = self.search.as_ref().and_then(|index| {
            let published = !model.draft_and_publish() || state == PUBLISHED;
            index.search(uid, published, &locale, text, MAX_HITS)
        });
        let Some(ranked) = ranked else {
            // No index: Strapi's `$containsi` on the text fields.
            let filter =
                verdin_query::search_filter(&model.fields, text).unwrap_or(Filter::Or(Vec::new()));
            let query = Query {
                filters: Some(and(query.filters.clone(), filter)),
                search: None,
                ..query.clone()
            };
            return Box::pin(self.find_many(uid, &query)).await;
        };
        let within = Filter::Condition(Condition {
            column: "document_id".into(),
            path: Vec::new(),
            kind: ColumnKind::Text,
            op: Op::In,
            operand: Operand::List(ranked.iter().cloned().map(SqlValue::Text).collect()),
        });
        let filters = and(query.filters.clone(), within);
        if !query.sort.is_empty() || ranked.is_empty() {
            let query = Query { filters: Some(filters), search: None, ..query.clone() };
            return Box::pin(self.find_many(uid, &query)).await;
        }

        // Rank order: the other filters narrow the ranked ids, then the page is sliced.
        let mut select = SqlBuilder::new(self.db.flavor());
        select.push("SELECT ").column(Some(BASE), "document_id").push(" FROM ");
        select.ident(model.table()).push(" AS ").ident(BASE);
        let context = self.context_locale();
        let filter_context = FilterContext::with_locale(query.status, &context);
        write_scope(&mut select, state, &locale, &Scope::All, Some(&filters), filter_context);
        let rows =
            self.db.queries().fetch_all(&select.sql, &select.params, &[ColumnKind::Text]).await?;
        let matching: HashSet<String> =
            rows.into_iter().filter_map(|row| row.into_iter().next()?.into_text()).collect();
        let hits: Vec<String> = ranked.into_iter().filter(|id| matching.contains(id)).collect();
        let total = hits.len() as u64;
        let (limit, offset) = (query.pagination.limit(), query.pagination.offset());
        let page_ids: Vec<String> =
            hits.into_iter().skip(offset as usize).take(limit as usize).collect();

        let fields = public_fields(model, query.fields.as_deref(), &query.populate);
        let mut docs = if page_ids.is_empty() {
            Vec::new()
        } else {
            self.fetch_docs(
                model,
                &fields,
                state,
                Scope::Documents(&page_ids),
                None,
                query.status,
                &[],
                None,
            )
            .await?
        };
        docs.sort_by_key(|doc| page_ids.iter().position(|id| *id == doc.document_id));
        self.populate_relations(model, &mut docs, &query.populate, query.status).await?;
        let total = query.pagination.with_count.then_some(total);
        let meta = match query.pagination.mode {
            PageMode::Page { page, page_size } => PageMeta::Page {
                page,
                page_size,
                page_count: total.map(|total| total.div_ceil(page_size)),
                total,
            },
            PageMode::Offset { start, limit } => PageMeta::Offset { start, limit, total },
        };
        Ok(Page { documents: docs.into_iter().map(|doc| Json::Object(doc.json)).collect(), meta })
    }

    /// The searchable text of every version of a document.
    pub async fn search_texts(&self, uid: &str, document_id: &str) -> Result<Vec<SearchText>> {
        let model = self.registry.get(uid)?;
        let (texts, _) = self.read_texts(model, Some(document_id), 0, i64::MAX).await?;
        Ok(texts)
    }

    /// A page of versions of `uid` (by row id, after `after`), to build an index; the
    /// last row id when more may follow.
    pub async fn search_texts_page(
        &self,
        uid: &str,
        after: i64,
        limit: i64,
    ) -> Result<(Vec<SearchText>, Option<i64>)> {
        let model = self.registry.get(uid)?;
        self.read_texts(model, None, after, limit).await
    }

    async fn read_texts(
        &self,
        model: &TypeModel,
        document_id: Option<&str>,
        after: i64,
        limit: i64,
    ) -> Result<(Vec<SearchText>, Option<i64>)> {
        let attributes: Vec<(&String, &Attribute)> = model
            .content_type
            .attributes
            .iter()
            .filter(|(_, attribute)| searchable(attribute))
            .collect();
        let mut select = SqlBuilder::new(self.db.flavor());
        select.push("SELECT ").ident("id").push(", ").ident("document_id").push(", ");
        select.ident("locale").push(", ").ident("publication_state");
        let mut kinds =
            vec![ColumnKind::BigInt, ColumnKind::Text, ColumnKind::Text, ColumnKind::SmallInt];
        for (name, attribute) in &attributes {
            select.push(", ").ident(&Attribute::column_name(name));
            kinds.push(if is_json(attribute) { ColumnKind::Json } else { ColumnKind::Text });
        }
        select.push(" FROM ").ident(model.table()).push(" WHERE ").ident("id").push(" > ");
        select.param(SqlValue::BigInt(after));
        if let Some(document_id) = document_id {
            select.push(" AND ").ident("document_id").push(" = ");
            select.param(SqlValue::Text(document_id.into()));
        }
        select.push(" ORDER BY ").ident("id");
        if limit < i64::MAX {
            select.push(" LIMIT ").push(&limit.to_string());
        }
        let rows = self.db.queries().fetch_all(&select.sql, &select.params, &kinds).await?;
        let full = limit < i64::MAX && rows.len() as i64 == limit;
        let mut last = None;
        let mut texts = Vec::with_capacity(rows.len());
        for row in rows {
            let mut values = row.into_iter();
            last = values.next().and_then(|value| value.as_i64());
            let document_id = values.next().and_then(SqlValue::into_text).unwrap_or_default();
            let locale = values.next().and_then(SqlValue::into_text).unwrap_or_default();
            let state = values.next().and_then(|value| value.as_i64()).unwrap_or(0) as i16;
            let (mut title, mut body) = (None::<String>, String::new());
            for ((_, attribute), value) in attributes.iter().zip(values) {
                let text = match value {
                    SqlValue::Json(json) => {
                        let mut out = String::new();
                        json_text(&json, &mut out);
                        out
                    }
                    other => other.into_text().unwrap_or_default(),
                };
                if title.is_none() && !is_json(attribute) {
                    title = Some(text);
                } else if !text.is_empty() {
                    body.push_str(&text);
                    body.push('\n');
                }
            }
            texts.push(SearchText {
                uid: model.uid().to_owned(),
                document_id,
                locale: if model.content_type.localized { locale } else { String::new() },
                published: !model.draft_and_publish() || state != DRAFT,
                title: title.unwrap_or_default(),
                body,
            });
        }
        Ok((texts, if full { last } else { None }))
    }
}

fn and(existing: Option<Filter>, extra: Filter) -> Filter {
    match existing {
        Some(existing) => Filter::And(vec![existing, extra]),
        None => extra,
    }
}

fn searchable(attribute: &Attribute) -> bool {
    !attribute.private
        && matches!(
            attribute.kind,
            AttributeKind::String { .. }
                | AttributeKind::Text { .. }
                | AttributeKind::RichText { .. }
                | AttributeKind::Email { .. }
                | AttributeKind::Uid { .. }
                | AttributeKind::Enumeration { .. }
                | AttributeKind::Blocks
                | AttributeKind::Component { .. }
                | AttributeKind::DynamicZone { .. }
        )
}

fn is_json(attribute: &Attribute) -> bool {
    matches!(
        attribute.kind,
        AttributeKind::Blocks | AttributeKind::Component { .. } | AttributeKind::DynamicZone { .. }
    )
}

/// Keys of blocks and component JSON that hold no words.
const SKIPPED_KEYS: &[&str] =
    &["__component", "documentId", "id", "url", "type", "format", "language", "level", "mime"];

/// The words in blocks and component JSON: string values, except identifiers and URLs.
fn json_text(value: &Json, out: &mut String) {
    match value {
        Json::String(text) => {
            if !text.is_empty() && !looks_like_id(text) {
                out.push_str(text);
                out.push(' ');
            }
        }
        Json::Array(items) => items.iter().for_each(|item| json_text(item, out)),
        Json::Object(map) => {
            for (key, value) in map {
                if !SKIPPED_KEYS.contains(&key.as_str()) {
                    json_text(value, out);
                }
            }
        }
        _ => {}
    }
}

/// ULIDs (`documentId`s of relations inside components).
fn looks_like_id(text: &str) -> bool {
    text.len() == 26 && text.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn extracts_words_from_blocks_and_components() {
        let mut out = String::new();
        json_text(
            &json!([
                { "type": "paragraph", "children": [{ "type": "text", "text": "Hello" },
                  { "type": "link", "url": "https://x.dev", "children": [{ "type": "text", "text": "world" }] }] },
                { "__component": "shared.quote", "id": 3, "author": "Ada", "related": "01J8Z3K4M5N6P7Q8R9S0T1V2W3" }
            ]),
            &mut out,
        );
        assert_eq!(out.split_whitespace().collect::<Vec<_>>(), ["Hello", "world", "Ada"]);
    }
}
