//! Public routes of the site features, under the API prefix: `/_redirects`,
//! `/_menus/{slug}`, `/_forms/{slug}` (definition and submissions), and the sitemap.

use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::{Map, Value as Json, json};
use verdin_content::DocumentService;

use crate::client::ClientIp;
use crate::error::ApiError;
use crate::limiter::RateLimiter;
use crate::site::{MAX_SUBMISSION, SeoSettings, Site, check_submission};

/// What the site routes are built with; each part is on when its feature is.
#[derive(Clone)]
pub struct SiteServices {
    pub site: Site,
    pub seo: Option<SeoSettings>,
    pub redirects: bool,
    pub menus: bool,
    pub forms: bool,
    /// Form notifications.
    pub mailer: Option<verdin_email::Mailer>,
    /// Where submissions are seen (`https://cms.example.com/admin`).
    pub admin_url: Option<String>,
}

#[derive(Clone)]
struct RouteState {
    services: SiteServices,
    service: DocumentService,
    limiter: Arc<RateLimiter>,
}

pub(crate) fn routes(services: SiteServices, service: DocumentService) -> Router {
    let state = RouteState {
        services,
        service,
        limiter: Arc::new(RateLimiter::new(10, Duration::from_secs(60))),
    };
    Router::new()
        .route("/_redirects", get(redirects))
        .route("/_menus/{slug}", get(menu))
        .route("/_forms/{slug}", get(form).post(submit))
        .with_state(state)
}

/// `GET /sitemap.xml` (the `seo` feature with a base URL). Built at most every ten
/// minutes; concurrent requests wait for the one building it.
pub fn sitemap_router(service: DocumentService, seo: SeoSettings) -> Router {
    let built: Arc<tokio::sync::Mutex<Option<(Instant, String)>>> = Arc::default();
    Router::new().route(
        "/sitemap.xml",
        get(move || {
            let (service, seo, built) = (service.clone(), seo.clone(), built.clone());
            async move {
                let mut built = built.lock().await;
                let xml = match &*built {
                    Some((at, xml)) if at.elapsed() < SITEMAP_TTL => xml.clone(),
                    _ => match crate::site::sitemap(&service, &seo).await {
                        Ok(xml) => {
                            *built = Some((Instant::now(), xml.clone()));
                            xml
                        }
                        Err(error) => return error.into_response(),
                    },
                };
                (
                    [
                        (
                            header::CONTENT_TYPE,
                            HeaderValue::from_static("application/xml; charset=utf-8"),
                        ),
                        (header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=600")),
                    ],
                    xml,
                )
                    .into_response()
            }
        }),
    )
}

const SITEMAP_TTL: Duration = Duration::from_secs(600);

fn cached(value: Json, seconds: u32) -> Response {
    let mut response = axum::Json(json!({ "data": value })).into_response();
    if let Ok(value) = HeaderValue::from_str(&format!("public, max-age={seconds}")) {
        response.headers_mut().insert(header::CACHE_CONTROL, value);
    }
    response
}

async fn redirects(State(state): State<RouteState>) -> Result<Response, ApiError> {
    if !state.services.redirects {
        return Err(ApiError::NotFound);
    }
    let list: Vec<Json> = state
        .services
        .site
        .redirects()
        .await?
        .into_iter()
        .map(|redirect| json!({ "source": redirect.source, "destination": redirect.destination, "status": redirect.status }))
        .collect();
    Ok(cached(Json::Array(list), 60))
}

async fn menu(
    State(state): State<RouteState>,
    Path(slug): Path<String>,
    RawQuery(raw): RawQuery,
) -> Result<Response, ApiError> {
    if !state.services.menus {
        return Err(ApiError::NotFound);
    }
    let menu = state.services.site.menu_by_slug(&slug).await?.ok_or(ApiError::NotFound)?;
    let locale = crate::handlers::locale_param(raw.as_deref())?;
    let seo = state.services.seo.clone().unwrap_or_default();
    let resolved =
        state.services.site.resolved_menu(&menu, &state.service, &seo, locale.as_deref()).await?;
    Ok(cached(resolved, 60))
}

async fn form(
    State(state): State<RouteState>,
    Path(slug): Path<String>,
) -> Result<Response, ApiError> {
    if !state.services.forms {
        return Err(ApiError::NotFound);
    }
    let form = state.services.site.form_by_slug(&slug).await?.ok_or(ApiError::NotFound)?;
    Ok(cached(
        json!({
            "slug": form.slug,
            "name": form.name,
            "fields": form.fields,
            "honeypot": form.settings.honeypot.then_some("_gotcha"),
        }),
        60,
    ))
}

/// `POST /_forms/{slug}`: JSON (`{ data: {...} }` or the fields) or a form post.
async fn submit(
    State(state): State<RouteState>,
    Path(slug): Path<String>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Response, ApiError> {
    if !state.services.forms {
        return Err(ApiError::NotFound);
    }
    let form = state.services.site.form_by_slug(&slug).await?.ok_or(ApiError::NotFound)?;
    if !state.limiter.allow(&format!("{slug}:{ip}")) {
        return Err(ApiError::TooManyRequests);
    }
    if bytes.len() > MAX_SUBMISSION {
        return Err(ApiError::PayloadTooLarge(format!(
            "submissions are at most {MAX_SUBMISSION} bytes"
        )));
    }
    let content_type =
        headers.get(header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or_default();
    let input: Map<String, Json> = if content_type.starts_with("application/x-www-form-urlencoded")
    {
        url::form_urlencoded::parse(&bytes)
            .map(|(key, value)| (key.into_owned(), Json::String(value.into_owned())))
            .collect()
    } else {
        let value: Json = serde_json::from_slice(&bytes)
            .map_err(|_| ApiError::BadRequest("send JSON or a form post".into()))?;
        match value.get("data").cloned().unwrap_or(value) {
            Json::Object(map) => map,
            _ => return Err(ApiError::BadRequest("send the fields as an object".into())),
        }
    };
    let accepted = || {
        let message = form.settings.success_message.clone().unwrap_or_else(|| "Thank you!".into());
        (StatusCode::CREATED, axum::Json(json!({ "data": { "message": message } }))).into_response()
    };
    // Bots fill every field: pretend it worked.
    if form.settings.honeypot
        && input
            .get("_gotcha")
            .is_some_and(|value| value.as_str().is_some_and(|text| !text.is_empty()))
    {
        return Ok(accepted());
    }
    let data = match check_submission(&form, &input) {
        Ok(data) => Json::Object(data),
        Err(errors) => {
            let body = json!({
                "data": null,
                "error": {
                    "status": 400,
                    "name": "ValidationError",
                    "message": "the submission is not valid",
                    "details": { "errors": errors },
                },
            });
            return Ok((StatusCode::BAD_REQUEST, axum::Json(body)).into_response());
        }
    };
    let agent =
        headers.get(header::USER_AGENT).and_then(|value| value.to_str().ok()).unwrap_or_default();
    // IPs are kept as a keyed hash: enough to spot floods, not to track people.
    let meta = json!({
        "ip": verdin_auth::crypto::sha256_hex(&format!("verdin-form:{ip}"))[..16].to_owned(),
        "userAgent": agent.chars().take(255).collect::<String>(),
    });
    let id = state.services.site.add_submission(form.id, data.clone(), meta).await?;
    if let Some(mailer) = &state.services.mailer {
        let lines: Vec<String> = data
            .as_object()
            .into_iter()
            .flatten()
            .map(|(key, value)| {
                format!(
                    "{key}: {}",
                    value.as_str().map_or_else(|| value.to_string(), str::to_owned)
                )
            })
            .collect();
        let link = state
            .services
            .admin_url
            .as_deref()
            .map(|admin| format!("\n\nAll submissions: {admin}/settings/forms/{}", form.id))
            .unwrap_or_default();
        for to in &form.settings.notify_emails {
            let message = verdin_email::Message {
                to: to.clone(),
                subject: format!("New submission: {}", form.name),
                text: format!("Submission #{id} to {}:\n\n{}{link}\n", form.name, lines.join("\n")),
                html: None,
            };
            if let Err(error) = mailer.send(&message).await {
                tracing::warn!(%error, form = %form.slug, "could not send the form notification");
            }
        }
    }
    Ok(accepted())
}
