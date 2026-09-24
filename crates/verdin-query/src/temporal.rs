//! Lenient parsing of dates, times and timestamps from API input.

use time::format_description::well_known::Rfc3339;
use time::macros::format_description;
use time::{Date, OffsetDateTime, Time, UtcOffset};
use verdin_db::value::truncate_millis;

/// `YYYY-MM-DD`.
pub fn parse_date(text: &str) -> Option<Date> {
    Date::parse(text, format_description!("[year]-[month]-[day]")).ok()
}

/// `HH:MM`, `HH:MM:SS` or `HH:MM:SS.fff` (fraction truncated to milliseconds).
pub fn parse_time(text: &str) -> Option<Time> {
    let formats = [
        format_description!("[hour]:[minute]:[second].[subsecond]"),
        format_description!("[hour]:[minute]:[second]"),
        format_description!("[hour]:[minute]"),
    ];
    formats.iter().find_map(|format| Time::parse(text, format).ok()).map(|time| {
        let nanos = time.nanosecond();
        time.replace_nanosecond(nanos - nanos % 1_000_000).expect("valid nanosecond")
    })
}

/// RFC 3339 (`2026-09-24T10:00:00Z`, `…+02:00`, with or without fraction), or a bare
/// date meaning midnight UTC. Normalized to UTC with millisecond precision.
pub fn parse_datetime(text: &str) -> Option<OffsetDateTime> {
    let parsed = OffsetDateTime::parse(text, &Rfc3339)
        .ok()
        .or_else(|| parse_date(text).map(|date| date.midnight().assume_utc()))?;
    Some(truncate_millis(parsed.to_offset(UtcOffset::UTC)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{date, datetime, time};

    #[test]
    fn parses_temporal_values() {
        assert_eq!(parse_date("2026-09-24"), Some(date!(2026 - 09 - 24)));
        assert_eq!(parse_date("2026-9-24"), None);
        assert_eq!(parse_time("10:30"), Some(time!(10:30)));
        assert_eq!(parse_time("10:30:05.123456"), Some(time!(10:30:05.123)));
        assert_eq!(parse_time("25:00"), None);
        assert_eq!(
            parse_datetime("2026-09-24T12:00:00.5+02:00"),
            Some(datetime!(2026-09-24 10:00:00.5 UTC))
        );
        assert_eq!(parse_datetime("2026-09-24"), Some(datetime!(2026-09-24 0:00 UTC)));
        assert_eq!(parse_datetime("yesterday"), None);
    }
}
