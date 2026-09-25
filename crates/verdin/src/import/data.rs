//! Rows, files and links of a Strapi export into a migrated Verdin database.
//!
//! Every Strapi row becomes a Verdin version (v4 rows become a draft, plus a published
//! version when published). Documents get new Verdin ids (Strapi's are 24 characters,
//! Verdin's 26); the mapping is returned. Relations and media, which Strapi exports as
//! links, are applied after the rows: on link tables for content types, and inside the
//! component JSON for components.

use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::Result;
use serde::Serialize;
use serde_json::{Map, Value as Json};
use verdin_content::{DocumentService, ImportedVersion};
use verdin_db::{Database, SqlValue as V};
use verdin_migrate::system::LOCALES;
use verdin_query::temporal::parse_datetime;
use verdin_schema::{AttributeKind, Schema};
use verdin_upload::{ImportedFile, ImportedObject, UploadService};

use super::export::{Export, Link};

const FILE: &str = "plugin::upload.file";
const FOLDER: &str = "plugin::upload.folder";
const LOCALE: &str = "plugin::i18n.locale";
const USER: &str = "plugin::users-permissions.user";
const ROLE: &str = "plugin::users-permissions.role";
const PERMISSION: &str = "plugin::users-permissions.permission";

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// Versions imported per Verdin content type.
    pub versions: BTreeMap<String, usize>,
    pub documents: usize,
    pub files: usize,
    pub folders: usize,
    pub locales: usize,
    pub end_users: usize,
    pub end_user_roles: usize,
    pub links: usize,
    pub media: usize,
    pub warnings: Vec<String>,
    /// Strapi document id (v5) or row id (v4) → Verdin document id, per Verdin type.
    pub documents_map: BTreeMap<String, BTreeMap<String, String>>,
    /// Strapi file id → Verdin file id.
    pub files_map: BTreeMap<i64, i64>,
}

pub struct Context<'a> {
    pub export: &'a Export,
    pub schema: &'a Schema,
    /// Strapi uid → Verdin uid of the imported content types.
    pub types: &'a HashMap<String, String>,
    pub service: &'a DocumentService,
    pub upload: &'a UploadService,
    pub db: &'a Database,
    /// End users and their roles are imported with it.
    pub auth: Option<&'a verdin_auth::AuthService>,
}

/// Where a component reference goes: row index, JSON pointer, component uid, field.
type Patch = (usize, String, String, String);

/// A row of a content type, prepared for insertion.
struct Row {
    uid: String,
    strapi_id: i64,
    document_id: String,
    locale: String,
    published: bool,
    /// v4 published rows also get a draft.
    with_draft: bool,
    created_at: Option<time::OffsetDateTime>,
    updated_at: Option<time::OffsetDateTime>,
    published_at: Option<time::OffsetDateTime>,
    data: Json,
}

pub async fn import(context: &Context<'_>) -> Result<Report> {
    let mut report = Report::default();
    let export = context.export;
    let v4 = export.major() < 5;

    import_locales(context, &mut report).await?;
    let folders = import_folders(context, &mut report).await?;
    let files = import_files(context, &folders, &mut report).await?;

    // Document ids for every content type row, before any insert (links need them).
    let groups = if v4 { localization_groups(&export.links) } else { HashMap::new() };
    let mut documents: HashMap<(String, i64), String> = HashMap::new();
    let mut by_key: HashMap<(String, String), String> = HashMap::new();
    for entity in &export.entities {
        let Some(uid) = context.types.get(&entity.uid) else { continue };
        let key = match entity.data.get("documentId").and_then(Json::as_str) {
            Some(document_id) => document_id.to_owned(),
            None => groups
                .get(&(entity.uid.clone(), entity.id))
                .copied()
                .unwrap_or(entity.id)
                .to_string(),
        };
        let document_id = by_key
            .entry((uid.clone(), key.clone()))
            .or_insert_with(|| {
                report.documents += 1;
                let id = ulid::Ulid::generate().to_string().to_lowercase();
                report.documents_map.entry(uid.clone()).or_default().insert(key, id.clone());
                id
            })
            .clone();
        documents.insert((entity.uid.clone(), entity.id), document_id);
    }

    let default_locale = context.service.locales().default_code();
    let mut rows: Vec<Row> = Vec::new();
    // (component uid, Strapi component id) → (row index, JSON pointer).
    let mut components: HashMap<(String, i64), (usize, String)> = HashMap::new();
    let schema = context.schema;
    for entity in &export.entities {
        let Some(uid) = context.types.get(&entity.uid) else { continue };
        let Some(content_type) = context.schema.content_type(uid) else { continue };
        let mut data = Map::new();
        for (name, attribute) in &content_type.attributes {
            if matches!(
                attribute.kind,
                AttributeKind::Relation { .. } | AttributeKind::Media { .. }
            ) {
                continue;
            }
            if let Some(value) = entity.data.get(name) {
                data.insert(name.clone(), value.clone());
            }
        }
        let index = rows.len();
        let data = Json::Object(data);
        for (name, attribute) in &content_type.attributes {
            if let Some(value) = data.get(name) {
                index_components(
                    context.schema,
                    &attribute.kind,
                    value,
                    &format!("/{}", escape(name)),
                    index,
                    &mut components,
                );
            }
        }
        let published_at =
            entity.data.get("publishedAt").and_then(Json::as_str).and_then(parse_datetime);
        let draft_and_publish = content_type.draft_and_publish;
        rows.push(Row {
            uid: uid.clone(),
            strapi_id: entity.id,
            document_id: documents[&(entity.uid.clone(), entity.id)].clone(),
            locale: if content_type.localized {
                entity
                    .data
                    .get("locale")
                    .and_then(Json::as_str)
                    .unwrap_or(&default_locale)
                    .to_owned()
            } else {
                String::new()
            },
            published: !draft_and_publish || published_at.is_some(),
            with_draft: v4 && draft_and_publish && published_at.is_some(),
            created_at: entity
                .data
                .get("createdAt")
                .and_then(Json::as_str)
                .and_then(parse_datetime),
            updated_at: entity
                .data
                .get("updatedAt")
                .and_then(Json::as_str)
                .and_then(parse_datetime),
            published_at,
            data,
        });
    }

    // Relations and media inside components go into the component JSON.
    // (row index, pointer, component uid, field) → values.
    let mut patches: HashMap<Patch, Vec<(f64, Json)>> = HashMap::new();
    for link in &export.links {
        if link.kind == "relation.morph" && link.left.uid == FILE {
            let (Some(file), Some(row), Some(field)) = (
                link.left.row().and_then(|id| files.get(&id)),
                link.right.row(),
                link.right.field.as_ref(),
            ) else {
                continue;
            };
            if let Some((index, pointer)) = components.get(&(link.right.uid.clone(), row)) {
                patches
                    .entry((*index, pointer.clone(), link.right.uid.clone(), field.clone()))
                    .or_default()
                    .push((link.right.pos.unwrap_or_default(), Json::from(*file)));
            }
            continue;
        }
        let (Some(row), Some(field), Some(target)) = (
            link.left.row(),
            link.left.field.as_ref(),
            link.right.row().and_then(|id| documents.get(&(link.right.uid.clone(), id))),
        ) else {
            continue;
        };
        if let Some((index, pointer)) = components.get(&(link.left.uid.clone(), row)) {
            patches
                .entry((*index, pointer.clone(), link.left.uid.clone(), field.clone()))
                .or_default()
                .push((link.left.pos.unwrap_or_default(), Json::String(target.clone())));
        }
    }
    for ((index, pointer, component, field), mut values) in patches {
        values.sort_by(|a, b| a.0.total_cmp(&b.0));
        let Some(item) = rows[index].data.pointer_mut(&pointer).and_then(Json::as_object_mut)
        else {
            continue;
        };
        let many = match schema
            .component(&component)
            .and_then(|component| component.attributes.get(&field))
            .map(|attribute| &attribute.kind)
        {
            Some(AttributeKind::Relation { relation, .. }) => relation.is_to_many(),
            Some(AttributeKind::Media { multiple, .. }) => *multiple,
            _ => continue,
        };
        let values: Vec<Json> = values.into_iter().map(|(_, value)| value).collect();
        item.insert(
            field,
            if many {
                Json::Array(values)
            } else {
                values.into_iter().next().unwrap_or(Json::Null)
            },
        );
    }
    for row in &mut rows {
        strip_component_ids(&mut row.data, true);
    }

    // The rows.
    let mut inserted: HashMap<(String, i64), Vec<i64>> = HashMap::new();
    let strapi_uids: HashMap<&String, &String> =
        context.types.iter().map(|(strapi, verdin)| (verdin, strapi)).collect();
    for row in &rows {
        let versions: Vec<bool> =
            if row.with_draft { vec![false, true] } else { vec![row.published] };
        for published in versions {
            let version = ImportedVersion {
                document_id: &row.document_id,
                locale: &row.locale,
                published,
                created_at: row.created_at,
                updated_at: row.updated_at,
                published_at: row.published_at,
                data: &row.data,
            };
            match context.service.import_version(&row.uid, &version).await {
                Ok(id) => {
                    *report.versions.entry(row.uid.clone()).or_default() += 1;
                    inserted
                        .entry(((*strapi_uids[&row.uid]).clone(), row.strapi_id))
                        .or_default()
                        .push(id);
                }
                Err(error) => report
                    .warnings
                    .push(format!("{} row {}: not imported ({error})", row.uid, row.strapi_id)),
            }
        }
    }

    // Relations of content types.
    let mut relations: HashMap<(String, i64, String), Vec<(f64, String)>> = HashMap::new();
    let mut media: HashMap<(String, i64, String), Vec<(f64, i64)>> = HashMap::new();
    for link in &export.links {
        if link.kind == "relation.morph" && link.left.uid == FILE {
            if let (Some(file), Some(row), Some(field)) = (
                link.left.row().and_then(|id| files.get(&id)),
                link.right.row(),
                link.right.field.as_ref(),
            ) && context.types.contains_key(&link.right.uid)
            {
                media
                    .entry((link.right.uid.clone(), row, field.clone()))
                    .or_default()
                    .push((link.right.pos.unwrap_or_default(), *file));
            }
            continue;
        }
        let Some(uid) = context.types.get(&link.left.uid) else { continue };
        let (Some(row), Some(field)) = (link.left.row(), link.left.field.as_ref()) else {
            continue;
        };
        let Some(target) =
            link.right.row().and_then(|id| documents.get(&(link.right.uid.clone(), id)))
        else {
            continue;
        };
        let owning = context
            .schema
            .content_type(uid)
            .and_then(|content_type| content_type.attributes.get(field))
            .is_some_and(|attribute| {
                matches!(&attribute.kind, AttributeKind::Relation { mapped_by: None, .. })
            });
        if owning {
            relations
                .entry((link.left.uid.clone(), row, field.clone()))
                .or_default()
                .push((link.left.pos.unwrap_or_default(), target.clone()));
        }
    }
    for ((strapi_uid, row, field), mut targets) in relations {
        targets.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut seen = HashSet::new();
        let targets: Vec<String> =
            targets.into_iter().map(|(_, id)| id).filter(|id| seen.insert(id.clone())).collect();
        for id in inserted.get(&(strapi_uid.clone(), row)).into_iter().flatten() {
            let uid = &context.types[&strapi_uid];
            match context.service.import_links(uid, &field, *id, &targets).await {
                Ok(()) => report.links += targets.len(),
                Err(error) => {
                    report.warnings.push(format!("{uid}.{field}: links not imported ({error})"))
                }
            }
        }
    }
    for ((strapi_uid, row, field), mut items) in media {
        items.sort_by(|a, b| a.0.total_cmp(&b.0));
        let files: Vec<i64> = items.into_iter().map(|(_, id)| id).collect();
        for id in inserted.get(&(strapi_uid.clone(), row)).into_iter().flatten() {
            let uid = &context.types[&strapi_uid];
            match context.service.import_media(uid, &field, *id, &files).await {
                Ok(()) => report.media += files.len(),
                Err(error) => {
                    report.warnings.push(format!("{uid}.{field}: media not imported ({error})"))
                }
            }
        }
    }
    report.files_map = files.into_iter().collect();
    if let Some(auth) = context.auth {
        import_end_users(context, auth, &mut report).await?;
    }
    Ok(report)
}

/// `api::article.article.find` → (`api::article`, find); the media library's actions.
fn strapi_permission(
    types: &HashMap<String, String>,
    action: &str,
) -> Option<(String, verdin_auth::ContentAction)> {
    use verdin_auth::ContentAction as A;
    if let Some(rest) = action.strip_prefix("plugin::upload.content-api.") {
        let action = match rest {
            "find" => A::Find,
            "findOne" => A::FindOne,
            "upload" => A::Create,
            "destroy" => A::Delete,
            _ => return None,
        };
        return Some((verdin_auth::UPLOAD_SUBJECT.into(), action));
    }
    let (uid, action) = action.rsplit_once('.')?;
    let action = A::parse(action).filter(|action| {
        matches!(action, A::Find | A::FindOne | A::Create | A::Update | A::Delete)
    })?;
    Some((types.get(uid)?.clone(), action))
}

async fn import_end_users(
    context: &Context<'_>,
    auth: &verdin_auth::AuthService,
    report: &mut Report,
) -> Result<()> {
    let export = context.export;
    let role_of = |uid: &str| single_links(&export.links, uid, "role");
    let permission_roles = role_of(PERMISSION);
    let user_roles = role_of(USER);
    // Grants per Strapi role id.
    let mut grants: HashMap<i64, Vec<(String, verdin_auth::ContentAction)>> = HashMap::new();
    for permission in export.entities.iter().filter(|entity| entity.uid == PERMISSION) {
        let (Some(role), Some(action)) = (
            permission_roles.get(&permission.id),
            permission.data.get("action").and_then(Json::as_str),
        ) else {
            continue;
        };
        if let Some(grant) = strapi_permission(context.types, action) {
            grants.entry(*role).or_default().push(grant);
        }
    }
    let mut roles: HashMap<i64, i64> = HashMap::new();
    for role in export.entities.iter().filter(|entity| entity.uid == ROLE) {
        let kind = role.data.get("type").and_then(Json::as_str).unwrap_or_default();
        let name = role.data.get("name").and_then(Json::as_str).unwrap_or(kind);
        let description = role.data.get("description").and_then(Json::as_str);
        let role_grants = grants.remove(&role.id).unwrap_or_default();
        match kind {
            "public" => {
                auth.set_public_grants(&role_grants).await?;
            }
            "authenticated" => {
                let id = auth.end_user_role_id("authenticated").await?;
                auth.save_end_user_role(Some(id), name, description, &role_grants).await?;
                roles.insert(role.id, id);
            }
            _ => {
                let id = auth.save_end_user_role(None, name, description, &role_grants).await?;
                roles.insert(role.id, id);
                report.end_user_roles += 1;
            }
        }
    }
    let default_role = auth.end_user_role_id("authenticated").await?;
    for user in export.entities.iter().filter(|entity| entity.uid == USER) {
        let data = &user.data;
        let text = |key: &str| data.get(key).and_then(Json::as_str);
        let (Some(username), Some(email)) = (text("username"), text("email")) else { continue };
        let role = user_roles
            .get(&user.id)
            .and_then(|role| roles.get(role))
            .copied()
            .unwrap_or(default_role);
        match auth
            .import_end_user(
                username,
                email,
                text("password").filter(|hash| hash.starts_with('$')),
                text("provider").unwrap_or("local"),
                data.get("confirmed").and_then(Json::as_bool).unwrap_or(false),
                data.get("blocked").and_then(Json::as_bool).unwrap_or(false),
                role,
            )
            .await
        {
            Ok(_) => report.end_users += 1,
            Err(error) => {
                report.warnings.push(format!("end user {username}: not imported ({error})"))
            }
        }
    }
    Ok(())
}

/// v4: rows linked through `localizations` are locales of one document.
fn localization_groups(links: &[Link]) -> HashMap<(String, i64), i64> {
    let mut parent: HashMap<(String, i64), (String, i64)> = HashMap::new();
    fn find(
        parent: &mut HashMap<(String, i64), (String, i64)>,
        key: (String, i64),
    ) -> (String, i64) {
        let next = parent.get(&key).cloned().unwrap_or_else(|| key.clone());
        if next == key {
            return key;
        }
        let root = find(parent, next);
        parent.insert(key, root.clone());
        root
    }
    for link in links {
        if link.left.field.as_deref() != Some("localizations") || link.left.uid != link.right.uid {
            continue;
        }
        let (Some(left), Some(right)) = (link.left.row(), link.right.row()) else { continue };
        let a = find(&mut parent, (link.left.uid.clone(), left));
        let b = find(&mut parent, (link.right.uid.clone(), right));
        if a != b {
            let (low, high) = if a.1 <= b.1 { (a, b) } else { (b, a) };
            parent.insert(high, low);
        }
    }
    let keys: Vec<(String, i64)> = parent.keys().cloned().collect();
    keys.into_iter()
        .map(|key| {
            let root = find(&mut parent, key.clone());
            (key, root.1)
        })
        .collect()
}

fn escape(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

/// Records where each component row (by its Strapi id) sits in a row's data.
fn index_components(
    schema: &Schema,
    kind: &AttributeKind,
    value: &Json,
    pointer: &str,
    row: usize,
    out: &mut HashMap<(String, i64), (usize, String)>,
) {
    let mut item = |uid: &str, value: &Json, pointer: String| {
        let Some(object) = value.as_object() else { return };
        if let Some(id) = object.get("id").and_then(Json::as_i64) {
            out.insert((uid.to_owned(), id), (row, pointer.clone()));
        }
        if let Some(component) = schema.component(uid) {
            for (name, attribute) in &component.attributes {
                if let Some(value) = object.get(name) {
                    index_components(
                        schema,
                        &attribute.kind,
                        value,
                        &format!("{pointer}/{}", escape(name)),
                        row,
                        out,
                    );
                }
            }
        }
    };
    match (kind, value) {
        (AttributeKind::Component { component, .. }, Json::Array(items)) => {
            for (index, value) in items.iter().enumerate() {
                item(component, value, format!("{pointer}/{index}"));
            }
        }
        (AttributeKind::Component { component, .. }, value) => {
            item(component, value, pointer.to_owned())
        }
        (AttributeKind::DynamicZone { .. }, Json::Array(items)) => {
            for (index, value) in items.iter().enumerate() {
                if let Some(uid) = value.get("__component").and_then(Json::as_str) {
                    item(uid, value, format!("{pointer}/{index}"));
                }
            }
        }
        _ => {}
    }
}

/// Removes Strapi's component row ids (Verdin components have none).
fn strip_component_ids(value: &mut Json, top: bool) {
    match value {
        Json::Object(object) => {
            if !top {
                object.remove("id");
            }
            for value in object.values_mut() {
                strip_component_ids(value, false);
            }
        }
        Json::Array(items) => items.iter_mut().for_each(|item| strip_component_ids(item, false)),
        _ => {}
    }
}

async fn import_locales(context: &Context<'_>, report: &mut Report) -> Result<()> {
    let locales: Vec<&Map<String, Json>> = context
        .export
        .entities
        .iter()
        .filter(|entity| entity.uid == LOCALE)
        .map(|entity| &entity.data)
        .collect();
    if locales.is_empty() {
        return Ok(());
    }
    let now = verdin_db::value::truncate_millis(time::OffsetDateTime::now_utc());
    let existing = context.service.locales().get();
    for locale in &locales {
        let (Some(code), Some(name)) = (locale["code"].as_str(), locale["name"].as_str()) else {
            continue;
        };
        if !verdin_content::locales::valid_code(code) {
            report.warnings.push(format!("locale `{code}` skipped: not a valid code"));
            continue;
        }
        if existing.locales.iter().any(|locale| locale.code == code) {
            continue;
        }
        context
            .db
            .queries()
            .execute(
                &format!(
                    "INSERT INTO {LOCALES} (code, name, is_default, created_at, updated_at) \
                     VALUES (?, ?, ?, ?, ?)"
                ),
                &[
                    V::Text(code.into()),
                    V::Text(name.into()),
                    V::Bool(false),
                    V::DateTime(now),
                    V::DateTime(now),
                ],
            )
            .await?;
        report.locales += 1;
    }
    if let Some(default) = locales
        .iter()
        .find(|locale| locale.get("isDefault").and_then(Json::as_bool) == Some(true))
        .and_then(|locale| locale["code"].as_str())
    {
        let mut tx = context.db.begin().await?;
        tx.execute(&format!("UPDATE {LOCALES} SET is_default = ?"), &[V::Bool(false)]).await?;
        tx.execute(
            &format!("UPDATE {LOCALES} SET is_default = ? WHERE code = ?"),
            &[V::Bool(true), V::Text(default.into())],
        )
        .await?;
        tx.commit().await?;
    }
    context.service.locales().set(verdin_api::i18n::load_locales(context.db).await?);
    Ok(())
}

/// The Strapi row id `field` of `uid` links to, for each row.
fn single_links(links: &[Link], uid: &str, field: &str) -> HashMap<i64, i64> {
    links
        .iter()
        .filter(|link| link.left.uid == uid && link.left.field.as_deref() == Some(field))
        .filter_map(|link| Some((link.left.row()?, link.right.row()?)))
        .collect()
}

async fn import_folders(context: &Context<'_>, report: &mut Report) -> Result<HashMap<i64, i64>> {
    let parents = single_links(&context.export.links, FOLDER, "parent");
    let mut folders: Vec<_> =
        context.export.entities.iter().filter(|entity| entity.uid == FOLDER).collect();
    folders.sort_by_key(|entity| {
        entity.data.get("path").and_then(Json::as_str).map_or(0, |path| path.matches('/').count())
    });
    let mut ids = HashMap::new();
    for folder in folders {
        let (Some(name), Some(path_id), Some(path)) = (
            folder.data.get("name").and_then(Json::as_str),
            folder.data.get("pathId").and_then(Json::as_i64),
            folder.data.get("path").and_then(Json::as_str),
        ) else {
            continue;
        };
        let parent = parents.get(&folder.id).and_then(|parent| ids.get(parent)).copied();
        match context.upload.import_folder(name, path_id, path, parent).await {
            Ok(id) => {
                ids.insert(folder.id, id);
                report.folders += 1;
            }
            Err(error) => report.warnings.push(format!("folder {path}: not imported ({error})")),
        }
    }
    Ok(ids)
}

async fn import_files(
    context: &Context<'_>,
    folders: &HashMap<i64, i64>,
    report: &mut Report,
) -> Result<HashMap<i64, i64>> {
    let folder_of = single_links(&context.export.links, FILE, "folder");
    let mut ids = HashMap::new();
    for file in context.export.entities.iter().filter(|entity| entity.uid == FILE) {
        let data = &file.data;
        let text = |key: &str| data.get(key).and_then(Json::as_str).map(str::to_owned);
        let (Some(name), Some(hash), Some(ext), Some(mime)) =
            (text("name"), text("hash"), text("ext"), text("mime"))
        else {
            continue;
        };
        let main = format!("{hash}{ext}");
        let Some(path) = context.export.asset(&main) else {
            report
                .warnings
                .push(format!("file {name}: {main} is missing from the export; skipped"));
            continue;
        };
        let mut objects = vec![ImportedObject { key: main, path, mime: mime.clone() }];
        let mut formats = Map::new();
        if let Some(Json::Object(all)) = data.get("formats") {
            for (format_name, format) in all {
                let key = format!(
                    "{}{}",
                    format["hash"].as_str().unwrap_or_default(),
                    format["ext"].as_str().unwrap_or_default()
                );
                match context.export.asset(&key) {
                    Some(path) => {
                        objects.push(ImportedObject {
                            key,
                            path,
                            mime: format["mime"].as_str().unwrap_or(&mime).to_owned(),
                        });
                        formats.insert(format_name.clone(), format.clone());
                    }
                    None => report
                        .warnings
                        .push(format!("file {name}: format {format_name} missing; dropped")),
                }
            }
        }
        let imported = ImportedFile {
            name: name.clone(),
            alternative_text: text("alternativeText"),
            caption: text("caption"),
            width: data.get("width").and_then(Json::as_i64),
            height: data.get("height").and_then(Json::as_i64),
            focal_point: data.get("focalPoint").filter(|value| value.is_object()).cloned(),
            formats: (!formats.is_empty()).then_some(formats),
            hash,
            ext,
            mime,
            size: data.get("size").and_then(Json::as_f64).unwrap_or_default(),
            folder_id: folder_of.get(&file.id).and_then(|folder| folders.get(folder)).copied(),
            folder_path: text("folderPath").unwrap_or_else(|| "/".into()),
            created_at: text("createdAt").as_deref().and_then(parse_datetime),
            updated_at: text("updatedAt").as_deref().and_then(parse_datetime),
            objects,
        };
        match context.upload.import_file(imported).await {
            Ok(record) => {
                ids.insert(file.id, record.id);
                report.files += 1;
            }
            Err(error) => report.warnings.push(format!("file {name}: not imported ({error})")),
        }
    }
    Ok(ids)
}
