//! `verdin import strapi`: a Strapi v4/v5 project, from a `strapi export` file or
//! directory, into this project: schema files first, then (after migrating) locales,
//! folders, files, entries, relations and media.

pub mod data;
pub mod export;
pub mod schema;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use verdin_db::Database;
use verdin_migrate::{ApplyOptions, Renames, Risk};
use verdin_schema::Schema;

pub use data::Report;

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// Write the schema files and stop.
    pub schema_only: bool,
    /// Overwrite existing schema files and import into types that already have entries.
    pub force: bool,
}

pub struct Outcome {
    /// Schema files written, relative to the schema directory.
    pub files: Vec<PathBuf>,
    pub schema_warnings: Vec<String>,
    pub strapi_version: Option<String>,
    /// `None` with `schema_only`.
    pub report: Option<Report>,
}

/// Runs the import into the project whose schema lives in `schema_dir`.
pub async fn strapi(
    source: &Path,
    schema_dir: &Path,
    db: &Database,
    upload: &verdin_upload::UploadService,
    auth: Option<&verdin_auth::AuthService>,
    options: &Options,
) -> Result<Outcome> {
    let export = export::Export::open(source)?;
    let converted = schema::convert(&export.schemas);
    if converted.files.is_empty() {
        bail!("the export has no api:: content types");
    }

    // Schema files, restored if the result does not validate.
    let existing: Vec<&PathBuf> = converted
        .files
        .iter()
        .map(|(path, _)| path)
        .filter(|path| schema_dir.join(path).exists())
        .collect();
    if !existing.is_empty() && !options.force {
        let names: Vec<String> = existing.iter().map(|path| path.display().to_string()).collect();
        bail!("these schema files already exist (use --force to overwrite): {}", names.join(", "));
    }
    let mut backups: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::new();
    for (path, json) in &converted.files {
        let target = schema_dir.join(path);
        backups.push((target.clone(), std::fs::read(&target).ok()));
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        let text = serde_json::to_string_pretty(json).expect("JSON serializes") + "\n";
        std::fs::write(&target, text).with_context(|| format!("writing {}", target.display()))?;
    }
    let schema = match Schema::load_dir(schema_dir) {
        Ok(schema) => schema,
        Err(errors) => {
            for (path, previous) in backups {
                match previous {
                    Some(bytes) => std::fs::write(&path, bytes)?,
                    None => std::fs::remove_file(&path)?,
                }
            }
            bail!("the converted schema is not valid, nothing was written:\n{errors}");
        }
    };
    let mut outcome = Outcome {
        files: converted.files.iter().map(|(path, _)| path.clone()).collect(),
        schema_warnings: converted.warnings.clone(),
        strapi_version: export.strapi_version.clone(),
        report: None,
    };
    if options.schema_only {
        return Ok(outcome);
    }

    let desired = verdin_migrate::derive_model(&schema);
    verdin_migrate::apply(db, &desired, &Renames::default(), ApplyOptions { allow: Risk::Safe })
        .await
        .context("migrating the database to the imported schema")?;
    if let Some(auth) = auth {
        auth.bootstrap().await.context("creating built-in roles")?;
    }

    let registry = verdin_content::Registry::new(schema.clone());
    if !options.force {
        for uid in converted.types.values() {
            let table = registry.get(uid)?.table().to_owned();
            let quoted = db.flavor().quote(&table);
            if db.queries().has_rows(&format!("SELECT 1 FROM {quoted} LIMIT 1"), &[]).await? {
                bail!("{uid} already has entries (use --force to import anyway)");
            }
        }
    }
    let locales = verdin_content::locales::Locales::new(verdin_api::i18n::load_locales(db).await?);
    let service = verdin_content::DocumentService::new(
        db.clone(),
        registry,
        verdin_content::OutputOptions::default(),
    )
    .with_locales(locales);
    let context = data::Context {
        export: &export,
        schema: &schema,
        types: &converted.types,
        service: &service,
        upload,
        db,
        auth,
    };
    outcome.report = Some(data::import(&context).await?);
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value as Json, json};
    use verdin_query::{PageMode, Pagination, Populate, Query, Status};

    use super::*;

    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/strapi-v5")
    }

    fn query(status: Status, populate: &[&str]) -> Query {
        Query {
            filters: None,
            sort: Vec::new(),
            fields: None,
            populate: populate
                .iter()
                .map(|field| Populate { field: (*field).into(), query: None })
                .collect(),
            pagination: Pagination {
                mode: PageMode::Offset { start: 0, limit: 100 },
                with_count: false,
            },
            status,
        }
    }

    struct Target {
        _dir: tempfile::TempDir,
        db: Database,
        upload: verdin_upload::UploadService,
        schema_dir: PathBuf,
    }

    async fn target() -> Target {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::connect(
            &format!("sqlite://{}?mode=rwc", dir.path().join("data.db").display()),
            &Default::default(),
        )
        .await
        .unwrap();
        let storage =
            verdin_upload::Storage::new(&verdin_upload::ProviderConfig::default(), dir.path())
                .unwrap();
        let upload = verdin_upload::UploadService::new(db.clone(), storage, Default::default());
        let schema_dir = dir.path().join("schema");
        Target { _dir: dir, db, upload, schema_dir }
    }

    async fn service(target: &Target) -> verdin_content::DocumentService {
        let schema = Schema::load_dir(&target.schema_dir).unwrap();
        let locales = verdin_api::i18n::load_locales(&target.db).await.unwrap();
        verdin_content::DocumentService::new(
            target.db.clone(),
            verdin_content::Registry::new(schema),
            Default::default(),
        )
        .with_locales(verdin_content::locales::Locales::new(locales))
    }

    #[tokio::test]
    async fn imports_a_strapi_5_export() {
        let target = target().await;
        let options = Options::default();
        let outcome =
            strapi(&fixture(), &target.schema_dir, &target.db, &target.upload, None, &options)
                .await
                .unwrap();
        assert_eq!(outcome.strapi_version.as_deref(), Some("5.20.0"));
        assert_eq!(outcome.files.len(), 21);
        let report = outcome.report.unwrap();
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);
        assert_eq!(report.documents, 12);
        assert_eq!(report.files, 9);
        assert_eq!(report.locales, 3, "fr, de, es (en exists)");
        assert_eq!(report.versions["api::article"], 4);

        let service = service(&target).await;
        let english =
            service.find_many("api::article", &query(Status::Draft, &["authors"])).await.unwrap();
        assert_eq!(english.documents.len(), 2);
        assert!(english.documents.iter().all(|doc| doc["locale"] == "en"));
        let authors: Vec<&Json> =
            english.documents.iter().flat_map(|doc| doc["authors"].as_array().unwrap()).collect();
        assert!(!authors.is_empty(), "authors linked");
        assert!(authors.iter().all(|author| author["name"].is_string()));
        let french = service
            .in_locale(Some("fr".into()))
            .find_many("api::article", &query(Status::Draft, &[]))
            .await
            .unwrap();
        assert_eq!(french.documents.len(), 2);

        let authors =
            service.find_many("api::author", &query(Status::Draft, &["profile"])).await.unwrap();
        assert_eq!(authors.documents.len(), 3);
        let profile = &authors.documents[0]["profile"];
        assert_eq!(profile["mime"], "image/jpeg");
        assert!(profile["url"].as_str().unwrap().starts_with("/uploads/"));
        assert!(
            profile["formats"]["thumbnail"]["url"]
                .as_str()
                .unwrap()
                .starts_with("/uploads/thumbnail_")
        );

        let shop = service
            .find_many("api::shop", &query(Status::Draft, &["content", "seo"]))
            .await
            .unwrap();
        assert_eq!(shop.documents[0]["content"][1]["__component"], "page-blocks.content-and-image");
        assert_eq!(shop.documents[0]["seo"]["title"], "Shop - UK");

        // A second run refuses to overwrite.
        let again =
            strapi(&fixture(), &target.schema_dir, &target.db, &target.upload, None, &options)
                .await;
        assert!(again.err().unwrap().to_string().contains("already exist"));
    }

    /// A small v4 export with relations and media inside components, as a `.tar.gz`.
    #[tokio::test]
    async fn imports_a_strapi_4_archive() {
        let source = tempfile::tempdir().unwrap();
        let root = source.path().join("export");
        let write = |path: &str, lines: &[Json]| {
            let path = root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            let text: Vec<String> = lines.iter().map(Json::to_string).collect();
            std::fs::write(path, text.join("\n") + "\n").unwrap();
        };
        write("metadata.json", &[json!({ "strapi": { "version": "4.25.1" } })]);
        write(
            "schemas/schemas_00001.jsonl",
            &[
                json!({ "uid": "api::page.page", "modelType": "contentType", "kind": "collectionType",
                        "info": { "singularName": "page", "pluralName": "pages", "displayName": "Page" },
                        "options": { "draftAndPublish": true }, "pluginOptions": { "i18n": { "localized": true } },
                        "attributes": {
                            "title": { "type": "string" },
                            "hero": { "type": "component", "component": "blocks.hero" },
                            "related": { "type": "relation", "relation": "manyToMany", "target": "api::page.page" },
                            "localizations": { "type": "relation", "relation": "oneToMany", "target": "api::page.page" }
                        } }),
                json!({ "uid": "blocks.hero", "modelType": "component", "info": { "displayName": "Hero" },
                        "attributes": {
                            "heading": { "type": "string" },
                            "image": { "type": "media", "multiple": false },
                            "link": { "type": "relation", "relation": "oneToOne", "target": "api::page.page" }
                        } }),
            ],
        );
        write(
            "entities/entities_00001.jsonl",
            &[
                json!({ "type": "plugin::i18n.locale", "id": 1, "data": { "code": "en", "name": "English", "isDefault": true } }),
                json!({ "type": "plugin::i18n.locale", "id": 2, "data": { "code": "fr", "name": "French" } }),
                json!({ "type": "plugin::upload.file", "id": 7, "data": { "name": "hero.png", "hash": "hero_1", "ext": ".png", "mime": "image/png", "size": 0.07, "width": 1, "height": 1, "url": "/uploads/hero_1.png", "folderPath": "/" } }),
                json!({ "type": "api::page.page", "id": 1, "data": { "title": "Home", "locale": "en", "publishedAt": "2024-01-01T00:00:00.000Z", "hero": { "id": 10, "heading": "Hi" } } }),
                json!({ "type": "api::page.page", "id": 2, "data": { "title": "Accueil", "locale": "fr", "publishedAt": null, "hero": { "id": 11, "heading": "Salut" } } }),
                json!({ "type": "api::page.page", "id": 3, "data": { "title": "About", "locale": "en", "publishedAt": null, "hero": null } }),
                json!({ "type": "plugin::users-permissions.role", "id": 1, "data": { "name": "Authenticated", "type": "authenticated" } }),
                json!({ "type": "plugin::users-permissions.role", "id": 2, "data": { "name": "Public", "type": "public" } }),
                json!({ "type": "plugin::users-permissions.role", "id": 3, "data": { "name": "Editors", "type": "editors" } }),
                json!({ "type": "plugin::users-permissions.permission", "id": 1, "data": { "action": "api::page.page.find" } }),
                json!({ "type": "plugin::users-permissions.permission", "id": 2, "data": { "action": "api::page.page.findOne" } }),
                json!({ "type": "plugin::users-permissions.permission", "id": 3, "data": { "action": "plugin::users-permissions.user.me" } }),
                json!({ "type": "plugin::users-permissions.user", "id": 1, "data": { "username": "ada", "email": "ada@example.com", "provider": "local",
                        "password": "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy", "confirmed": true, "blocked": false } }),
            ],
        );
        write(
            "links/links_00001.jsonl",
            &[
                json!({ "kind": "relation.circular", "relation": "manyToMany", "left": { "type": "api::page.page", "ref": 1, "field": "localizations" }, "right": { "type": "api::page.page", "ref": 2 } }),
                json!({ "kind": "relation.circular", "relation": "manyToMany", "left": { "type": "api::page.page", "ref": 1, "field": "related", "pos": 1 }, "right": { "type": "api::page.page", "ref": 3 } }),
                json!({ "kind": "relation.basic", "relation": "oneToOne", "left": { "type": "blocks.hero", "ref": 10, "field": "link" }, "right": { "type": "api::page.page", "ref": 3 } }),
                json!({ "kind": "relation.morph", "relation": "morphToMany", "left": { "type": "plugin::upload.file", "ref": 7, "field": "related" }, "right": { "type": "blocks.hero", "ref": 11, "field": "image", "pos": 1 } }),
                json!({ "kind": "relation.basic", "relation": "manyToOne", "left": { "type": "plugin::users-permissions.permission", "ref": 1, "field": "role" }, "right": { "type": "plugin::users-permissions.role", "ref": 2 } }),
                json!({ "kind": "relation.basic", "relation": "manyToOne", "left": { "type": "plugin::users-permissions.permission", "ref": 2, "field": "role" }, "right": { "type": "plugin::users-permissions.role", "ref": 3 } }),
                json!({ "kind": "relation.basic", "relation": "manyToOne", "left": { "type": "plugin::users-permissions.permission", "ref": 3, "field": "role" }, "right": { "type": "plugin::users-permissions.role", "ref": 1 } }),
                json!({ "kind": "relation.basic", "relation": "manyToOne", "left": { "type": "plugin::users-permissions.user", "ref": 1, "field": "role" }, "right": { "type": "plugin::users-permissions.role", "ref": 3 } }),
            ],
        );
        std::fs::create_dir_all(root.join("assets/uploads")).unwrap();
        std::fs::write(root.join("assets/uploads/hero_1.png"), b"png").unwrap();
        let archive = source.path().join("export.tar.gz");
        {
            let file = std::fs::File::create(&archive).unwrap();
            let gzip = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
            let mut tar = tar::Builder::new(gzip);
            tar.append_dir_all(".", &root).unwrap();
            tar.into_inner().unwrap().finish().unwrap();
        }

        let target = target().await;
        let auth = verdin_auth::AuthService::new(
            target.db.clone(),
            verdin_auth::AuthConfig::new(&"s".repeat(32), &"p".repeat(32)).unwrap(),
        );
        let outcome = strapi(
            &archive,
            &target.schema_dir,
            &target.db,
            &target.upload,
            Some(&auth),
            &Options::default(),
        )
        .await
        .unwrap();
        let report = outcome.report.unwrap();
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);
        assert_eq!(report.documents, 2, "Home and Accueil are one document");
        assert_eq!(report.versions["api::page"], 4, "Home: draft + published; Accueil; About");

        let service = service(&target).await;
        let published = service
            .find_many("api::page", &query(Status::Published, &["related", "hero"]))
            .await
            .unwrap();
        assert_eq!(published.documents.len(), 1);
        let home = &published.documents[0];
        assert_eq!(home["title"], "Home");
        assert_eq!(home["related"][0]["title"].as_str(), None, "About is not published");
        let drafts = service
            .find_many("api::page", &query(Status::Draft, &["related", "hero"]))
            .await
            .unwrap();
        let home = drafts.documents.iter().find(|doc| doc["title"] == "Home").unwrap();
        assert_eq!(home["related"][0]["title"], "About");
        assert_eq!(home["hero"]["link"]["title"], "About", "relation inside the component");
        let french = service
            .in_locale(Some("fr".into()))
            .find_many("api::page", &query(Status::Draft, &["hero"]))
            .await
            .unwrap();
        assert_eq!(french.documents[0]["documentId"], home["documentId"]);
        assert_eq!(
            french.documents[0]["hero"]["image"]["name"], "hero.png",
            "media inside the component"
        );
    }
}
