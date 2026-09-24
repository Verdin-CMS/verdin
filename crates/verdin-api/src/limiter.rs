//! Fixed-window rate limiting for sensitive endpoints (login, registration, refresh).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    limit: u32,
    window: Duration,
    hits: Mutex<HashMap<String, (Instant, u32)>>,
}

impl RateLimiter {
    pub fn new(limit: u32, window: Duration) -> Self {
        Self { limit, window, hits: Mutex::new(HashMap::new()) }
    }

    /// Records a hit for `key`; `false` once the key is over its limit in this window.
    pub fn allow(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut hits = self.hits.lock().expect("rate limiter lock");
        if hits.len() > 10_000 {
            hits.retain(|_, (start, _)| now.duration_since(*start) < self.window);
        }
        let entry = hits.entry(key.to_owned()).or_insert((now, 0));
        if now.duration_since(entry.0) >= self.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= self.limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_per_key_and_window() {
        let limiter = RateLimiter::new(2, Duration::from_millis(50));
        assert!(limiter.allow("a") && limiter.allow("a"));
        assert!(!limiter.allow("a"));
        assert!(limiter.allow("b"));
        std::thread::sleep(Duration::from_millis(60));
        assert!(limiter.allow("a"), "new window");
    }
}
