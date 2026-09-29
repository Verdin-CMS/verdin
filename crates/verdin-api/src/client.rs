//! Who is calling: the client address behind trusted reverse proxies (`[server]
//! trusted_proxies`), for rate limits and audit logs.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::extract::{ConnectInfo, FromRequestParts, Request, State};
use axum::http::Extensions;
use axum::http::request::Parts;
use axum::middleware::Next;
use axum::response::Response;
use ipnet::IpNet;

/// The client's address, set by [`middleware`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientAddr(pub IpAddr);

/// Proxies whose `X-Forwarded-For` is believed.
#[derive(Debug, Clone, Default)]
pub struct TrustedProxies(Arc<Vec<IpNet>>);

impl TrustedProxies {
    /// IPs and CIDR ranges (`10.0.0.0/8`, `::1`).
    pub fn parse(entries: &[String]) -> Result<Self, String> {
        let nets = entries
            .iter()
            .map(|entry| {
                let entry = entry.trim();
                entry
                    .parse::<IpNet>()
                    .or_else(|_| entry.parse::<IpAddr>().map(IpNet::from))
                    .map_err(|_| format!("`{entry}` is not an IP address or CIDR range"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self(Arc::new(nets)))
    }

    fn trusts(&self, ip: IpAddr) -> bool {
        let ip = ip.to_canonical();
        self.0.iter().any(|net| net.contains(&ip))
    }

    /// The client behind `peer`: from a trusted proxy, the last address in
    /// `X-Forwarded-For` that is not itself a trusted proxy.
    pub fn client(&self, peer: IpAddr, forwarded: Option<&str>) -> IpAddr {
        if !self.trusts(peer) {
            return peer;
        }
        let Some(forwarded) = forwarded else { return peer };
        let mut client = peer;
        for hop in forwarded.rsplit(',') {
            let Ok(ip) = hop.trim().parse::<IpAddr>() else { break };
            client = ip;
            if !self.trusts(ip) {
                break;
            }
        }
        client
    }
}

/// Resolves the client address of every request.
pub async fn middleware(
    State(proxies): State<TrustedProxies>,
    mut request: Request,
    next: Next,
) -> Response {
    if let Some(peer) =
        request.extensions().get::<ConnectInfo<SocketAddr>>().map(|info| info.0.ip())
    {
        let forwarded = request
            .headers()
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let client = proxies.client(peer, forwarded.as_deref());
        request.extensions_mut().insert(ClientAddr(client));
    }
    next.run(request).await
}

/// The client address of a request, as text (`unknown` without a connection).
pub(crate) fn client_ip(extensions: &Extensions) -> String {
    extensions
        .get::<ClientAddr>()
        .map(|addr| addr.0)
        .or_else(|| extensions.get::<ConnectInfo<SocketAddr>>().map(|info| info.0.ip()))
        .map_or_else(|| "unknown".to_owned(), |ip| ip.to_canonical().to_string())
}

/// Extracts the client address.
pub(crate) struct ClientIp(pub(crate) String);

impl<S: Send + Sync> FromRequestParts<S> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _: &S) -> Result<Self, Self::Rejection> {
        Ok(ClientIp(client_ip(&parts.extensions)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn believes_trusted_proxies_only() {
        let proxies = TrustedProxies::parse(&["10.0.0.0/8".into(), "::1".into()]).unwrap();
        let ip = |text: &str| text.parse::<IpAddr>().unwrap();
        assert_eq!(proxies.client(ip("10.0.0.5"), Some("203.0.113.9")), ip("203.0.113.9"));
        assert_eq!(
            proxies.client(ip("10.0.0.5"), Some("198.51.100.1, 203.0.113.9, 10.0.0.7")),
            ip("203.0.113.9"),
            "the last untrusted hop, not the spoofable first one"
        );
        assert_eq!(
            proxies.client(ip("192.0.2.1"), Some("203.0.113.9")),
            ip("192.0.2.1"),
            "untrusted peer"
        );
        assert_eq!(proxies.client(ip("::1"), None), ip("::1"));
        assert_eq!(proxies.client(ip("10.0.0.5"), Some("garbage")), ip("10.0.0.5"));
        assert!(TrustedProxies::parse(&["nope".into()]).is_err());
    }
}
