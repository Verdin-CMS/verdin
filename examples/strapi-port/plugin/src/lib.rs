//! `tienda`: the custom code of a Strapi shop, ported to a Verdin plugin.
//!
//! | Strapi                                  | Here                     |
//! |-----------------------------------------|--------------------------|
//! | `reserva` lifecycle `beforeCreate`      | `before_create_reserva`  |
//! | `reserva` lifecycle `afterCreate`       | `after_create_reserva`   |
//! | poll routes and controller              | `handle`                 |
//! | `config/cron-tasks.js`                  | `close_polls`            |
//! | `bootstrap()` in `src/index.js`         | `startup`                |
//!
//! Services become plain Rust functions below, and `strapi.documents(...)` calls become
//! `verdin_content` host calls.

use extism_pdk::*;
use serde_json::{Value, json};

#[host_fn]
extern "ExtismHost" {
    fn verdin_log(input: Json<Value>);
    fn verdin_content(input: Json<Value>) -> Json<Value>;
    fn verdin_config() -> Json<Value>;
    fn verdin_public_permissions(input: Json<Value>) -> Json<Value>;
}

const PRODUCTO: &str = "api::producto";
const ENCUESTA: &str = "api::encuesta";
const VOTO: &str = "api::voto";

// ---------------------------------------------------------------------------------------
// Host helpers (what `strapi.documents(uid)` and `strapi.log` were).
// ---------------------------------------------------------------------------------------

fn content(request: Value) -> Result<Value, Error> {
    Ok(unsafe { verdin_content(Json(request))? }.0)
}

fn log(level: &str, message: impl Into<String>) {
    let _ = unsafe { verdin_log(Json(json!({ "level": level, "message": message.into() }))) };
}

fn settings() -> Value {
    unsafe { verdin_config() }.map(|config| config.0).unwrap_or(Value::Null)
}

/// `documents` of a `findMany`, or the host's error.
fn find_many(uid: &str, query: Value) -> Result<Result<Vec<Value>, String>, Error> {
    let found = content(json!({ "op": "findMany", "uid": uid, "query": query }))?;
    if let Some(error) = found["error"].as_str() {
        return Ok(Err(error.to_owned()));
    }
    Ok(Ok(found["documents"].as_array().cloned().unwrap_or_default()))
}

/// How many documents match `filters` (asks for one row and reads the total).
fn count(uid: &str, filters: Value) -> Result<Result<u64, String>, Error> {
    let query = json!({ "filters": filters, "fields": ["documentId"], "pagination": { "pageSize": 1, "withCount": true } });
    let found = content(json!({ "op": "findMany", "uid": uid, "query": query }))?;
    if let Some(error) = found["error"].as_str() {
        return Ok(Err(error.to_owned()));
    }
    Ok(Ok(found["meta"]["pagination"]["total"].as_u64().unwrap_or(0)))
}

// ---------------------------------------------------------------------------------------
// Lifecycles → hooks.
// ---------------------------------------------------------------------------------------

/// The documentId in any Strapi v5 relation input: `"id"`, `{ documentId }`, a list, or
/// `{ connect }` / `{ set }` (the first item).
fn relation_id(value: &Value) -> Option<String> {
    match value {
        Value::String(id) if !id.is_empty() => Some(id.clone()),
        Value::Array(items) => items.iter().find_map(relation_id),
        Value::Object(object) => {
            if let Some(id) = object.get("documentId") {
                return relation_id(id);
            }
            object.get("set").or_else(|| object.get("connect")).and_then(relation_id)
        }
        _ => None,
    }
}

/// A number from a JSON number or a numeric string.
fn as_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

/// `beforeCreate` on `api::reserva` (Strapi's lifecycle did the same):
/// - a new reservation is always `pendiente`, whatever the client sent;
/// - the product must exist, be `a_la_venta` and `reservable`;
/// - `unidades` is clamped to 1…`maxUnidades` (10 by default).
///
/// Input `{ event, uid, documentId, locale, data }`; `{ data }` replaces what is written,
/// `{ error }` refuses the write with a 400.
#[plugin_fn]
pub fn before_create_reserva(Json(input): Json<Value>) -> FnResult<Json<Value>> {
    let mut data = input["data"].clone();
    if !data.is_object() {
        return Ok(Json(json!({})));
    }

    data["estado"] = json!("pendiente");

    let Some(producto_id) = relation_id(&data["producto"]) else {
        return Ok(Json(json!({ "error": "Choose a product to reserve" })));
    };
    let found = content(json!({ "op": "findOne", "uid": PRODUCTO, "documentId": producto_id }))?;
    if let Some(error) = found["error"].as_str() {
        log("error", format!("reading product {producto_id}: {error}"));
        return Ok(Json(json!({ "error": "The product could not be checked" })));
    }
    let producto = &found["document"];
    if producto.is_null() {
        return Ok(Json(json!({ "error": "The product does not exist or is not published" })));
    }
    if producto["a_la_venta"] != true {
        return Ok(Json(json!({ "error": "The product is not on sale" })));
    }
    if producto["reservable"] != true {
        return Ok(Json(json!({ "error": "The product cannot be reserved" })));
    }

    let max = settings()["maxUnidades"].as_i64().unwrap_or(10).max(1);
    let unidades = as_number(&data["unidades"]).map_or(1, |n| n.round() as i64);
    data["unidades"] = json!(unidades.clamp(1, max));

    Ok(Json(json!({ "data": data })))
}

/// `afterCreate` on `api::reserva`: a line in the plugin's log. Safe because this plugin
/// never writes reservations (a write by the plugin to a type it has after hooks on would
/// wait for the plugin's own instance, which that write is holding).
#[plugin_fn]
pub fn after_create_reserva(Json(input): Json<Value>) -> FnResult<()> {
    log("info", format!("new reservation {}", input["documentId"].as_str().unwrap_or("?")));
    Ok(())
}

// ---------------------------------------------------------------------------------------
// Custom routes and controllers → the route function.
// ---------------------------------------------------------------------------------------

/// A Strapi-shaped answer: `{ data }`.
fn ok(status: u16, data: Value) -> Value {
    json!({ "status": status, "body": { "data": data } })
}

/// A Strapi-shaped error: `{ data: null, error: { status, name, message, details } }`.
fn fail(status: u16, message: &str) -> Value {
    let name = match status {
        400 => "ValidationError",
        403 => "ForbiddenError",
        404 => "NotFoundError",
        405 => "MethodNotAllowedError",
        409 => "ConflictError",
        _ => "ApplicationError",
    };
    json!({ "status": status, "body": { "data": null, "error": {
        "status": status, "name": name, "message": message, "details": {}
    } } })
}

/// Routes, under `/api/plugins/tienda`:
/// - `GET /polls`: open polls with their vote totals (the admin widget uses it);
/// - `POST /polls/:slug/vote` with `{ option, fingerprint }` (or `{ data: { … } }`);
/// - `GET /polls/:slug/results`.
///
/// Input `{ method, path, query, headers, body, actor }` → `{ status, headers?, body }`.
#[plugin_fn]
pub fn handle(Json(request): Json<Value>) -> FnResult<Json<Value>> {
    let method = request["method"].as_str().unwrap_or_default();
    let path = request["path"].as_str().unwrap_or_default();
    let segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let response = match (method, segments.as_slice()) {
        ("GET", ["polls"]) => open_polls()?,
        ("POST", ["polls", slug, "vote"]) => vote(slug, &request)?,
        ("GET", ["polls", slug, "results"]) => results(slug)?,
        (_, ["polls"] | ["polls", _, "vote" | "results"]) => fail(405, "Method not allowed"),
        _ => fail(404, "Not Found"),
    };
    Ok(Json(response))
}

/// The published poll with this slug.
fn poll_by_slug(slug: &str) -> Result<Result<Option<Value>, String>, Error> {
    let query = json!({ "filters": { "slug": { "$eq": slug } }, "pagination": { "pageSize": 1 } });
    Ok(find_many(ENCUESTA, query)?.map(|polls| polls.into_iter().next()))
}

fn options_of(poll: &Value) -> Vec<String> {
    poll["opciones"]
        .as_array()
        .map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

/// A browser fingerprint made by the site (a hash, a random id kept in local storage…).
/// Plugin routes do not see the client's address, so the client has to send it.
fn valid_fingerprint(text: &str) -> bool {
    (8..=128).contains(&text.len())
        && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn vote(slug: &str, request: &Value) -> Result<Value, Error> {
    let body: Value =
        serde_json::from_str(request["body"].as_str().unwrap_or_default()).unwrap_or(Value::Null);
    let input = if body["data"].is_object() { &body["data"] } else { &body };
    let (Some(option), Some(fingerprint)) =
        (input["option"].as_str(), input["fingerprint"].as_str())
    else {
        return Ok(fail(400, "Send { option, fingerprint }"));
    };
    if !valid_fingerprint(fingerprint) {
        return Ok(fail(400, "fingerprint must be 8 to 128 letters, digits, - or _"));
    }

    let poll = match poll_by_slug(slug)? {
        Ok(Some(poll)) => poll,
        Ok(None) => return Ok(fail(404, "Poll not found")),
        Err(error) => {
            log("error", format!("reading poll {slug}: {error}"));
            return Ok(fail(500, "The poll could not be read"));
        }
    };
    if poll["estado"] != "abierta" {
        return Ok(fail(403, "This poll is closed"));
    }
    if !options_of(&poll).iter().any(|choice| choice == option) {
        return Ok(fail(400, "That is not one of the poll's options"));
    }

    // One vote per fingerprint and poll. Calls to a plugin run one at a time on each
    // instance, so this check and the create below cannot interleave there; with several
    // instances, the unique `clave` field is what stops a duplicate. (Plugin queries
    // cannot filter on `private` attributes, like the REST API, so `clave` is not private;
    // the public role has no access to votes.)
    let poll_id = poll["documentId"].as_str().unwrap_or_default();
    let clave = format!("{poll_id}:{fingerprint}");
    match count(VOTO, json!({ "clave": { "$eq": clave } }))? {
        Ok(0) => {}
        Ok(_) => return Ok(fail(409, "You have already voted in this poll")),
        Err(error) => {
            log("error", format!("counting votes: {error}"));
            return Ok(fail(500, "The vote could not be saved"));
        }
    }
    let created = content(json!({ "op": "create", "uid": VOTO, "data": {
        "encuesta": poll_id,
        "opcion": option,
        "fingerprint": fingerprint,
        "clave": clave,
    } }))?;
    if let Some(error) = created["error"].as_str() {
        if error.contains("unique") {
            return Ok(fail(409, "You have already voted in this poll"));
        }
        log("error", format!("saving a vote: {error}"));
        return Ok(fail(500, "The vote could not be saved"));
    }

    let mut answer = results(slug)?;
    answer["status"] = json!(201);
    Ok(answer)
}

/// Votes per option of a poll.
fn tally(poll: &Value) -> Result<Result<(Vec<Value>, u64), String>, Error> {
    let poll_id = poll["documentId"].as_str().unwrap_or_default();
    let mut rows = Vec::new();
    let mut total = 0;
    for option in options_of(poll) {
        let filters = json!({
            "encuesta": { "documentId": { "$eq": poll_id } },
            "opcion": { "$eq": option },
        });
        let votes = match count(VOTO, filters)? {
            Ok(votes) => votes,
            Err(error) => return Ok(Err(error)),
        };
        total += votes;
        rows.push(json!({ "option": option, "votes": votes }));
    }
    Ok(Ok((rows, total)))
}

fn results(slug: &str) -> Result<Value, Error> {
    let poll = match poll_by_slug(slug)? {
        Ok(Some(poll)) => poll,
        Ok(None) => return Ok(fail(404, "Poll not found")),
        Err(error) => {
            log("error", format!("reading poll {slug}: {error}"));
            return Ok(fail(500, "The poll could not be read"));
        }
    };
    let (rows, total) = match tally(&poll)? {
        Ok(tally) => tally,
        Err(error) => {
            log("error", format!("counting votes: {error}"));
            return Ok(fail(500, "The results could not be read"));
        }
    };
    Ok(ok(
        200,
        json!({
            "slug": poll["slug"],
            "titulo": poll["titulo"],
            "estado": poll["estado"],
            "total": total,
            "results": rows,
        }),
    ))
}

fn open_polls() -> Result<Value, Error> {
    let query = json!({
        "filters": { "estado": { "$eq": "abierta" } },
        "sort": ["titulo"],
        "pagination": { "pageSize": 20 },
    });
    let polls = match find_many(ENCUESTA, query)? {
        Ok(polls) => polls,
        Err(error) => {
            log("error", format!("listing polls: {error}"));
            return Ok(fail(500, "The polls could not be read"));
        }
    };
    let mut list = Vec::new();
    for poll in &polls {
        let total = match tally(poll)? {
            Ok((_, total)) => total,
            Err(error) => return Ok(fail(500, &error)),
        };
        list.push(json!({ "slug": poll["slug"], "titulo": poll["titulo"], "total": total }));
    }
    Ok(ok(200, json!(list)))
}

// ---------------------------------------------------------------------------------------
// Cron tasks → jobs.
// ---------------------------------------------------------------------------------------

/// Every 15 minutes: closes open polls whose `cierra_el` has passed. Input
/// `{ scheduledAt }` (the module has no clock without WASI, so that is "now").
#[plugin_fn]
pub fn close_polls(Json(input): Json<Value>) -> FnResult<()> {
    let Some(now) = input["scheduledAt"].as_str() else { return Ok(()) };
    let query = json!({
        "filters": { "estado": { "$eq": "abierta" }, "cierra_el": { "$lt": now } },
        "fields": ["documentId"],
        "pagination": { "pageSize": 100 },
    });
    let polls = match find_many(ENCUESTA, query)? {
        Ok(polls) => polls,
        Err(error) => {
            log("error", format!("close_polls: {error}"));
            return Ok(());
        }
    };
    for poll in polls {
        let id = poll["documentId"].as_str().unwrap_or_default();
        let updated = content(
            json!({ "op": "update", "uid": ENCUESTA, "documentId": id, "data": { "estado": "cerrada" } }),
        )?;
        match updated["error"].as_str() {
            Some(error) => log("error", format!("closing poll {id}: {error}")),
            None => log("info", format!("closed poll {id}")),
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------
// bootstrap() → the startup function.
// ---------------------------------------------------------------------------------------

/// Runs when the server starts with the plugin on, when it is switched on and when its
/// settings change (`{ reason: start | enabled | settings }`), so it must be safe to run
/// again. Replaces the public role's permissions with exactly what the site needs.
#[plugin_fn]
pub fn startup(Json(input): Json<Value>) -> FnResult<Json<Value>> {
    let reason = input["reason"].as_str().unwrap_or("start");
    if settings()["lockPublicRole"] == false {
        log("info", format!("startup ({reason}): public role left as it is"));
        return Ok(Json(json!({})));
    }
    let permissions = json!([
        { "subject": PRODUCTO, "action": "find" },
        { "subject": PRODUCTO, "action": "findOne" },
        { "subject": ENCUESTA, "action": "find" },
        { "subject": ENCUESTA, "action": "findOne" },
        { "subject": "api::reserva", "action": "create" },
    ]);
    let result = unsafe {
        verdin_public_permissions(Json(json!({ "op": "set", "permissions": permissions })))?
    }
    .0;
    if let Some(error) = result["error"].as_str() {
        // Logged by Verdin in the plugin's log and counted as a failed startup.
        return Ok(Json(json!({ "error": format!("public permissions: {error}") })));
    }
    log("info", format!("startup ({reason}): public role reset"));
    Ok(Json(json!({})))
}
