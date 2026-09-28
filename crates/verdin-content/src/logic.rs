//! The subset of [JSON Logic](https://jsonlogic.com) that Strapi's conditional fields
//! (`conditions.visible`) and cross-field validations use: `var`, comparisons (numbers, or
//! strings such as ISO dates), `!`, `!!`, `and`, `or`, `in`, `if`, arithmetic, `min`, `max`
//! and `cat`. Unknown operators make a condition true, so a field is never hidden by
//! mistake (validations reject them when the schema loads).

use serde_json::Value as Json;

/// Whether an attribute with these `conditions` is visible for `scope` (the other values
/// of the same document or component item).
pub fn visible(conditions: Option<&Json>, scope: &Json) -> bool {
    match conditions.and_then(|conditions| conditions.get("visible")) {
        None => true,
        Some(rule) => truthy(&apply(rule, scope)),
    }
}

/// Whether a cross-field validation `rule` holds for `document`.
pub fn holds(rule: &Json, document: &Json) -> bool {
    truthy(&apply(rule, document))
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
            let values: Vec<Json> = (0..args.len()).map(value).collect();
            let compare = |a: &Json, b: &Json| {
                let ordering = match (number(a), number(b)) {
                    (Some(a), Some(b)) => a.partial_cmp(&b),
                    // Both strings and not numbers: ISO dates and times order as text.
                    _ => match (a, b) {
                        (Json::String(a), Json::String(b)) => Some(a.cmp(b)),
                        _ => None,
                    },
                };
                ordering.is_some_and(|ordering| match op.as_str() {
                    "<" => ordering.is_lt(),
                    ">" => ordering.is_gt(),
                    "<=" => ordering.is_le(),
                    _ => ordering.is_ge(),
                })
            };
            // `{"<": [1, x, 3]}`: between.
            let result = values.windows(2).all(|pair| compare(&pair[0], &pair[1]));
            Json::Bool(values.len() >= 2 && result)
        }
        "+" | "*" | "min" | "max" => {
            let numbers: Option<Vec<f64>> = (0..args.len()).map(|i| number(&value(i))).collect();
            let Some(numbers) = numbers.filter(|numbers| !numbers.is_empty()) else {
                return Json::Null;
            };
            let result = match op.as_str() {
                "+" => numbers.iter().sum(),
                "*" => numbers.iter().product(),
                "min" => numbers.iter().copied().fold(f64::INFINITY, f64::min),
                _ => numbers.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            };
            to_json(result)
        }
        "-" | "/" | "%" => match (number(&value(0)), args.get(1).map(|_| number(&value(1)))) {
            (Some(a), None) if op == "-" => to_json(-a),
            (Some(a), Some(Some(b))) => match op.as_str() {
                "-" => to_json(a - b),
                _ if b == 0.0 => Json::Null,
                "/" => to_json(a / b),
                _ => to_json(a % b),
            },
            _ => Json::Null,
        },
        "cat" => Json::String(
            (0..args.len())
                .map(|i| match value(i) {
                    Json::String(text) => text,
                    Json::Null => String::new(),
                    other => other.to_string(),
                })
                .collect(),
        ),
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

fn to_json(number: f64) -> Json {
    serde_json::Number::from_f64(number).map_or(Json::Null, Json::Number)
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
        assert!(when(json!({ "==": [{ "+": [{ "var": "views" }, 3] }, 15] })));
        assert!(when(json!({ "==": [{ "cat": ["a", 1, null] }, "a1"] })));
        assert!(when(json!({ "==": [{ "/": [1, 0] }, null] })));
        assert!(visible(Some(&json!({})), &data));
    }

    #[test]
    fn compares_dates_as_text() {
        let data =
            json!({ "start": "2026-03-01", "end": "2026-02-01", "at": "2026-03-01T10:00:00.000Z" });
        assert!(!holds(&json!({ "<=": [{ "var": "start" }, { "var": "end" }] }), &data));
        assert!(holds(&json!({ ">=": [{ "var": "start" }, { "var": "end" }] }), &data));
        assert!(holds(&json!({ "<": [{ "var": "start" }, { "var": "at" }] }), &data));
        assert!(!holds(&json!({ "<": [{ "var": "start" }, 3] }), &data), "text and number");
    }
}
