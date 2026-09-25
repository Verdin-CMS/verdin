//! Content locales stored in `vd_locales` (the first start adds English as the default).

use verdin_content::locales::{Locale, LocaleSet};
use verdin_db::value::truncate_millis;
use verdin_db::{ColumnKind as K, Database, DbError, SqlValue as V};
use verdin_migrate::system::LOCALES;

/// The stored locales, adding the default English one when there is none.
pub async fn load_locales(db: &Database) -> Result<LocaleSet, DbError> {
    let rows = db
        .queries()
        .fetch_all(
            &format!("SELECT code, name, is_default FROM {LOCALES} ORDER BY id"),
            &[],
            &[K::Text, K::Text, K::Bool],
        )
        .await?;
    if rows.is_empty() {
        let set = LocaleSet::default();
        let now = truncate_millis(time::OffsetDateTime::now_utc());
        for locale in &set.locales {
            db.queries()
                .execute(
                    &format!(
                        "INSERT INTO {LOCALES} (code, name, is_default, created_at, updated_at) \
                         VALUES (?, ?, ?, ?, ?)"
                    ),
                    &[
                        V::Text(locale.code.clone()),
                        V::Text(locale.name.clone()),
                        V::Bool(locale.code == set.default),
                        V::DateTime(now),
                        V::DateTime(now),
                    ],
                )
                .await?;
        }
        return Ok(set);
    }
    let mut set = LocaleSet { locales: Vec::new(), default: String::new() };
    for row in rows {
        let mut row = row.into_iter();
        let code = row.next().and_then(V::into_text).unwrap_or_default();
        let name = row.next().and_then(V::into_text).unwrap_or_default();
        if matches!(row.next(), Some(V::Bool(true))) {
            set.default = code.clone();
        }
        set.locales.push(Locale { code, name });
    }
    if set.default.is_empty() {
        set.default = set.locales[0].code.clone();
    }
    Ok(set)
}
