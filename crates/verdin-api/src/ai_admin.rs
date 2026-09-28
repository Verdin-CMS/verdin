//! AI actions for the admin (the `ai` feature with `[ai]` configured). Each returns
//! suggestions; none writes content.

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::{get, post};
use serde::Deserialize;
use serde_json::{Map, Value as Json, json};
use verdin_auth::{AdminPrincipal, Grant, actions};
use verdin_query::Status;
use verdin_schema::AttributeKind;

use super::{AdminState, ApiResult, admin_query, body, data, ensure_owner, principal};
use crate::ai::{Ai, Part};
use crate::error::ApiError;

/// Longest text sent for summaries and SEO suggestions, in characters.
const MAX_TEXT: usize = 40_000;

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/ai", get(status))
        .route("/ai/translate", post(translate))
        .route("/ai/alt-text", post(alt_text))
        .route("/ai/summarize", post(summarize))
        .route("/ai/seo", post(seo))
}

/// The AI service, once the admin may use it now.
async fn ai<'a>(
    state: &'a AdminState,
    headers: &HeaderMap,
) -> Result<(&'a Ai, AdminPrincipal), ApiError> {
    let ai = state.config.ai.as_ref().ok_or(ApiError::NotFound)?;
    let principal = principal(state, headers).await?;
    if !ai.allow(principal.user.id) {
        return Err(ApiError::TooManyRequests);
    }
    Ok((ai, principal))
}

fn failed(message: String) -> ApiError {
    ApiError::BadRequest(format!("the AI provider failed: {message}"))
}

/// `{ enabled, provider, model }`, for the admin to show the actions.
async fn status(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    principal(&state, &headers).await?;
    Ok(data(match &state.config.ai {
        Some(ai) => json!({ "enabled": true, "provider": ai.provider(), "model": ai.model() }),
        None => json!({ "enabled": false }),
    }))
}

/// The draft of an entry the admin may read (in `locale`), as the admin API returns it.
async fn readable_draft(
    state: &AdminState,
    principal: &AdminPrincipal,
    uid: &str,
    document_id: &str,
    locale: Option<&str>,
    action: &str,
) -> Result<Json, ApiError> {
    let model = state.service.registry().get(uid)?;
    let mut scoped = state.clone();
    scoped.service = state.service.in_locale(locale.map(str::to_owned));
    let code = scoped.service.locale_of(model)?;
    let grant = principal.permissions.content_in(
        action,
        uid,
        model.content_type.localized.then_some(code.as_str()),
    );
    if grant == Grant::None {
        return Err(ApiError::Forbidden);
    }
    ensure_owner(state, uid, document_id, principal, grant).await?;
    let mut query = admin_query(&scoped, uid, Some("populate=*"), principal, grant)?;
    query.status = Status::Draft;
    scoped.service.find_one(uid, document_id, &query).await?.ok_or(ApiError::NotFound)
}

/// The human-readable attributes of an entry: text, rich text, blocks, components.
fn text_fields(
    state: &AdminState,
    uid: &str,
    entry: &Json,
    only: Option<&[String]>,
) -> Map<String, Json> {
    let Ok(model) = state.service.registry().get(uid) else { return Map::new() };
    model
        .content_type
        .attributes
        .iter()
        .filter(|(name, attribute)| {
            only.is_none_or(|only| only.contains(name))
                && !attribute.private
                && matches!(
                    attribute.kind,
                    AttributeKind::String { .. }
                        | AttributeKind::Text { .. }
                        | AttributeKind::RichText { .. }
                        | AttributeKind::Blocks
                        | AttributeKind::Component { .. }
                        | AttributeKind::DynamicZone { .. }
                )
        })
        .filter_map(|(name, _)| {
            let value = entry.get(name)?;
            (!value.is_null() && value != "").then(|| (name.clone(), value.clone()))
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TranslateBody {
    uid: String,
    document_id: String,
    from: String,
    to: String,
    /// Attributes to translate (default: every text attribute).
    fields: Option<Vec<String>>,
}

/// `{ fields }`: the entry's text attributes translated from one locale to another.
async fn translate(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let (ai, principal) = ai(&state, &headers).await?;
    let input: TranslateBody = body(&bytes)?;
    let model = state.service.registry().get(&input.uid)?;
    if !model.content_type.localized {
        return Err(ApiError::BadRequest(format!("`{}` is not localized", input.uid)));
    }
    let known = |code: &str| state.service.locales().contains(code);
    if !known(&input.from) || !known(&input.to) || input.from == input.to {
        return Err(ApiError::BadRequest("`from` and `to` are two different locales".into()));
    }
    // The translation is for editing the target locale.
    if principal.permissions.content_in(actions::CONTENT_UPDATE, &input.uid, Some(&input.to))
        == Grant::None
    {
        return Err(ApiError::Forbidden);
    }
    let entry = readable_draft(
        &state,
        &principal,
        &input.uid,
        &input.document_id,
        Some(&input.from),
        actions::CONTENT_READ,
    )
    .await?;
    let fields = text_fields(&state, &input.uid, &entry, input.fields.as_deref());
    if fields.is_empty() {
        return Ok(data(json!({ "fields": {} })));
    }
    let language = |code: &str| {
        state
            .service
            .locales()
            .name_of(code)
            .map_or_else(|| code.to_owned(), |name| format!("{name} ({code})"))
    };
    let system = format!(
        "You translate content of a CMS from {} to {}. The input is a JSON object of fields. \
         Translate only human-readable text. Keep Markdown, HTML, URLs, JSON structure, keys, \
         `id`, `documentId` and `__component` values, and block `type`s unchanged. Answer with \
         the same object, translated.",
        language(&input.from),
        language(&input.to)
    );
    let answer = ai
        .complete_json(&system, vec![Part::Text(Json::Object(fields.clone()).to_string())])
        .await
        .map_err(failed)?;
    let translated: Map<String, Json> = answer
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(name, _)| fields.contains_key(*name))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    Ok(data(json!({ "fields": translated })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AltTextBody {
    file_id: i64,
    /// Language of the text (default: the default locale).
    locale: Option<String>,
}

/// `{ alternativeText, caption }` for an image of the media library.
async fn alt_text(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let (ai, principal) = ai(&state, &headers).await?;
    let input: AltTextBody = body(&bytes)?;
    if principal.permissions.media(actions::MEDIA_UPDATE) == Grant::None {
        return Err(ApiError::Forbidden);
    }
    let upload = state.config.upload.as_ref().ok_or(ApiError::NotFound)?;
    let file =
        upload.find(input.file_id).await.map_err(|error| ApiError::Internal(error.to_string()))?;
    let file = file.ok_or(ApiError::NotFound)?;
    if principal.permissions.media(actions::MEDIA_UPDATE) == Grant::Own
        && file.created_by != Some(principal.user.id)
    {
        return Err(ApiError::Forbidden);
    }
    if !matches!(file.mime.as_str(), "image/jpeg" | "image/png" | "image/webp" | "image/gif") {
        return Err(ApiError::BadRequest(
            "alt text is written for JPEG, PNG, WebP and GIF images".into(),
        ));
    }
    // The smallest good rendering: `small` or `medium`, else the original.
    let name = ["small", "medium"]
        .iter()
        .find_map(|format| {
            let format = file.formats.as_ref()?.get(*format)?;
            Some(format!("{}{}", format.get("hash")?.as_str()?, format.get("ext")?.as_str()?))
        })
        .unwrap_or_else(|| format!("{}{}", file.hash, file.ext));
    let image = upload
        .storage()
        .get(&name)
        .await
        .map_err(|error| ApiError::Internal(format!("reading the image: {error}")))?;
    if image.len() > 5 * 1024 * 1024 {
        return Err(ApiError::BadRequest("the image is too large to describe".into()));
    }
    let code = input.locale.unwrap_or_else(|| state.service.locales().default_code());
    let language = state.service.locales().name_of(&code).unwrap_or(code.clone());
    let system = format!(
        "You write alternative text for images on websites, in {language}. `alternativeText`: \
         what the image shows that matters to someone who cannot see it, at most 125 \
         characters, no \"image of\". `caption`: one short sentence that could appear under it."
    );
    let answer = ai
        .complete_json(
            &system,
            vec![
                Part::Image { mime: file.mime.clone(), bytes: image.to_vec() },
                Part::Text(format!("File name: {}", file.name)),
            ],
        )
        .await
        .map_err(failed)?;
    Ok(data(json!({
        "alternativeText": answer.get("alternativeText").and_then(Json::as_str).unwrap_or_default(),
        "caption": answer.get("caption").and_then(Json::as_str).unwrap_or_default(),
    })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SummarizeBody {
    text: String,
    locale: Option<String>,
    max_words: Option<u32>,
}

async fn summarize(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let (ai, _) = ai(&state, &headers).await?;
    let input: SummarizeBody = body(&bytes)?;
    if input.text.trim().is_empty() || input.text.chars().count() > MAX_TEXT {
        return Err(ApiError::BadRequest(format!("send 1 to {MAX_TEXT} characters of text")));
    }
    let words = input.max_words.unwrap_or(60).clamp(10, 500);
    let language = input.locale.as_deref().map_or("the language of the text".to_owned(), |code| {
        state.service.locales().name_of(code).unwrap_or_else(|| code.to_owned())
    });
    let system = format!(
        "You summarize content for a CMS, in {language}, in at most {words} words, as plain \
         text in a `summary` field."
    );
    let answer = ai.complete_json(&system, vec![Part::Text(input.text)]).await.map_err(failed)?;
    Ok(data(json!({ "summary": answer.get("summary").and_then(Json::as_str).unwrap_or_default() })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SeoBody {
    uid: String,
    document_id: String,
    locale: Option<String>,
}

/// `{ metaTitle, metaDescription, keywords }` for an entry.
async fn seo(State(state): State<AdminState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    let (ai, principal) = ai(&state, &headers).await?;
    let input: SeoBody = body(&bytes)?;
    let entry = readable_draft(
        &state,
        &principal,
        &input.uid,
        &input.document_id,
        input.locale.as_deref(),
        actions::CONTENT_READ,
    )
    .await?;
    let fields = text_fields(&state, &input.uid, &entry, None);
    let text: String = Json::Object(fields).to_string().chars().take(MAX_TEXT).collect();
    let language =
        input.locale.as_deref().map_or("the language of the content".to_owned(), |code| {
            state.service.locales().name_of(code).unwrap_or_else(|| code.to_owned())
        });
    let system = format!(
        "You suggest SEO metadata for a web page from its CMS fields (JSON), in {language}: \
         `metaTitle` (at most 60 characters), `metaDescription` (at most 160 characters) and \
         `keywords` (a list of up to 8)."
    );
    let answer = ai.complete_json(&system, vec![Part::Text(text)]).await.map_err(failed)?;
    let keywords: Vec<&str> = answer
        .get("keywords")
        .and_then(Json::as_array)
        .map(|items| items.iter().filter_map(Json::as_str).take(8).collect())
        .unwrap_or_default();
    Ok(data(json!({
        "metaTitle": answer.get("metaTitle").and_then(Json::as_str).unwrap_or_default(),
        "metaDescription": answer.get("metaDescription").and_then(Json::as_str).unwrap_or_default(),
        "keywords": keywords,
    })))
}
