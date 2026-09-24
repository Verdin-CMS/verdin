//! Media library: uploads, formats, media fields in content, folders and permissions.

mod common;

use axum::http::{Method, StatusCode};
use common::{App, As, Part};
use serde_json::{Value, json};
use verdin_schema::{Schema, Source};

fn schema() -> Schema {
    Schema::parse(&[Source::content_type(
        "article",
        json!({
            "kind": "collectionType", "singularName": "article", "pluralName": "articles",
            "displayName": "Article", "options": { "draftAndPublish": true },
            "attributes": {
                "title": { "type": "string" },
                "cover": { "type": "media", "allowedTypes": ["images"], "required": true },
                "gallery": { "type": "media", "multiple": true },
            }
        })
        .to_string(),
    )])
    .unwrap()
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbImage::from_fn(width, height, |x, y| image::Rgb([x as u8, y as u8, 90]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    bytes.into_inner()
}

const PASSWORD: &str = "correct horse 1";

async fn register(app: &App) -> String {
    let body = json!({ "email": "ada@example.com", "password": PASSWORD, "firstname": "Ada" });
    let (status, body) = app
        .call_as(Method::POST, "/admin/api/auth/register-first-admin", Some(body), As::Anonymous)
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["data"]["accessToken"].as_str().unwrap().to_owned()
}

async fn user(app: &App, admin: &str, email: &str, role: &str) -> String {
    let (_, roles) = app.call_as(Method::GET, "/admin/api/roles", None, As::Bearer(admin)).await;
    let role_id =
        roles["data"].as_array().unwrap().iter().find(|r| r["code"] == role).unwrap()["id"].clone();
    let body = json!({ "email": email, "password": PASSWORD, "roles": [role_id] });
    let (status, body) =
        app.call_as(Method::POST, "/admin/api/users", Some(body), As::Bearer(admin)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let body = json!({ "email": email, "password": PASSWORD });
    let (_, body) =
        app.call_as(Method::POST, "/admin/api/auth/login", Some(body), As::Anonymous).await;
    body["data"]["accessToken"].as_str().unwrap().to_owned()
}

/// Uploads one file through the admin API and returns it.
async fn upload(app: &App, who: &str, name: &str, bytes: Vec<u8>, extra: &[Part<'_>]) -> Value {
    let mut parts = vec![Part::file("files", name, bytes)];
    parts.extend(extra.iter().map(|part| Part {
        name: part.name,
        file_name: part.file_name,
        bytes: part.bytes.clone(),
    }));
    let response = app.multipart(Method::POST, "/admin/api/upload", &parts, As::Bearer(who)).await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
    response.body["data"][0].clone()
}

#[tokio::test]
async fn uploads_detect_types_and_generate_formats() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;

    let info = Part::text("fileInfo", r#"{ "alternativeText": "A gradient", "caption": "Test" }"#);
    let file = upload(&app, &admin, "My Photo.jpg", png(1200, 800), &[info]).await;
    assert_eq!(file["name"], "My Photo.jpg");
    assert_eq!(file["mime"], "image/png", "the bytes win over the name");
    assert_eq!(file["ext"], ".jpg");
    assert_eq!((file["width"].clone(), file["height"].clone()), (json!(1200), json!(800)));
    assert_eq!(file["alternativeText"], "A gradient");
    assert_eq!(file["provider"], "local");
    let hash = file["hash"].as_str().unwrap();
    assert!(hash.starts_with("my_photo_"), "{hash}");
    assert_eq!(file["url"], format!("/uploads/{hash}.jpg"));
    let formats = file["formats"].as_object().unwrap();
    let mut names: Vec<&String> = formats.keys().collect();
    names.sort();
    assert_eq!(names, ["large", "medium", "small", "thumbnail"]);
    assert_eq!(formats["small"]["width"], 500);
    assert_eq!(formats["thumbnail"]["height"], 156);
    let thumbnail_url = formats["thumbnail"]["url"].as_str().unwrap();
    assert_eq!(thumbnail_url, format!("/uploads/thumbnail_{hash}.jpg"));
    assert!(app.upload.storage().get(&format!("{hash}.jpg")).await.is_ok());
    assert!(app.upload.storage().get(&format!("thumbnail_{hash}.jpg")).await.is_ok());

    let text = upload(&app, &admin, "notes.txt", b"plain notes".to_vec(), &[]).await;
    assert_eq!(text["mime"], "text/plain");
    assert!(text["formats"].is_null());
    assert!(text["width"].is_null());

    // Over the configured limit (2 MB in tests).
    let big = vec![0_u8; 3 * 1024 * 1024];
    let response = app
        .multipart(
            Method::POST,
            "/admin/api/upload",
            &[Part::file("files", "big.bin", big)],
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(response.status, StatusCode::PAYLOAD_TOO_LARGE, "{}", response.body);

    // Metadata edits and deletion (objects are removed too).
    let id = file["id"].as_i64().unwrap();
    let url = format!("/admin/api/upload/files/{id}");
    let (status, body) = app
        .call_as(Method::PUT, &url, Some(json!({ "name": "renamed.jpg", "caption": null, "focalPoint": { "x": 0.25, "y": 0.75 } })), As::Bearer(&admin))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["name"], "renamed.jpg");
    assert!(body["data"]["caption"].is_null());
    assert_eq!(body["data"]["alternativeText"], "A gradient");
    assert_eq!(body["data"]["focalPoint"], json!({ "x": 0.25, "y": 0.75 }));
    let bad = json!({ "focalPoint": { "x": 3, "y": 0 } });
    assert_eq!(
        app.call_as(Method::PUT, &url, Some(bad), As::Bearer(&admin)).await.0,
        StatusCode::BAD_REQUEST
    );

    let (status, body) = app
        .call_as(
            Method::GET,
            "/admin/api/upload/files?types=images&search=RENAMED",
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["meta"]["pagination"]["total"], 1);
    let (_, body) = app
        .call_as(Method::GET, "/admin/api/upload/files?types=files", None, As::Bearer(&admin))
        .await;
    assert_eq!(body["data"][0]["name"], "notes.txt");

    assert_eq!(
        app.call_as(Method::DELETE, &url, None, As::Bearer(&admin)).await.0,
        StatusCode::NO_CONTENT
    );
    assert!(app.upload.storage().get(&format!("{hash}.jpg")).await.is_err());
    assert!(app.upload.storage().get(&format!("thumbnail_{hash}.jpg")).await.is_err());
    assert_eq!(
        app.call_as(Method::GET, &url, None, As::Bearer(&admin)).await.0,
        StatusCode::NOT_FOUND
    );
    app.done().await;
}

#[tokio::test]
async fn content_api_upload_routes() {
    let app = App::new(schema()).await;
    // The harness token has full access.
    let token = app.token.clone();
    let response = app
        .multipart(
            Method::POST,
            "/api/upload",
            &[
                Part::file("files", "a.png", png(20, 10)),
                Part::file("files", "b.png", png(10, 20)),
                Part::text("fileInfo", r#"[{ "caption": "first" }, { "caption": "second" }]"#),
            ],
            As::Bearer(&token),
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.body);
    let files = response.body.as_array().unwrap();
    assert_eq!(files.len(), 2);
    assert_eq!(files[1]["caption"], "second");
    let id = files[0]["id"].as_i64().unwrap();

    let (status, body) = app.get("/api/upload/files?sort=name:asc").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 2, "a plain array, like Strapi");
    assert_eq!(body[0]["name"], "a.png");
    assert_eq!(app.get(&format!("/api/upload/files/{id}")).await.1["caption"], "first");

    let response = app
        .multipart(
            Method::POST,
            &format!("/api/upload?id={id}"),
            &[Part::text("fileInfo", r#"{ "alternativeText": "alt" }"#)],
            As::Bearer(&token),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.body);
    assert_eq!(response.body["alternativeText"], "alt");

    // Closed to the public until granted.
    assert_eq!(
        app.call_as(Method::GET, "/api/upload/files", None, As::Anonymous).await.0,
        StatusCode::FORBIDDEN
    );
    let admin = register(&app).await;
    let grants = json!({ "permissions": [{ "subject": "plugin::upload", "action": "find" }] });
    let (status, body) = app
        .call_as(Method::PUT, "/admin/api/public-permissions", Some(grants), As::Bearer(&admin))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        app.call_as(Method::GET, "/api/upload/files", None, As::Anonymous).await.0,
        StatusCode::OK
    );
    let bad = json!({ "permissions": [{ "subject": "plugin::upload", "action": "publish" }] });
    assert_eq!(
        app.call_as(Method::PUT, "/admin/api/public-permissions", Some(bad), As::Bearer(&admin))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );

    let (status, body) = app.call(Method::DELETE, &format!("/api/upload/files/{id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], id);
    assert_eq!(app.get(&format!("/api/upload/files/{id}")).await.0, StatusCode::NOT_FOUND);
    app.done().await;
}

#[tokio::test]
async fn media_fields_in_content() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    let image = upload(&app, &admin, "cover.png", png(40, 30), &[]).await;
    let other = upload(&app, &admin, "other.png", png(30, 40), &[]).await;
    let text = upload(&app, &admin, "readme.txt", b"hello".to_vec(), &[]).await;
    let (image_id, other_id, text_id) = (
        image["id"].as_i64().unwrap(),
        other["id"].as_i64().unwrap(),
        text["id"].as_i64().unwrap(),
    );

    // Required media is checked on publish.
    let (status, body) = app.post("/api/articles", json!({ "title": "No cover" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["error"]["details"]["errors"][0]["message"], "cover is a required field");

    // allowedTypes, existence and cardinality.
    let (status, body) = app.post("/api/articles", json!({ "title": "x", "cover": text_id })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        body["error"]["message"].as_str().unwrap().contains("only images are allowed"),
        "{body}"
    );
    assert_eq!(
        app.post("/api/articles", json!({ "cover": 999_999 })).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.post("/api/articles", json!({ "cover": [image_id, other_id] })).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        app.post("/api/articles", json!({ "cover": "nope" })).await.0,
        StatusCode::BAD_REQUEST
    );

    let (status, body) = app
        .post(
            "/api/articles?populate=*",
            json!({ "title": "Hello", "cover": { "id": image_id }, "gallery": [other_id, text_id, image_id] }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["data"]["cover"]["name"], "cover.png");
    let gallery: Vec<&Value> =
        body["data"]["gallery"].as_array().unwrap().iter().map(|f| &f["name"]).collect();
    assert_eq!(gallery, ["other.png", "readme.txt", "cover.png"], "in the given order");
    let document_id = body["data"]["documentId"].as_str().unwrap().to_owned();

    // Media fields need populate, like relations.
    let (_, body) = app.get(&format!("/api/articles/{document_id}")).await;
    assert!(body["data"].get("cover").is_none());
    let (_, body) = app.get(&format!("/api/articles/{document_id}?populate[0]=gallery")).await;
    assert_eq!(body["data"]["gallery"].as_array().unwrap().len(), 3);
    assert!(body["data"].get("cover").is_none());
    assert_eq!(
        app.get("/api/articles?filters[cover][$null]=true").await.0,
        StatusCode::BAD_REQUEST
    );

    // Drafts keep their own files until published.
    let draft = format!("/api/articles/{document_id}?status=draft");
    let (status, _) = app.put(&draft, json!({ "gallery": [] })).await;
    assert_eq!(status, StatusCode::OK);
    let (_, body) = app.get(&format!("/api/articles/{document_id}?populate=gallery")).await;
    assert_eq!(body["data"]["gallery"].as_array().unwrap().len(), 3, "published version unchanged");
    app.call(Method::POST, &format!("/api/articles/{document_id}/actions/publish"), None).await;
    let (_, body) = app.get(&format!("/api/articles/{document_id}?populate=*")).await;
    assert_eq!(body["data"]["gallery"], json!([]));
    assert_eq!(body["data"]["cover"]["id"], image_id);

    // Deleting a file detaches it everywhere.
    let url = format!("/admin/api/upload/files/{image_id}");
    assert_eq!(
        app.call_as(Method::DELETE, &url, None, As::Bearer(&admin)).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, body) = app.get(&format!("/api/articles/{document_id}?populate=cover")).await;
    assert!(body["data"]["cover"].is_null());
    app.done().await;
}

#[tokio::test]
async fn folders() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    let create = |name: &str, parent: Option<i64>| json!({ "name": name, "parent": parent });
    let (status, body) = app
        .call_as(
            Method::POST,
            "/admin/api/upload/folders",
            Some(create("Photos", None)),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let photos = body["data"]["id"].as_i64().unwrap();
    let photos_path = body["data"]["path"].as_str().unwrap().to_owned();
    let (_, body) = app
        .call_as(
            Method::POST,
            "/admin/api/upload/folders",
            Some(create("2026", Some(photos))),
            As::Bearer(&admin),
        )
        .await;
    let year = body["data"]["id"].as_i64().unwrap();
    assert_eq!(body["data"]["path"], format!("{photos_path}/{}", body["data"]["pathId"]));
    let duplicate = app
        .call_as(
            Method::POST,
            "/admin/api/upload/folders",
            Some(create("photos", None)),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(duplicate.0, StatusCode::BAD_REQUEST, "names are unique per parent");

    let year_text = year.to_string();
    let file =
        upload(&app, &admin, "beach.png", png(10, 10), &[Part::text("folder", &year_text)]).await;
    assert_eq!(file["folder"], year);
    let root_file = upload(&app, &admin, "root.png", png(10, 10), &[]).await;

    let (_, body) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/upload/files?folder={year}"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    let (_, body) =
        app.call_as(Method::GET, "/admin/api/upload/files", None, As::Bearer(&admin)).await;
    assert_eq!(body["data"][0]["id"], root_file["id"], "the root by default");
    let (_, body) =
        app.call_as(Method::GET, "/admin/api/upload/folders", None, As::Bearer(&admin)).await;
    assert_eq!(body["data"][0]["childrenCount"], 1);
    let (_, body) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/upload/folders?parent={photos}"),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(body["data"][0]["filesCount"], 1);

    // Moving "2026" to the root rewrites the paths below it.
    let url = format!("/admin/api/upload/folders/{year}");
    let (status, body) = app
        .call_as(
            Method::PUT,
            &url,
            Some(json!({ "parent": null, "name": "Year 2026" })),
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let moved_path = body["data"]["path"].as_str().unwrap().to_owned();
    assert!(!moved_path.starts_with(&photos_path));
    let (_, body) = app
        .call_as(
            Method::GET,
            &format!("/admin/api/upload/files/{}", file["id"]),
            None,
            As::Bearer(&admin),
        )
        .await;
    assert_eq!(body["data"]["folderPath"], moved_path);
    let into_itself = json!({ "parent": year });
    assert_eq!(
        app.call_as(Method::PUT, &url, Some(into_itself), As::Bearer(&admin)).await.0,
        StatusCode::BAD_REQUEST
    );

    assert_eq!(
        app.call_as(Method::DELETE, &url, None, As::Bearer(&admin)).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.call_as(
            Method::GET,
            &format!("/admin/api/upload/files/{}", file["id"]),
            None,
            As::Bearer(&admin)
        )
        .await
        .0,
        StatusCode::NOT_FOUND,
        "a folder's files go with it"
    );
    app.done().await;
}

#[tokio::test]
async fn media_permissions() {
    let app = App::new(schema()).await;
    let admin = register(&app).await;
    let author = user(&app, &admin, "author@example.com", "author").await;
    let other_author = user(&app, &admin, "other@example.com", "author").await;
    let editor = user(&app, &admin, "editor@example.com", "editor").await;

    let mine = upload(&app, &author, "mine.png", png(5, 5), &[]).await;
    let url = format!("/admin/api/upload/files/{}", mine["id"]);
    // Authors see every file but change only theirs.
    assert_eq!(
        app.call_as(Method::GET, &url, None, As::Bearer(&other_author)).await.0,
        StatusCode::OK
    );
    let rename = json!({ "name": "theirs.png" });
    assert_eq!(
        app.call_as(Method::PUT, &url, Some(rename.clone()), As::Bearer(&other_author)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.call_as(Method::DELETE, &url, None, As::Bearer(&other_author)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.call_as(Method::PUT, &url, Some(rename), As::Bearer(&author)).await.0,
        StatusCode::OK
    );
    let folder = json!({ "name": "Shared" });
    let (status, body) = app
        .call_as(Method::POST, "/admin/api/upload/folders", Some(folder), As::Bearer(&author))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let folder_url = format!("/admin/api/upload/folders/{}", body["data"]["id"]);
    assert_eq!(
        app.call_as(Method::DELETE, &folder_url, None, As::Bearer(&author)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.call_as(Method::DELETE, &folder_url, None, As::Bearer(&editor)).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.call_as(Method::DELETE, &url, None, As::Bearer(&editor)).await.0,
        StatusCode::NO_CONTENT
    );

    // A role without media permissions.
    let role = json!({ "code": "readers", "name": "Readers", "permissions": [{ "action": "content.read", "subject": "*" }] });
    let (status, body) =
        app.call_as(Method::POST, "/admin/api/roles", Some(role), As::Bearer(&admin)).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let bad = json!({ "code": "bad", "name": "Bad", "permissions": [{ "action": "media.read", "subject": "*" }] });
    assert_eq!(
        app.call_as(Method::POST, "/admin/api/roles", Some(bad), As::Bearer(&admin)).await.0,
        StatusCode::BAD_REQUEST
    );
    app.done().await;
}

#[tokio::test]
async fn existing_installations_receive_media_permissions_once() {
    let app = App::new(schema()).await;
    let db = &app.test.db;
    let editor_id = || async {
        db.queries()
            .fetch_all(
                "SELECT id FROM vd_admin_roles WHERE code = 'editor'",
                &[],
                &[verdin_db::ColumnKind::BigInt],
            )
            .await
            .unwrap()[0][0]
            .as_i64()
            .unwrap()
    };
    let media_count = || async {
        let id = editor_id().await;
        db.queries()
            .fetch_all(
                &format!("SELECT COUNT(*) FROM vd_admin_permissions WHERE role_id = {id} AND action LIKE 'media.%'"),
                &[],
                &[verdin_db::ColumnKind::BigInt],
            )
            .await
            .unwrap()[0][0]
            .as_i64()
            .unwrap()
    };
    assert_eq!(media_count().await, 4);
    // Simulate a 0.1 database: no media permissions, no version marker.
    let id = editor_id().await;
    db.queries()
        .execute(
            &format!(
                "DELETE FROM vd_admin_permissions WHERE role_id = {id} AND action LIKE 'media.%'"
            ),
            &[],
        )
        .await
        .unwrap();
    db.queries().execute("DELETE FROM vd_settings", &[]).await.unwrap();
    app.auth.bootstrap().await.unwrap();
    assert_eq!(media_count().await, 4);
    // An admin removing them later is respected.
    db.queries()
        .execute(
            &format!(
                "DELETE FROM vd_admin_permissions WHERE role_id = {id} AND action = 'media.delete'"
            ),
            &[],
        )
        .await
        .unwrap();
    app.auth.bootstrap().await.unwrap();
    assert_eq!(media_count().await, 3);
    app.done().await;
}
