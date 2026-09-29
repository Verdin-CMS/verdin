//! A sample Verdin plugin: a `beforeCreate` hook, an `afterCreate` hook, routes, a job.

use extism_pdk::*;
use serde_json::{Value, json};

#[host_fn]
extern "ExtismHost" {
    fn verdin_log(input: Json<Value>);
    fn verdin_content(input: Json<Value>) -> Json<Value>;
    fn verdin_kv_get(key: String) -> Json<Value>;
    fn verdin_kv_set(input: Json<Value>);
    fn verdin_config() -> Json<Value>;
}

fn slug(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// `{ uid, event, documentId, data }` → `{ data }` (replace), `{ error }` or `{}`.
#[plugin_fn]
pub fn before_write(Json(input): Json<Value>) -> FnResult<Json<Value>> {
    let mut data = input["data"].clone();
    if data["title"] == "forbidden" {
        return Ok(Json(json!({ "error": "this title is not allowed" })));
    }
    if let Some(title) = data["title"].as_str()
        && data.get("slug").is_none_or(Value::is_null)
    {
        data["slug"] = json!(slug(title));
        return Ok(Json(json!({ "data": data })));
    }
    Ok(Json(json!({})))
}

#[plugin_fn]
pub fn after_write(Json(input): Json<Value>) -> FnResult<()> {
    unsafe {
        verdin_log(Json(json!({ "level": "info", "message": format!("{} {}", input["event"].as_str().unwrap_or_default(), input["documentId"].as_str().unwrap_or_default()) })))?;
        verdin_kv_set(Json(json!({ "key": "last", "value": input["documentId"] })))?;
    }
    Ok(())
}

/// `{ method, path, query, body, actor }` → `{ status, body }`.
#[plugin_fn]
pub fn handle(Json(request): Json<Value>) -> FnResult<Json<Value>> {
    let path = request["path"].as_str().unwrap_or_default();
    let response = match path {
        "/hello" => {
            let last = unsafe { verdin_kv_get("last".into())? }.0;
            let ticks = unsafe { verdin_kv_get("ticks".into())? }.0;
            let config = unsafe { verdin_config()? }.0;
            json!({ "status": 200, "body": {
                "message": format!("hello {}", config["greeting"].as_str().unwrap_or("world")),
                "last": last, "ticks": ticks, "actor": request["actor"],
            } })
        }
        "/titles" => {
            let found = unsafe {
                verdin_content(Json(json!({ "op": "findMany", "uid": "api::article", "query": { "sort": "title" } })))?
            }
            .0;
            if let Some(error) = found.get("error") {
                return Ok(Json(json!({ "status": 403, "body": { "error": error } })));
            }
            let titles: Vec<Value> = found["documents"]
                .as_array()
                .map(|docs| docs.iter().map(|doc| doc["title"].clone()).collect())
                .unwrap_or_default();
            json!({ "status": 200, "body": { "titles": titles } })
        }
        "/write" => {
            let created = unsafe {
                verdin_content(Json(json!({ "op": "create", "uid": "api::tag", "data": { "label": "from plugin" } })))?
            }
            .0;
            json!({ "status": if created.get("error").is_some() { 403 } else { 201 }, "body": created })
        }
        "/panic" => panic!("boom"),
        "/loop" => loop {
            std::hint::spin_loop();
        },
        _ => json!({ "status": 404, "body": { "error": "not found" } }),
    };
    Ok(Json(response))
}

#[plugin_fn]
pub fn tick(Json(_): Json<Value>) -> FnResult<()> {
    let current = unsafe { verdin_kv_get("ticks".into())? }.0.as_i64().unwrap_or(0);
    unsafe { verdin_kv_set(Json(json!({ "key": "ticks", "value": current + 1 })))? };
    Ok(())
}
