//! Redirects, menus and forms (`site.manage`), and the SEO component template.

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use serde::Deserialize;
use serde_json::{Value, json};
use verdin_auth::actions;

use super::{AdminState, ApiResult, PageQuery as ListPage, body, data, paged, require};
use crate::error::ApiError;
use crate::site::{FormField, FormSettings, Site};

pub(super) fn routes() -> Router<AdminState> {
    Router::new()
        .route("/site/seo/component", get(seo_component))
        .route("/site/redirects", get(redirects).post(create_redirect))
        .route("/site/redirects/{id}", axum::routing::put(update_redirect).delete(delete_redirect))
        .route("/site/menus", get(menus).post(create_menu))
        .route("/site/menus/{id}", get(get_menu).put(update_menu).delete(delete_menu))
        .route("/site/forms", get(forms).post(create_form))
        .route("/site/forms/{id}", get(get_form).put(update_form).delete(delete_form))
        .route("/site/forms/{id}/submissions", get(submissions))
        .route("/site/forms/{id}/submissions/export", get(export_submissions))
        .route(
            "/site/forms/{id}/submissions/{submission}",
            axum::routing::delete(delete_submission),
        )
}

async fn site(state: &AdminState, headers: &HeaderMap) -> Result<Site, ApiError> {
    let site = state.config.site.clone().ok_or(ApiError::NotFound)?;
    require(state, headers, actions::SITE_MANAGE).await?;
    Ok(site)
}

/// The suggested `shared.seo` component, to add with the schema builder.
async fn seo_component(State(state): State<AdminState>, headers: HeaderMap) -> ApiResult {
    site(&state, &headers).await?;
    Ok(data(json!({ "category": "shared", "name": "seo", "schema": crate::site::seo_component() })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RedirectBody {
    source: String,
    destination: String,
    #[serde(default = "permanent")]
    status: i64,
}

fn permanent() -> i64 {
    301
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RedirectQuery {
    page: Option<u64>,
    page_size: Option<u64>,
    search: Option<String>,
}

/// `GET /site/redirects?page=&pageSize=&search=`: by source.
async fn redirects(
    State(state): State<AdminState>,
    Query(query): Query<RedirectQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let page = ListPage { page: query.page, page_size: query.page_size };
    let (rows, total) = site(&state, &headers)
        .await?
        .redirects_page(query.search.as_deref(), page.page(), page.size())
        .await?;
    Ok(paged(rows, page, total, json!({})))
}

async fn create_redirect(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let site = site(&state, &headers).await?;
    let input: RedirectBody = body(&bytes)?;
    let redirect =
        site.create_redirect(input.source.trim(), input.destination.trim(), input.status).await?;
    Ok((StatusCode::CREATED, data(redirect)).into_response())
}

async fn update_redirect(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let site = site(&state, &headers).await?;
    let input: RedirectBody = body(&bytes)?;
    Ok(data(
        site.update_redirect(id, input.source.trim(), input.destination.trim(), input.status)
            .await?,
    ))
}

async fn delete_redirect(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    site(&state, &headers).await?.delete_redirect(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MenuBody {
    slug: String,
    name: String,
    #[serde(default = "empty_list")]
    items: Value,
}

fn empty_list() -> Value {
    Value::Array(Vec::new())
}

/// `GET /site/menus?page=&pageSize=`: by name.
async fn menus(
    State(state): State<AdminState>,
    Query(query): Query<ListPage>,
    headers: HeaderMap,
) -> ApiResult {
    let (rows, total) =
        site(&state, &headers).await?.menus_page(query.page(), query.size()).await?;
    Ok(paged(rows, query, total, json!({})))
}

async fn get_menu(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    Ok(data(site(&state, &headers).await?.menu_by_id(id).await?.ok_or(ApiError::NotFound)?))
}

async fn create_menu(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let site = site(&state, &headers).await?;
    let input: MenuBody = body(&bytes)?;
    let menu = site.save_menu(None, &input.slug, &input.name, &input.items, &state.service).await?;
    Ok((StatusCode::CREATED, data(menu)).into_response())
}

async fn update_menu(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let site = site(&state, &headers).await?;
    let input: MenuBody = body(&bytes)?;
    Ok(data(
        site.save_menu(Some(id), &input.slug, &input.name, &input.items, &state.service).await?,
    ))
}

async fn delete_menu(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    site(&state, &headers).await?.delete_menu(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FormBody {
    slug: String,
    name: String,
    fields: Vec<FormField>,
    #[serde(default)]
    settings: FormSettings,
}

/// `GET /site/forms?page=&pageSize=`: by name.
async fn forms(
    State(state): State<AdminState>,
    Query(query): Query<ListPage>,
    headers: HeaderMap,
) -> ApiResult {
    let (rows, total) =
        site(&state, &headers).await?.forms_page(query.page(), query.size()).await?;
    Ok(paged(rows, query, total, json!({})))
}

async fn get_form(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    Ok(data(site(&state, &headers).await?.form_by_id(id).await?.ok_or(ApiError::NotFound)?))
}

async fn create_form(
    State(state): State<AdminState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let site = site(&state, &headers).await?;
    let input: FormBody = body(&bytes)?;
    let form =
        site.save_form(None, &input.slug, &input.name, &input.fields, &input.settings).await?;
    Ok((StatusCode::CREATED, data(form)).into_response())
}

async fn update_form(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    bytes: Bytes,
) -> ApiResult {
    let site = site(&state, &headers).await?;
    let input: FormBody = body(&bytes)?;
    Ok(data(
        site.save_form(Some(id), &input.slug, &input.name, &input.fields, &input.settings).await?,
    ))
}

async fn delete_form(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    site(&state, &headers).await?.delete_form(id).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageQuery {
    page: Option<u64>,
    page_size: Option<u64>,
}

async fn submissions(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    Query(query): Query<PageQuery>,
    headers: HeaderMap,
) -> ApiResult {
    let site = site(&state, &headers).await?;
    site.form_by_id(id).await?.ok_or(ApiError::NotFound)?;
    let (page, page_size) =
        (query.page.unwrap_or(1).max(1), query.page_size.unwrap_or(25).clamp(1, 100));
    let (list, total) = site.submissions(id, page, page_size).await?;
    Ok(axum::Json(json!({
        "data": list,
        "meta": { "pagination": { "page": page, "pageSize": page_size, "total": total, "pageCount": total.div_ceil(page_size) } },
    }))
    .into_response())
}

/// Every submission as CSV, newest first.
async fn export_submissions(
    State(state): State<AdminState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> ApiResult {
    let site = site(&state, &headers).await?;
    let form = site.form_by_id(id).await?.ok_or(ApiError::NotFound)?;
    // Every submission, a page at a time (at most 100,000).
    let mut list = Vec::new();
    for page in 1..=100 {
        let (chunk, total) = site.submissions(id, page, 1000).await?;
        let done = chunk.len() < 1000 || list.len() as u64 + chunk.len() as u64 >= total;
        list.extend(chunk);
        if done {
            break;
        }
    }
    let mut out = String::new();
    let mut header_row = vec!["id".to_owned(), "createdAt".to_owned()];
    header_row.extend(form.fields.iter().map(|field| field.name.clone()));
    super::transfer_admin::write_record(&mut out, header_row.iter().map(String::as_str));
    for submission in &list {
        let mut cells =
            vec![submission.id.to_string(), submission.created_at.clone().unwrap_or_default()];
        for field in &form.fields {
            let value = submission.data.get(&field.name).cloned().unwrap_or(Value::Null);
            let text = match value {
                Value::Null => String::new(),
                Value::String(text) if text.starts_with(['=', '+', '-', '@']) => format!("'{text}"),
                Value::String(text) => text,
                other => other.to_string(),
            };
            cells.push(text);
        }
        super::transfer_admin::write_record(&mut out, cells.iter().map(String::as_str));
    }
    let mut response = out.into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/csv; charset=utf-8"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Ok(value) =
        HeaderValue::from_str(&format!("attachment; filename=\"{}-submissions.csv\"", form.slug))
    {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }
    Ok(response)
}

async fn delete_submission(
    State(state): State<AdminState>,
    Path((id, submission)): Path<(i64, i64)>,
    headers: HeaderMap,
) -> ApiResult {
    site(&state, &headers).await?.delete_submission(id, submission).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
