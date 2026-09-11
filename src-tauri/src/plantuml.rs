//! PlantUML rendering for the Docs tab (T-0279).
//!
//! There is no PlantUML renderer that runs in a webview, so a diagram is sent
//! to a PlantUML server and comes back as SVG. That is the whole reason this is
//! opt-in: the server is `docs_plantuml_server` in the settings, empty by
//! default, and with it empty nothing leaves the machine — the fence stays the
//! code it is. A team's documents are not something to post to a third party
//! without the owner having said so.
//!
//! The request is the server's standard `GET {server}/svg/{encoded}`, which
//! the public server, the `plantuml-server` image and on-prem installs all
//! answer. The encoding is PlantUML's own: raw deflate, then a base64 variant
//! with its own alphabet. (A plain POST of the source would avoid the
//! encoding, but the public server answers a POST with a redirect to the
//! encoded URL rather than with the image.)
//!
//! The fetch happens here rather than in the webview so the webview needs no
//! network access and no CORS cooperation from the server.

use flate2::write::DeflateEncoder;
use flate2::Compression;
use std::io::Write;
use std::time::Duration;

/// Same bound as the Docs tab's filesystem calls: long enough for a slow
/// server, short enough that a diagram does not spin forever.
const TIMEOUT: Duration = Duration::from_secs(20);

/// Largest SVG accepted back. A diagram is kilobytes; anything past this is
/// not a diagram.
const MAX_SVG_BYTES: u64 = 8 * 1024 * 1024;

/// PlantUML's base64 alphabet — digits first, `-` and `_` last. It is not
/// RFC 4648's, so no standard base64 encoder produces it.
const ALPHABET: &[u8; 64] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/// Encodes a diagram's source the way PlantUML servers expect it in a URL.
pub fn encode(source: &str) -> String {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
    // Writing into a Vec cannot fail.
    let _ = encoder.write_all(source.as_bytes());
    let deflated = encoder.finish().unwrap_or_default();
    let mut out = String::with_capacity(deflated.len().div_ceil(3) * 4);
    for chunk in deflated.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        for shift in [18, 12, 6, 0] {
            out.push(ALPHABET[((n >> shift) & 63) as usize] as char);
        }
    }
    out
}

/// The URL that renders `source` as SVG on `server`.
///
/// `server` is the server's base, as a user copies it from the address bar:
/// `https://www.plantuml.com/plantuml`, with or without a trailing slash.
pub fn svg_url(server: &str, source: &str) -> String {
    format!(
        "{}/svg/{}",
        server.trim().trim_end_matches('/'),
        encode(source)
    )
}

/// Renders `source` on `server` and returns the SVG markup.
///
/// A diagram with a syntax error comes back from the server as a 400 whose
/// body is still an SVG — the error drawn as a picture, pointing at the bad
/// line. That is more useful than a message, so it is returned like any
/// other diagram.
pub fn render(server: &str, source: &str) -> Result<String, String> {
    if server.trim().is_empty() {
        return Err(
            "no PlantUML server is set — add one with the Docs tab's settings button".into(),
        );
    }
    let url = svg_url(server, source);
    let agent = ureq::AgentBuilder::new()
        .timeout(TIMEOUT)
        .user_agent(concat!("workhub/", env!("CARGO_PKG_VERSION")))
        .build();
    let response = match agent.get(&url).call() {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) if is_svg(&r) => r,
        Err(ureq::Error::Status(code, _)) => {
            return Err(format!("the PlantUML server answered HTTP {code}"));
        }
        Err(e) => return Err(format!("could not reach the PlantUML server: {e}")),
    };
    if !is_svg(&response) {
        return Err(format!(
            "the PlantUML server did not return an SVG (got {}) — check the server URL",
            response.content_type()
        ));
    }
    let mut body = String::new();
    std::io::Read::read_to_string(
        &mut std::io::Read::take(response.into_reader(), MAX_SVG_BYTES),
        &mut body,
    )
    .map_err(|e| format!("could not read the PlantUML server's answer: {e}"))?;
    Ok(body)
}

fn is_svg(response: &ureq::Response) -> bool {
    response.content_type().contains("svg")
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::DeflateDecoder;
    use std::io::Read;

    /// Inverse of `encode`, for the round-trip test only.
    fn decode(encoded: &str) -> String {
        let mut bytes = Vec::new();
        for quad in encoded.as_bytes().chunks(4) {
            let mut n = 0u32;
            for &c in quad {
                let v = ALPHABET.iter().position(|&a| a == c).unwrap() as u32;
                n = (n << 6) | v;
            }
            bytes.extend_from_slice(&[(n >> 16) as u8, (n >> 8) as u8, n as u8]);
        }
        let mut out = String::new();
        // Trailing padding bytes after the deflate stream's end are ignored.
        DeflateDecoder::new(&bytes[..])
            .read_to_string(&mut out)
            .unwrap();
        out
    }

    #[test]
    fn encoding_round_trips_through_deflate_and_the_plantuml_alphabet() {
        let source = "@startuml\nAlice -> Bob: こんにちは\n@enduml\n";
        let encoded = encode(source);
        assert!(encoded
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
        assert_eq!(encoded.len() % 4, 0);
        assert_eq!(decode(&encoded), source);
    }

    #[test]
    fn the_url_tolerates_a_trailing_slash_on_the_server() {
        let a = svg_url("https://example.com/plantuml/", "A -> B");
        let b = svg_url(" https://example.com/plantuml ", "A -> B");
        assert_eq!(a, b);
        assert!(a.starts_with("https://example.com/plantuml/svg/"));
    }

    #[test]
    fn nothing_is_sent_without_a_server() {
        assert!(render("", "A -> B").is_err());
        assert!(render("   ", "A -> B").is_err());
    }
}
