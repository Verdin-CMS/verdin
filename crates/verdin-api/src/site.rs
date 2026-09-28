//! The official site features: SEO settings and the sitemap (`seo`), redirects
//! (`redirects`), navigation menus (`menus`) and forms with submissions (`forms`).

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json, json};
use time::OffsetDateTime;
use verdin_content::DocumentService;
use verdin_db::value::{format_datetime, truncate_millis};
use verdin_db::{ColumnKind as K, Database, DbError, SqlValue as V};
use verdin_migrate::system::{FORM_SUBMISSIONS, FORMS, MENUS, REDIRECTS};
use verdin_query::{PageMode, Pagination, Query, Status};

use crate::error::ApiError;

pub const MAX_MENU_ITEMS: usize = 500;
pub const MAX_MENU_DEPTH: usize = 5;
pub const MAX_FORM_FIELDS: usize = 50;
/// Largest submission, in bytes of JSON.
pub const MAX_SUBMISSION: usize = 64 * 1024;
/// The sitemap protocol's limit per file.
pub const MAX_SITEMAP_URLS: usize = 50_000;

fn now() -> OffsetDateTime {
    truncate_millis(OffsetDateTime::now_utc())
}

fn at(value: &V) -> Option<String> {
    match value {
        V::DateTime(at) => Some(format_datetime(*at)),
        _ => None,
    }
}

fn db(error: DbError) -> ApiError {
    ApiError::Internal(error.to_string())
}

fn bad(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 128
        && slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

// ----------------------------------------------------------------- SEO and sitemap

/// The `seo` feature settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeoSettings {
    /// The site's origin (`https://www.example.com`).
    #[serde(default)]
    pub base_url: String,
    /// Content types in the sitemap, by uid.
    #[serde(default)]
    pub types: BTreeMap<String, SitemapType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SitemapType {
    /// The entry's path: `/blog/{slug}`, `/{locale}/about` (fields and `{locale}`).
    pub pattern: String,
    pub changefreq: Option<String>,
    pub priority: Option<f64>,
}

impl SeoSettings {
    pub fn parse(settings: &Json, service: &DocumentService) -> Result<Self, ApiError> {
        if settings.is_null() {
            return Ok(Self::default());
        }
        let parsed: Self = serde_json::from_value(settings.clone())
            .map_err(|error| bad(format!("invalid SEO settings: {error}")))?;
        if !parsed.base_url.is_empty() {
            let url =
                url::Url::parse(&parsed.base_url).map_err(|_| bad("baseUrl must be a URL"))?;
            if !matches!(url.scheme(), "http" | "https") {
                return Err(bad("baseUrl must be an http(s) URL"));
            }
        }
        for (uid, spec) in &parsed.types {
            let model = service.registry().get(uid)?;
            if !spec.pattern.starts_with('/') {
                return Err(bad(format!("the pattern of {uid} must start with /")));
            }
            for name in placeholders(&spec.pattern) {
                if name != "locale"
                    && model.fields.get(&name).is_none_or(|field| field.attribute.is_none())
                {
                    return Err(bad(format!("{uid} has no attribute `{name}`")));
                }
            }
            if let Some(freq) = &spec.changefreq
                && !["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]
                    .contains(&freq.as_str())
            {
                return Err(bad(format!("unknown changefreq `{freq}`")));
            }
            if spec.priority.is_some_and(|priority| !(0.0..=1.0).contains(&priority)) {
                return Err(bad("priority goes from 0 to 1"));
            }
        }
        Ok(parsed)
    }

    /// The path of an entry, when its type has a pattern and the entry fills it.
    pub fn path_of(&self, uid: &str, entry: &Json, locale: Option<&str>) -> Option<String> {
        fill(&self.types.get(uid)?.pattern, entry, locale)
    }
}

fn placeholders(pattern: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = pattern;
    while let Some(start) = rest.find('{') {
        let Some(end) = rest[start..].find('}') else { break };
        names.push(rest[start + 1..start + end].to_owned());
        rest = &rest[start + end + 1..];
    }
    names
}

/// `pattern` with its placeholders replaced (URL-encoded); `None` when one is empty.
fn fill(pattern: &str, entry: &Json, locale: Option<&str>) -> Option<String> {
    let mut out = pattern.to_owned();
    for name in placeholders(pattern) {
        let value = if name == "locale" {
            locale?.to_owned()
        } else {
            match entry.get(&name)? {
                Json::String(text) if !text.is_empty() => text.clone(),
                Json::Number(number) => number.to_string(),
                _ => return None,
            }
        };
        let encoded: String = url::form_urlencoded::byte_serialize(value.as_bytes()).collect();
        out = out.replace(&format!("{{{name}}}"), &encoded.replace('+', "%20"));
    }
    Some(out)
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// An entry's versions in the sitemap: locale, URL and last change.
type SitemapVersions = Vec<(Option<String>, String, Option<String>)>;

/// `sitemap.xml` of the published entries of the configured types.
pub async fn sitemap(
    service: &DocumentService,
    settings: &SeoSettings,
) -> Result<String, ApiError> {
    let base = settings.base_url.trim_end_matches('/');
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\" xmlns:xhtml=\"http://www.w3.org/1999/xhtml\">\n",
    );
    let mut count = 0;
    for (uid, spec) in &settings.types {
        let Ok(model) = service.registry().get(uid) else { continue };
        let locales: Vec<Option<String>> = if model.content_type.localized {
            service.locales().get().locales.into_iter().map(|locale| Some(locale.code)).collect()
        } else {
            vec![None]
        };
        let mut fields: Vec<String> =
            placeholders(&spec.pattern).into_iter().filter(|name| name != "locale").collect();
        fields.extend(["documentId".to_owned(), "updatedAt".to_owned()]);
        // documentId → (locale, url, lastmod).
        let mut entries: BTreeMap<String, SitemapVersions> = BTreeMap::new();
        for locale in &locales {
            let scoped = service.in_locale(locale.clone());
            let mut page = 1;
            loop {
                let query = Query {
                    filters: None,
                    sort: Vec::new(),
                    fields: Some(fields.clone()),
                    populate: Vec::new(),
                    pagination: Pagination {
                        mode: PageMode::Page { page, page_size: 100 },
                        with_count: false,
                    },
                    status: Status::Published,
                    search: None,
                };
                let found = scoped.find_many(uid, &query).await?;
                let size = found.documents.len();
                for document in found.documents {
                    let Some(path) = fill(&spec.pattern, &document, locale.as_deref()) else {
                        continue;
                    };
                    let id = document["documentId"].as_str().unwrap_or_default().to_owned();
                    let lastmod = document["updatedAt"].as_str().map(str::to_owned);
                    entries.entry(id).or_default().push((
                        locale.clone(),
                        format!("{base}{path}"),
                        lastmod,
                    ));
                }
                if size < 100 || page * 100 >= MAX_SITEMAP_URLS as u64 {
                    break;
                }
                page += 1;
            }
        }
        for versions in entries.values() {
            for (_, url, lastmod) in versions {
                if count >= MAX_SITEMAP_URLS {
                    break;
                }
                count += 1;
                out.push_str("  <url>\n");
                out.push_str(&format!("    <loc>{}</loc>\n", xml_escape(url)));
                if let Some(lastmod) = lastmod {
                    out.push_str(&format!("    <lastmod>{}</lastmod>\n", xml_escape(lastmod)));
                }
                if let Some(freq) = &spec.changefreq {
                    out.push_str(&format!("    <changefreq>{freq}</changefreq>\n"));
                }
                if let Some(priority) = spec.priority {
                    out.push_str(&format!("    <priority>{priority:.1}</priority>\n"));
                }
                if versions.len() > 1 {
                    for (locale, other, _) in versions {
                        if let Some(locale) = locale {
                            out.push_str(&format!(
                                "    <xhtml:link rel=\"alternate\" hreflang=\"{}\" href=\"{}\"/>\n",
                                xml_escape(locale),
                                xml_escape(other)
                            ));
                        }
                    }
                }
                out.push_str("  </url>\n");
            }
        }
    }
    out.push_str("</urlset>\n");
    Ok(out)
}

/// The `shared.seo` component Verdin suggests (Strapi's SEO plugin fields).
pub fn seo_component() -> Json {
    json!({
        "displayName": "SEO",
        "icon": "search",
        "attributes": {
            "metaTitle": { "type": "string", "required": true, "maxLength": 60 },
            "metaDescription": { "type": "text", "required": true, "maxLength": 160 },
            "metaImage": { "type": "media", "allowedTypes": ["images"] },
            "keywords": { "type": "text" },
            "metaRobots": { "type": "string" },
            "canonicalURL": { "type": "string" },
            "structuredData": { "type": "json" }
        }
    })
}

// ------------------------------------------------------------------ redirects

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Redirect {
    pub id: i64,
    pub source: String,
    pub destination: String,
    pub status: i64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

// ---------------------------------------------------------------------- menus

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Menu {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub items: Json,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Checks a menu tree: labels, links (`url` or `entry: { uid, documentId }`), depth and size.
pub fn check_items(items: &Json, service: &DocumentService) -> Result<(), ApiError> {
    fn walk(
        items: &Json,
        depth: usize,
        count: &mut usize,
        service: &DocumentService,
    ) -> Result<(), ApiError> {
        let Json::Array(items) = items else { return Err(bad("items must be a list")) };
        if depth > MAX_MENU_DEPTH {
            return Err(bad(format!("menus nest at most {MAX_MENU_DEPTH} levels")));
        }
        for item in items {
            *count += 1;
            if *count > MAX_MENU_ITEMS {
                return Err(bad(format!("a menu has at most {MAX_MENU_ITEMS} items")));
            }
            let Json::Object(item) = item else { return Err(bad("menu items are objects")) };
            for key in item.keys() {
                if !["id", "label", "url", "entry", "target", "children"].contains(&key.as_str()) {
                    return Err(bad(format!("unknown menu item key `{key}`")));
                }
            }
            let label = item.get("label").and_then(Json::as_str).unwrap_or_default();
            if label.trim().is_empty() || label.chars().count() > 255 {
                return Err(bad("menu labels need 1 to 255 characters"));
            }
            match (item.get("url"), item.get("entry")) {
                (Some(Json::String(url)), None) => {
                    let relative = url.starts_with('/') || url.starts_with('#');
                    let absolute = url::Url::parse(url).is_ok_and(|url| {
                        matches!(url.scheme(), "http" | "https" | "mailto" | "tel")
                    });
                    if !relative && !absolute {
                        return Err(bad(format!("`{url}` is not a link")));
                    }
                }
                (None, Some(entry)) => {
                    let uid = entry.get("uid").and_then(Json::as_str).unwrap_or_default();
                    service.registry().get(uid)?;
                    if entry.get("documentId").and_then(Json::as_str).is_none_or(str::is_empty) {
                        return Err(bad("entry links need a documentId"));
                    }
                }
                (None, None) => {}
                _ => return Err(bad("a menu item links to a `url` or an `entry`, not both")),
            }
            if let Some(target) = item.get("target")
                && !matches!(target.as_str(), Some("_self" | "_blank"))
            {
                return Err(bad("target is _self or _blank"));
            }
            if let Some(children) = item.get("children") {
                walk(children, depth + 1, count, service)?;
            }
        }
        Ok(())
    }
    walk(items, 1, &mut 0, service)
}

// ---------------------------------------------------------------------- forms

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormField {
    pub name: String,
    pub label: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormSettings {
    /// Emailed on every submission.
    #[serde(default)]
    pub notify_emails: Vec<String>,
    #[serde(default)]
    pub success_message: Option<String>,
    /// Refuse submissions that fill the hidden `_gotcha` field (bots).
    #[serde(default = "yes")]
    pub honeypot: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Form {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub fields: Vec<FormField>,
    pub settings: FormSettings,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submission {
    pub id: i64,
    pub form_id: i64,
    pub data: Json,
    pub created_at: Option<String>,
}

const FIELD_TYPES: &[&str] =
    &["text", "email", "textarea", "number", "select", "checkbox", "date", "url", "tel"];

pub fn check_form(fields: &[FormField], settings: &FormSettings) -> Result<(), ApiError> {
    if fields.is_empty() || fields.len() > MAX_FORM_FIELDS {
        return Err(bad(format!("a form has 1 to {MAX_FORM_FIELDS} fields")));
    }
    let mut names = HashSet::new();
    for field in fields {
        let valid_name = !field.name.is_empty()
            && field.name.len() <= 64
            && field.name.starts_with(|c: char| c.is_ascii_alphabetic())
            && field.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !valid_name || field.name == "_gotcha" {
            return Err(bad(format!("`{}` is not a valid field name", field.name)));
        }
        if !names.insert(field.name.as_str()) {
            return Err(bad(format!("`{}` is used twice", field.name)));
        }
        if !FIELD_TYPES.contains(&field.kind.as_str()) {
            return Err(bad(format!("unknown field type `{}`", field.kind)));
        }
        if field.kind == "select" && field.options.is_empty() {
            return Err(bad(format!("`{}` needs options", field.name)));
        }
        if field.label.trim().is_empty() {
            return Err(bad(format!("`{}` needs a label", field.name)));
        }
    }
    for email in &settings.notify_emails {
        if !email.contains('@') {
            return Err(bad(format!("`{email}` is not an email address")));
        }
    }
    Ok(())
}

/// A submission checked against the form: the values kept, or the problems by field.
pub fn check_submission(
    form: &Form,
    input: &Map<String, Json>,
) -> Result<Map<String, Json>, Vec<Json>> {
    let mut errors = Vec::new();
    let mut data = Map::new();
    for field in &form.fields {
        let raw = input.get(&field.name).cloned().unwrap_or(Json::Null);
        let text = match &raw {
            Json::String(text) => Some(text.trim().to_owned()),
            Json::Number(number) => Some(number.to_string()),
            Json::Bool(flag) => Some(flag.to_string()),
            _ => None,
        }
        .filter(|text| !text.is_empty());
        let mut error =
            |message: &str| errors.push(json!({ "path": [field.name], "message": message }));
        let Some(text) = text else {
            if field.required && !(field.kind == "checkbox" && raw == Json::Bool(false)) {
                error("is required");
            }
            continue;
        };
        if text.chars().count() > field.max_length.unwrap_or(5000).min(20_000) {
            error("is too long");
            continue;
        }
        let value = match field.kind.as_str() {
            "email" if !(text.contains('@') && text.contains('.') && !text.contains(' ')) => {
                error("must be an email address");
                continue;
            }
            "number" => match text.parse::<f64>().ok().and_then(serde_json::Number::from_f64) {
                Some(number) => Json::Number(number),
                None => {
                    error("must be a number");
                    continue;
                }
            },
            "checkbox" => Json::Bool(matches!(text.as_str(), "true" | "on" | "1" | "yes")),
            "select" if !field.options.contains(&text) => {
                error("is not one of the options");
                continue;
            }
            "url" if url::Url::parse(&text).is_err() => {
                error("must be a URL");
                continue;
            }
            _ => Json::String(text),
        };
        if field.required && value == Json::Bool(false) {
            error("is required");
            continue;
        }
        data.insert(field.name.clone(), value);
    }
    if errors.is_empty() { Ok(data) } else { Err(errors) }
}

// -------------------------------------------------------------------- storage

#[derive(Clone)]
pub struct Site {
    db: Database,
}

const MENU_KINDS: [K; 6] = [K::BigInt, K::Text, K::Text, K::Json, K::DateTime, K::DateTime];
const FORM_KINDS: [K; 7] =
    [K::BigInt, K::Text, K::Text, K::Json, K::Json, K::DateTime, K::DateTime];

impl Site {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    // Redirects.

    pub async fn redirects(&self) -> Result<Vec<Redirect>, ApiError> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id, source, destination, status, created_at, updated_at FROM {REDIRECTS} ORDER BY source, id"),
                &[],
                &[K::BigInt, K::Text, K::Text, K::Int, K::DateTime, K::DateTime],
            )
            .await
            .map_err(db)?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let mut row = row.into_iter();
                let mut next = || row.next().unwrap_or(V::Null(K::Text));
                Redirect {
                    id: next().as_i64().unwrap_or_default(),
                    source: next().into_text().unwrap_or_default(),
                    destination: next().into_text().unwrap_or_default(),
                    status: next().as_i64().unwrap_or(301),
                    created_at: at(&next()),
                    updated_at: at(&next()),
                }
            })
            .collect())
    }

    async fn check_redirect(
        &self,
        id: Option<i64>,
        source: &str,
        destination: &str,
        status: i64,
    ) -> Result<(), ApiError> {
        if !source.starts_with('/') || source.len() > 2048 {
            return Err(bad("the source is a path that starts with /"));
        }
        let absolute =
            url::Url::parse(destination).is_ok_and(|url| matches!(url.scheme(), "http" | "https"));
        if !(destination.starts_with('/') || absolute) || destination.len() > 4096 {
            return Err(bad("the destination is a path or an http(s) URL"));
        }
        if ![301, 302, 307, 308].contains(&status) {
            return Err(bad("status is 301, 302, 307 or 308"));
        }
        let existing = self.redirects().await?;
        if existing.iter().any(|other| other.source == source && Some(other.id) != id) {
            return Err(ApiError::Conflict(format!("`{source}` already redirects")));
        }
        // No loops: follow the chain from the destination.
        let mut map: HashMap<&str, &str> = existing
            .iter()
            .filter(|other| Some(other.id) != id)
            .map(|other| (other.source.as_str(), other.destination.as_str()))
            .collect();
        map.insert(source, destination);
        let mut current = destination;
        for _ in 0..=map.len() {
            if current == source {
                return Err(bad("this redirect would loop"));
            }
            match map.get(current) {
                Some(next) => current = next,
                None => return Ok(()),
            }
        }
        Err(bad("this redirect would loop"))
    }

    pub async fn create_redirect(
        &self,
        source: &str,
        destination: &str,
        status: i64,
    ) -> Result<Redirect, ApiError> {
        self.check_redirect(None, source, destination, status).await?;
        let now = now();
        let id = self
            .db
            .queries()
            .insert_returning_id(
                &format!("INSERT INTO {REDIRECTS} (source, destination, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"),
                &[V::Text(source.into()), V::Text(destination.into()), V::Int(status as i32), V::DateTime(now), V::DateTime(now)],
            )
            .await
            .map_err(db)?;
        self.redirects()
            .await?
            .into_iter()
            .find(|redirect| redirect.id == id)
            .ok_or(ApiError::NotFound)
    }

    pub async fn update_redirect(
        &self,
        id: i64,
        source: &str,
        destination: &str,
        status: i64,
    ) -> Result<Redirect, ApiError> {
        self.check_redirect(Some(id), source, destination, status).await?;
        let updated = self
            .db
            .queries()
            .execute(
                &format!("UPDATE {REDIRECTS} SET source = ?, destination = ?, status = ?, updated_at = ? WHERE id = ?"),
                &[V::Text(source.into()), V::Text(destination.into()), V::Int(status as i32), V::DateTime(now()), V::BigInt(id)],
            )
            .await
            .map_err(db)?;
        if updated == 0 {
            return Err(ApiError::NotFound);
        }
        self.redirects()
            .await?
            .into_iter()
            .find(|redirect| redirect.id == id)
            .ok_or(ApiError::NotFound)
    }

    pub async fn delete_redirect(&self, id: i64) -> Result<(), ApiError> {
        let deleted = self
            .db
            .queries()
            .execute(&format!("DELETE FROM {REDIRECTS} WHERE id = ?"), &[V::BigInt(id)])
            .await
            .map_err(db)?;
        if deleted == 0 { Err(ApiError::NotFound) } else { Ok(()) }
    }

    // Menus.

    fn menu(row: Vec<V>) -> Menu {
        let mut row = row.into_iter();
        let mut next = || row.next().unwrap_or(V::Null(K::Text));
        Menu {
            id: next().as_i64().unwrap_or_default(),
            slug: next().into_text().unwrap_or_default(),
            name: next().into_text().unwrap_or_default(),
            items: match next() {
                V::Json(items) => items,
                _ => Json::Array(Vec::new()),
            },
            created_at: at(&next()),
            updated_at: at(&next()),
        }
    }

    pub async fn menus(&self) -> Result<Vec<Menu>, ApiError> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id, slug, name, items, created_at, updated_at FROM {MENUS} ORDER BY name, id"),
                &[],
                &MENU_KINDS,
            )
            .await
            .map_err(db)?;
        Ok(rows.into_iter().map(Self::menu).collect())
    }

    pub async fn menu_by_slug(&self, slug: &str) -> Result<Option<Menu>, ApiError> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id, slug, name, items, created_at, updated_at FROM {MENUS} WHERE slug = ?"),
                &[V::Text(slug.into())],
                &MENU_KINDS,
            )
            .await
            .map_err(db)?;
        Ok(rows.into_iter().next().map(Self::menu))
    }

    pub async fn menu_by_id(&self, id: i64) -> Result<Option<Menu>, ApiError> {
        Ok(self.menus().await?.into_iter().find(|menu| menu.id == id))
    }

    pub async fn save_menu(
        &self,
        id: Option<i64>,
        slug: &str,
        name: &str,
        items: &Json,
        service: &DocumentService,
    ) -> Result<Menu, ApiError> {
        if !valid_slug(slug) {
            return Err(bad("the slug is kebab-case (a-z, 0-9, -)"));
        }
        if name.trim().is_empty() || name.chars().count() > 255 {
            return Err(bad("the name needs 1 to 255 characters"));
        }
        check_items(items, service)?;
        let now = now();
        let result = match id {
            None => self
                .db
                .queries()
                .insert_returning_id(
                    &format!("INSERT INTO {MENUS} (slug, name, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"),
                    &[V::Text(slug.into()), V::Text(name.trim().into()), V::Json(items.clone()), V::DateTime(now), V::DateTime(now)],
                )
                .await,
            Some(id) => self
                .db
                .queries()
                .execute(
                    &format!("UPDATE {MENUS} SET slug = ?, name = ?, items = ?, updated_at = ? WHERE id = ?"),
                    &[V::Text(slug.into()), V::Text(name.trim().into()), V::Json(items.clone()), V::DateTime(now), V::BigInt(id)],
                )
                .await
                .map(|updated| if updated == 0 { -1 } else { id }),
        };
        let id = result.map_err(|error| {
            if error.unique_violation().is_some() {
                ApiError::Conflict(format!("the slug `{slug}` is used"))
            } else {
                db(error)
            }
        })?;
        self.menu_by_id(id).await?.ok_or(ApiError::NotFound)
    }

    pub async fn delete_menu(&self, id: i64) -> Result<(), ApiError> {
        let deleted = self
            .db
            .queries()
            .execute(&format!("DELETE FROM {MENUS} WHERE id = ?"), &[V::BigInt(id)])
            .await
            .map_err(db)?;
        if deleted == 0 { Err(ApiError::NotFound) } else { Ok(()) }
    }

    /// A menu for sites: entry links resolved to published entries (with their `path`
    /// from the sitemap patterns); links to missing or unpublished entries are left out.
    pub async fn resolved_menu(
        &self,
        menu: &Menu,
        service: &DocumentService,
        seo: &SeoSettings,
        locale: Option<&str>,
    ) -> Result<Json, ApiError> {
        // Gather every entry, then read each type once.
        fn entries(items: &Json, out: &mut Vec<(String, String)>) {
            for item in items.as_array().into_iter().flatten() {
                if let Some(entry) = item.get("entry") {
                    let uid = entry["uid"].as_str().unwrap_or_default().to_owned();
                    let id = entry["documentId"].as_str().unwrap_or_default().to_owned();
                    out.push((uid, id));
                }
                if let Some(children) = item.get("children") {
                    entries(children, out);
                }
            }
        }
        let mut wanted = Vec::new();
        entries(&menu.items, &mut wanted);
        let scoped = service.in_locale(locale.map(str::to_owned));
        let mut found: HashMap<(String, String), Json> = HashMap::new();
        let mut by_type: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (uid, id) in wanted {
            by_type.entry(uid).or_default().push(id);
        }
        for (uid, ids) in by_type {
            let Ok(model) = service.registry().get(&uid) else { continue };
            let filter = verdin_query::Filter::Condition(verdin_query::Condition {
                column: "document_id".into(),
                path: Vec::new(),
                kind: K::Text,
                op: verdin_query::Op::In,
                operand: verdin_query::Operand::List(ids.iter().cloned().map(V::Text).collect()),
            });
            let query = Query {
                filters: Some(filter),
                sort: Vec::new(),
                fields: None,
                populate: Vec::new(),
                pagination: Pagination {
                    mode: PageMode::Offset { start: 0, limit: MAX_MENU_ITEMS as u64 },
                    with_count: false,
                },
                status: Status::Published,
                search: None,
            };
            let _ = model;
            for document in scoped.find_many(&uid, &query).await?.documents {
                let id = document["documentId"].as_str().unwrap_or_default().to_owned();
                found.insert((uid.clone(), id), document);
            }
        }
        let locale_code =
            locale.map(str::to_owned).unwrap_or_else(|| service.locales().default_code());
        fn resolve(
            items: &Json,
            found: &HashMap<(String, String), Json>,
            seo: &SeoSettings,
            locale: &str,
        ) -> Json {
            let mut out = Vec::new();
            for item in items.as_array().into_iter().flatten() {
                let mut item = item.clone();
                if let Some(entry) = item.get("entry").cloned() {
                    let key = (
                        entry["uid"].as_str().unwrap_or_default().to_owned(),
                        entry["documentId"].as_str().unwrap_or_default().to_owned(),
                    );
                    let Some(document) = found.get(&key) else { continue };
                    let path = seo.path_of(&key.0, document, Some(locale));
                    item["entry"] = json!({ "uid": key.0, "documentId": key.1, "path": path });
                    if item.get("url").is_none()
                        && let Some(path) = path
                    {
                        item["url"] = Json::String(path);
                    }
                }
                if let Some(children) = item.get("children").cloned() {
                    item["children"] = resolve(&children, found, seo, locale);
                }
                out.push(item);
            }
            Json::Array(out)
        }
        Ok(json!({
            "slug": menu.slug,
            "name": menu.name,
            "items": resolve(&menu.items, &found, seo, &locale_code),
        }))
    }

    // Forms.

    fn form(row: Vec<V>) -> Form {
        let mut row = row.into_iter();
        let mut next = || row.next().unwrap_or(V::Null(K::Text));
        Form {
            id: next().as_i64().unwrap_or_default(),
            slug: next().into_text().unwrap_or_default(),
            name: next().into_text().unwrap_or_default(),
            fields: match next() {
                V::Json(fields) => serde_json::from_value(fields).unwrap_or_default(),
                _ => Vec::new(),
            },
            settings: match next() {
                V::Json(settings) => serde_json::from_value(settings).unwrap_or_default(),
                _ => FormSettings::default(),
            },
            created_at: at(&next()),
            updated_at: at(&next()),
        }
    }

    pub async fn forms(&self) -> Result<Vec<Form>, ApiError> {
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id, slug, name, fields, settings, created_at, updated_at FROM {FORMS} ORDER BY name, id"),
                &[],
                &FORM_KINDS,
            )
            .await
            .map_err(db)?;
        Ok(rows.into_iter().map(Self::form).collect())
    }

    pub async fn form_by_slug(&self, slug: &str) -> Result<Option<Form>, ApiError> {
        Ok(self.forms().await?.into_iter().find(|form| form.slug == slug))
    }

    pub async fn form_by_id(&self, id: i64) -> Result<Option<Form>, ApiError> {
        Ok(self.forms().await?.into_iter().find(|form| form.id == id))
    }

    pub async fn save_form(
        &self,
        id: Option<i64>,
        slug: &str,
        name: &str,
        fields: &[FormField],
        settings: &FormSettings,
    ) -> Result<Form, ApiError> {
        if !valid_slug(slug) {
            return Err(bad("the slug is kebab-case (a-z, 0-9, -)"));
        }
        if name.trim().is_empty() || name.chars().count() > 255 {
            return Err(bad("the name needs 1 to 255 characters"));
        }
        check_form(fields, settings)?;
        let fields_json = serde_json::to_value(fields).expect("fields serialize");
        let settings_json = serde_json::to_value(settings).expect("settings serialize");
        let now = now();
        let result = match id {
            None => self
                .db
                .queries()
                .insert_returning_id(
                    &format!("INSERT INTO {FORMS} (slug, name, fields, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"),
                    &[V::Text(slug.into()), V::Text(name.trim().into()), V::Json(fields_json), V::Json(settings_json), V::DateTime(now), V::DateTime(now)],
                )
                .await,
            Some(id) => self
                .db
                .queries()
                .execute(
                    &format!("UPDATE {FORMS} SET slug = ?, name = ?, fields = ?, settings = ?, updated_at = ? WHERE id = ?"),
                    &[V::Text(slug.into()), V::Text(name.trim().into()), V::Json(fields_json), V::Json(settings_json), V::DateTime(now), V::BigInt(id)],
                )
                .await
                .map(|updated| if updated == 0 { -1 } else { id }),
        };
        let id = result.map_err(|error| {
            if error.unique_violation().is_some() {
                ApiError::Conflict(format!("the slug `{slug}` is used"))
            } else {
                db(error)
            }
        })?;
        self.form_by_id(id).await?.ok_or(ApiError::NotFound)
    }

    pub async fn delete_form(&self, id: i64) -> Result<(), ApiError> {
        let mut tx = self.db.begin().await.map_err(db)?;
        tx.execute(&format!("DELETE FROM {FORM_SUBMISSIONS} WHERE form_id = ?"), &[V::BigInt(id)])
            .await
            .map_err(db)?;
        let deleted = tx
            .execute(&format!("DELETE FROM {FORMS} WHERE id = ?"), &[V::BigInt(id)])
            .await
            .map_err(db)?;
        tx.commit().await.map_err(db)?;
        if deleted == 0 { Err(ApiError::NotFound) } else { Ok(()) }
    }

    pub async fn add_submission(
        &self,
        form_id: i64,
        data: Json,
        meta: Json,
    ) -> Result<i64, ApiError> {
        self.db
            .queries()
            .insert_returning_id(
                &format!("INSERT INTO {FORM_SUBMISSIONS} (form_id, data, meta, created_at) VALUES (?, ?, ?, ?)"),
                &[V::BigInt(form_id), V::Json(data), V::Json(meta), V::DateTime(now())],
            )
            .await
            .map_err(db)
    }

    /// Newest first, `page` from 1; with the total.
    pub async fn submissions(
        &self,
        form_id: i64,
        page: u64,
        page_size: u64,
    ) -> Result<(Vec<Submission>, u64), ApiError> {
        let size = page_size.clamp(1, 1000);
        let offset = page.max(1).saturating_sub(1) * size;
        let rows = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT id, form_id, data, created_at FROM {FORM_SUBMISSIONS} WHERE form_id = ? ORDER BY id DESC LIMIT {size} OFFSET {offset}"),
                &[V::BigInt(form_id)],
                &[K::BigInt, K::BigInt, K::Json, K::DateTime],
            )
            .await
            .map_err(db)?;
        let total = self
            .db
            .queries()
            .fetch_all(
                &format!("SELECT COUNT(*) FROM {FORM_SUBMISSIONS} WHERE form_id = ?"),
                &[V::BigInt(form_id)],
                &[K::BigInt],
            )
            .await
            .map_err(db)?
            .first()
            .and_then(|row| row[0].as_i64())
            .unwrap_or_default() as u64;
        let submissions = rows
            .into_iter()
            .map(|row| {
                let mut row = row.into_iter();
                let mut next = || row.next().unwrap_or(V::Null(K::Text));
                Submission {
                    id: next().as_i64().unwrap_or_default(),
                    form_id: next().as_i64().unwrap_or_default(),
                    data: match next() {
                        V::Json(data) => data,
                        _ => Json::Null,
                    },
                    created_at: at(&next()),
                }
            })
            .collect();
        Ok((submissions, total))
    }

    pub async fn delete_submission(&self, form_id: i64, id: i64) -> Result<(), ApiError> {
        let deleted = self
            .db
            .queries()
            .execute(
                &format!("DELETE FROM {FORM_SUBMISSIONS} WHERE id = ? AND form_id = ?"),
                &[V::BigInt(id), V::BigInt(form_id)],
            )
            .await
            .map_err(db)?;
        if deleted == 0 { Err(ApiError::NotFound) } else { Ok(()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_patterns() {
        let entry = json!({ "slug": "hola mundo", "id": 4 });
        assert_eq!(
            fill("/{locale}/blog/{slug}", &entry, Some("es")).as_deref(),
            Some("/es/blog/hola%20mundo")
        );
        assert_eq!(fill("/n/{id}", &entry, None).as_deref(), Some("/n/4"));
        assert_eq!(fill("/{missing}", &entry, None), None);
        assert_eq!(placeholders("/{a}/x/{b}"), ["a", "b"]);
    }

    #[test]
    fn checks_submissions() {
        let form = Form {
            id: 1,
            slug: "contact".into(),
            name: "Contact".into(),
            fields: serde_json::from_value(json!([
                { "name": "email", "label": "Email", "type": "email", "required": true },
                { "name": "topic", "label": "Topic", "type": "select", "options": ["sales", "help"] },
                { "name": "age", "label": "Age", "type": "number" },
                { "name": "terms", "label": "Terms", "type": "checkbox", "required": true }
            ]))
            .unwrap(),
            settings: FormSettings::default(),
            created_at: None,
            updated_at: None,
        };
        let ok = json!({ "email": "a@b.co", "topic": "help", "age": "31", "terms": "on", "extra": "dropped" });
        let data = check_submission(&form, ok.as_object().unwrap()).unwrap();
        assert_eq!(
            Json::Object(data),
            json!({ "email": "a@b.co", "topic": "help", "age": 31.0, "terms": true })
        );
        let bad = json!({ "email": "nope", "topic": "other", "age": "x", "terms": false });
        let errors = check_submission(&form, bad.as_object().unwrap()).unwrap_err();
        let paths: Vec<&str> = errors.iter().map(|e| e["path"][0].as_str().unwrap()).collect();
        assert_eq!(paths, ["email", "topic", "age", "terms"]);
    }
}
