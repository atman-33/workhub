/// Detection and mapping of WSL UNC project paths.
///
/// Projects can be registered with a WSL share path such as
/// `\\wsl.localhost\Ubuntu\home\user\repo` (stored forward-slashed as
/// `//wsl.localhost/Ubuntu/home/user/repo`). Windows-side tools reject or
/// crawl over these: git refuses them as foreign-owned ("dubious ownership")
/// and is very slow over the 9P share. Callers use `parse_wsl_path` to route
/// such paths to the tooling inside the distro instead (`wsl.exe git ...`,
/// `code --remote wsl+<distro> ...`).
pub struct WslPath {
    pub distro: String,
    pub linux_path: String,
}

/// Parse a `\\wsl.localhost\<distro>\...` or `\\wsl$\<distro>\...` path
/// (either slash direction) into its distro name and in-distro Linux path.
/// Returns `None` for anything that is not a WSL share path.
pub fn parse_wsl_path(path: &str) -> Option<WslPath> {
    let normalized = path.trim().replace('\\', "/");
    let rest = normalized.strip_prefix("//")?;
    let (host, remainder) = rest.split_once('/')?;
    let host_lower = host.to_ascii_lowercase();
    if host_lower != "wsl.localhost" && host_lower != "wsl$" {
        return None;
    }
    let (distro, sub) = match remainder.split_once('/') {
        Some((d, s)) => (d, s),
        None => (remainder, ""),
    };
    if distro.is_empty() {
        return None;
    }
    let linux_path = format!("/{}", sub.trim_end_matches('/'));
    Some(WslPath {
        distro: distro.to_string(),
        linux_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_forward_slash_wsl_localhost() {
        let p = parse_wsl_path("//wsl.localhost/Ubuntu/home/atman/repos/srms").unwrap();
        assert_eq!(p.distro, "Ubuntu");
        assert_eq!(p.linux_path, "/home/atman/repos/srms");
    }

    #[test]
    fn parses_backslash_unc() {
        let p = parse_wsl_path(r"\\wsl.localhost\Ubuntu\home\atman").unwrap();
        assert_eq!(p.distro, "Ubuntu");
        assert_eq!(p.linux_path, "/home/atman");
    }

    #[test]
    fn parses_legacy_wsl_dollar_host() {
        let p = parse_wsl_path(r"\\wsl$\Debian\srv").unwrap();
        assert_eq!(p.distro, "Debian");
        assert_eq!(p.linux_path, "/srv");
    }

    #[test]
    fn host_match_is_case_insensitive() {
        let p = parse_wsl_path("//WSL.LOCALHOST/Ubuntu/home").unwrap();
        assert_eq!(p.distro, "Ubuntu");
        assert_eq!(p.linux_path, "/home");
    }

    #[test]
    fn distro_root_maps_to_slash() {
        let p = parse_wsl_path("//wsl.localhost/Ubuntu").unwrap();
        assert_eq!(p.distro, "Ubuntu");
        assert_eq!(p.linux_path, "/");
        let p = parse_wsl_path("//wsl.localhost/Ubuntu/").unwrap();
        assert_eq!(p.linux_path, "/");
    }

    #[test]
    fn trailing_slash_is_trimmed() {
        let p = parse_wsl_path("//wsl.localhost/Ubuntu/home/atman/").unwrap();
        assert_eq!(p.linux_path, "/home/atman");
    }

    #[test]
    fn non_wsl_paths_are_none() {
        assert!(parse_wsl_path("C:/repos/workhub").is_none());
        assert!(parse_wsl_path(r"C:\repos\workhub").is_none());
        assert!(parse_wsl_path("//server/share/folder").is_none());
        assert!(parse_wsl_path("/home/atman/repos").is_none());
        assert!(parse_wsl_path("//wsl.localhost").is_none());
        assert!(parse_wsl_path("").is_none());
    }
}
