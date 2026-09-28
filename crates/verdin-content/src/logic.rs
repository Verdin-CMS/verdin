//! The subset of [JSON Logic](https://jsonlogic.com) that Strapi's conditional fields use
//! (`conditions.visible`): `var`, comparisons, `!`, `!!`, `and`, `or`, `in` and `if`.
//! Unknown operators make a condition true, so a field is never hidden by mistake.

use serde_json::Value as Json;

/// Whether an attribute with these `conditions` is visible for `scope` (the other values
/// of the same document or component item).
pub fn visible(conditions: Option<&Json>, scope: &Json) -> bool {
    match conditions.and_then(|conditions| conditions.get("visible")) {
        None => true,
        Some(rule) => truthy(&apply(rule, scope)),
    }
}

fn apply(rule: &Json, data: &Json) -> Json {
    let Json::Object(map) = rule else { return rule.clone() };
    let Some((op, args)) = map.iter().next().filter(|_| map.len() == 1) else {
        return rule.clone();
    };
    let args: Vec<Json> = match args {
        Json::Array(items) => items.clone(),
        other => vec![other.clone()],
    };
    let value = |index: usize| args.get(index).map_or(Json::Null, |arg| apply(arg, data));
    match op.as_str() {
        "var" => {
            let path = value(0);
            let default = value(1);
            let found = match &path {
                Json::String(path) if path.is_empty() => Some(data.clone()),
                Json::String(path) => path
                    .split('.')
                    .try_fold(data, |current, key| match current {
                        Json::Object(map) => map.get(key),
                        Json::Array(items) => key.parse::<usize>().ok().and_then(|i| items.get(i)),
                        _ => None,
                    })
                    .cloned(),
                Json::Number(index) => index.as_u64().and_then(|i| data.get(i as usize)).cloned(),
                _ => None,
            };
            match found {
                Some(Json::Null) | None => default,
                Some(found) => found,
            }
        }
        "==" => Json::Bool(loose_eq(&value(0), &value(1))),
        "!=" => Json::Bool(!loose_eq(&value(0), &value(1))),
        "===" => Json::Bool(value(0) == value(1)),
        "!==" => Json::Bool(value(0) != value(1)),
        "<" | ">" | "<=" | ">=" => {
            let numbers: Vec<Option<f64>> = (0..args.len()).map(|i| number(&value(i))).collect();
            let compare = |a: Option<f64>, b: Option<f64>| match (a, b) {
                (Some(a), Some(b)) => match op.as_str() {
                    "<" => a < b,
                    ">" => a > b,
                    "<=" => a <= b,
                    _ => a >= b,
                },
                _ => false,
            };
            // `{"<": [1, x, 3]}`: between.
            let result = numbers.windows(2).all(|pair| compare(pair[0], pair[1]));
            Json::Bool(numbers.len() >= 2 && result)
        }
        "!" => Json::Bool(!truthy(&value(0))),
        "!!" => Json::Bool(truthy(&value(0))),
        "and" => {
            let mut last = Json::Bool(true);
            for arg in &args {
                last = apply(arg, data);
                if !truthy(&last) {
                    return last;
                }
            }
            last
        }
        "or" => {
            let mut last = Json::Bool(false);
            for arg in &args {
                last = apply(arg, data);
                if truthy(&last) {
                    return last;
                }
            }
            last
        }
        "in" => Json::Bool(match (value(0), value(1)) {
            (needle, Json::Array(items)) => items.iter().any(|item| loose_eq(&needle, item)),
            (Json::String(needle), Json::String(haystack)) => haystack.contains(&needle),
            _ => false,
        }),
        "if" | "?:" => {
            let mut index = 0;
            while index + 1 < args.len() {
                if truthy(&apply(&args[index], data)) {
                    return apply(&args[index + 1], data);
                }
                index += 2;
            }
            if index < args.len() { apply(&args[index], data) } else { Json::Null }
        }
        _ => Json::Bool(true),
    }
}

fn truthy(value: &Json) -> bool {
    match value {
        Json::Null => false,
        Json::Bool(flag) => *flag,
        Json::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Json::String(text) => !text.is_empty(),
        Json::Array(items) => !items.is_empty(),
        Json::Object(_) => true,
    }
}

fn number(value: &Json) -> Option<f64> {
    match value {
        Json::Number(number) => number.as_f64(),
        Json::String(text) => text.trim().parse().ok(),
        Json::Bool(flag) => Some(if *flag { 1.0 } else { 0.0 }),
        Json::Null => Some(0.0),
        _ => None,
    }
}

/// JavaScript's `==` for the values conditions compare (strings, numbers, booleans, null).
fn loose_eq(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Null, Json::Null) => true,
        (Json::Null, _) | (_, Json::Null) => false,
        (Json::String(a), Json::String(b)) => a == b,
        (Json::Array(_) | Json::Object(_), _) | (_, Json::Array(_) | Json::Object(_)) => a == b,
        _ => match (number(a), number(b)) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        },
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn evaluates_strapi_conditions() {
        let data = json!({ "kind": "video", "views": 12, "tags": ["a"], "meta": { "live": true } });
        let when = |rule: Json| visible(Some(&json!({ "visible": rule })), &data);
        assert!(when(json!({ "==": [{ "var": "kind" }, "video"] })));
        assert!(!when(json!({ "==": [{ "var": "kind" }, "text"] })));
        assert!(when(json!({ "!=": [{ "var": "kind" }, "text"] })));
        assert!(when(json!({ "==": [{ "var": "views" }, "12"] })), "loose equality");
        assert!(!when(json!({ "===": [{ "var": "views" }, "12"] })));
        assert!(when(json!({ ">": [{ "var": "views" }, 10] })));
        assert!(when(json!({ "<=": [1, { "var": "views" }, 20] })), "between");
        assert!(when(
            json!({ "and": [{ "var": "meta.live" }, { "in": ["a", { "var": "tags" }] }] })
        ));
        assert!(!when(json!({ "or": [{ "!": { "var": "meta.live" } }, { "var": "missing" }] })));
        assert!(when(json!({ "in": ["vid", { "var": "kind" }] })));
        assert!(when(json!({ "!!": { "var": "tags" } })));
        assert!(when(json!({ "unknown-op": [1] })), "unknown operators never hide");
        assert!(visible(None, &data));
        assert!(visible(Some(&json!({})), &data));
    }
}
