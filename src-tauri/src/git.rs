use crate::models::{CommitEntry, CommitRef, GitInfo, GitLog, GraphOp};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Run `git -C <path> <args>` without flashing a console window.
fn git(path: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(path).args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    match cmd.output() {
        Ok(out) => {
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).into_owned())
            } else {
                let err = String::from_utf8_lossy(&out.stderr).into_owned();
                let err = err.trim();
                Err(if err.is_empty() {
                    format!("git {} failed", args.first().unwrap_or(&""))
                } else {
                    err.to_string()
                })
            }
        }
        Err(e) => Err(format!("failed to run git: {e}")),
    }
}

/// Run `git -C <path> <args>`, capturing stdout and stderr separately even on
/// failure. Some git subcommands (merge/rebase/cherry-pick) print `CONFLICT`
/// lines to stdout rather than stderr, so callers that need to detect
/// conflicts must inspect both streams.
fn git_out_err(path: &str, args: &[&str]) -> Result<String, (String, String)> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(path).args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    match cmd.output() {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            if out.status.success() {
                Ok(stdout)
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
                Err((stdout, stderr))
            }
        }
        Err(e) => Err((String::new(), format!("failed to run git: {e}"))),
    }
}

/// Run a conflict-prone operation (merge/rebase/cherry-pick); on failure,
/// best-effort abort it and restore the repository to its prior state.
fn run_with_abort(
    path: &str,
    args: &[&str],
    abort_args: &[&str],
    what: &str,
) -> Result<String, String> {
    match git_out_err(path, args) {
        Ok(out) => {
            let first = out.lines().next().unwrap_or("").trim();
            Ok(if first.is_empty() {
                format!("{what} done")
            } else {
                first.to_string()
            })
        }
        Err((stdout, stderr)) => {
            let conflict = stdout.to_lowercase().contains("conflict")
                || stderr.to_lowercase().contains("conflict");
            if conflict {
                let _ = git(path, abort_args); // best-effort restore
                Err(format!(
                    "{what} hit conflicts — aborted, repository restored"
                ))
            } else {
                let stderr = stderr.trim();
                let stdout = stdout.trim();
                Err(if !stderr.is_empty() {
                    stderr.to_string()
                } else if !stdout.is_empty() {
                    stdout.to_string()
                } else {
                    format!("git {what} failed")
                })
            }
        }
    }
}

/// Read a page of commit history for the graph view.
pub fn read_log(path: &str, limit: u32, skip: u32) -> Result<GitLog, String> {
    let max_count_arg = format!("--max-count={}", limit.saturating_add(1));
    let skip_arg = format!("--skip={skip}");
    let raw = git(
        path,
        &[
            "log",
            "--exclude=refs/stash",
            "--all",
            "--topo-order",
            "--decorate=full",
            &max_count_arg,
            &skip_arg,
            "--pretty=format:%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e",
        ],
    )?;

    let mut commits = parse_log_records(&raw);
    let has_more = commits.len() > limit as usize;
    commits.truncate(limit as usize);

    let head = git(path, &["rev-parse", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let current_branch = git(path, &["symbolic-ref", "--short", "-q", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default(); // detached HEAD (or unborn branch with no ref yet)
    let uncommitted = git(path, &["status", "--porcelain"])
        .map(|s| s.lines().filter(|l| !l.is_empty()).count() as u32)
        .unwrap_or(0);

    Ok(GitLog {
        commits,
        head,
        current_branch,
        uncommitted,
        has_more,
    })
}

/// Parse `%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e`-formatted `git log` output.
fn parse_log_records(raw: &str) -> Vec<CommitEntry> {
    raw.split('\x1e')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter_map(|record| {
            let mut fields = record.splitn(6, '\x1f');
            let hash = fields.next()?.to_string();
            let parents = fields
                .next()?
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            let author = fields.next()?.to_string();
            let date = fields.next()?.trim().parse().unwrap_or(0);
            let refs = parse_decorations(fields.next()?);
            let subject = fields.next().unwrap_or("").to_string();
            Some(CommitEntry {
                hash,
                parents,
                author,
                date,
                refs,
                subject,
            })
        })
        .collect()
}

/// Parse the `%D` decoration string (e.g. from `--decorate=full`) into refs.
fn parse_decorations(raw: &str) -> Vec<CommitRef> {
    raw.split(", ")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|token| {
            let (is_head, rest) = match token.strip_prefix("HEAD -> ") {
                Some(rest) => (true, rest),
                None => (false, token),
            };
            if let Some(name) = rest.strip_prefix("tag: refs/tags/") {
                CommitRef {
                    name: name.to_string(),
                    kind: "tag".into(),
                    is_head,
                }
            } else if let Some(name) = rest.strip_prefix("refs/heads/") {
                CommitRef {
                    name: name.to_string(),
                    kind: "branch".into(),
                    is_head,
                }
            } else if let Some(name) = rest.strip_prefix("refs/remotes/") {
                CommitRef {
                    name: name.to_string(),
                    kind: "remote".into(),
                    is_head,
                }
            } else if rest == "HEAD" {
                CommitRef {
                    name: "HEAD".into(),
                    kind: "head".into(),
                    is_head: true,
                }
            } else {
                CommitRef {
                    name: rest.to_string(),
                    kind: "branch".into(),
                    is_head,
                }
            }
        })
        .collect()
}

pub fn create_branch(path: &str, name: &str, hash: &str, checkout: bool) -> Result<String, String> {
    if checkout {
        git(path, &["checkout", "-b", name, hash])
            .map(|_| format!("created and switched to {name}"))
    } else {
        git(path, &["branch", name, hash]).map(|_| format!("created branch {name}"))
    }
}

pub fn delete_branch(path: &str, name: &str, force: bool) -> Result<String, String> {
    let flag = if force { "-D" } else { "-d" };
    git(path, &["branch", flag, name]).map(|_| format!("deleted branch {name}"))
}

pub fn merge(path: &str, branch: &str) -> Result<String, String> {
    run_with_abort(path, &["merge", branch], &["merge", "--abort"], "merge")
}

pub fn rebase(path: &str, branch: &str) -> Result<String, String> {
    run_with_abort(path, &["rebase", branch], &["rebase", "--abort"], "rebase")
}

pub fn push(path: &str) -> Result<String, String> {
    git(path, &["push"]).map(|o| {
        let first = o.lines().next().unwrap_or("pushed").trim().to_string();
        if first.is_empty() {
            "pushed".into()
        } else {
            first
        }
    })
}

pub fn reset(path: &str, hash: &str, mode: &str) -> Result<String, String> {
    if !matches!(mode, "soft" | "mixed" | "hard") {
        return Err(format!("invalid reset mode: {mode}"));
    }
    let flag = format!("--{mode}");
    git(path, &["reset", &flag, hash]).map(|_| format!("reset --{mode} to {hash}"))
}

pub fn cherry_pick(path: &str, hash: &str) -> Result<String, String> {
    run_with_abort(
        path,
        &["cherry-pick", hash],
        &["cherry-pick", "--abort"],
        "cherry-pick",
    )
}

pub fn tag_create(path: &str, name: &str, hash: &str) -> Result<String, String> {
    git(path, &["tag", name, hash]).map(|_| format!("created tag {name}"))
}

pub fn tag_delete(path: &str, name: &str) -> Result<String, String> {
    git(path, &["tag", "-d", name]).map(|_| format!("deleted tag {name}"))
}

/// Dispatch a graph-view git operation.
pub fn graph_op(path: &str, op: GraphOp) -> Result<String, String> {
    match op {
        GraphOp::Checkout { branch } => switch(path, &branch),
        GraphOp::CreateBranch {
            name,
            hash,
            checkout,
        } => create_branch(path, &name, &hash, checkout),
        GraphOp::DeleteBranch { name, force } => delete_branch(path, &name, force),
        GraphOp::Merge { branch } => merge(path, &branch),
        GraphOp::Rebase { branch } => rebase(path, &branch),
        GraphOp::Push => push(path),
        GraphOp::Pull => pull(path),
        GraphOp::Fetch => fetch(path),
        GraphOp::Reset { hash, mode } => reset(path, &hash, &mode),
        GraphOp::CherryPick { hash } => cherry_pick(path, &hash),
        GraphOp::CreateTag { name, hash } => tag_create(path, &name, &hash),
        GraphOp::DeleteTag { name } => tag_delete(path, &name),
    }
}

/// Read branch, ahead/behind, and uncommitted-change count in one call.
pub fn read_status(path: &str) -> GitInfo {
    let out = match git(path, &["status", "--porcelain=v2", "--branch"]) {
        Ok(o) => o,
        Err(e) => {
            let not_repo = e.contains("not a git repository");
            return GitInfo {
                is_repo: !not_repo,
                error: if not_repo { None } else { Some(e) },
                ..Default::default()
            };
        }
    };

    let mut info = parse_status(&out);
    if let Ok(branches) = git(path, &["branch", "--format=%(refname:short)"]) {
        info.branches = branches
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
    }
    info
}

/// Parse `git status --porcelain=v2 --branch` output.
fn parse_status(out: &str) -> GitInfo {
    let mut info = GitInfo {
        is_repo: true,
        ..Default::default()
    };
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            if rest == "(detached)" {
                info.detached = true;
                info.branch = "(detached)".into();
            } else {
                info.branch = rest.to_string();
            }
        } else if line.starts_with("# branch.upstream ") {
            info.has_upstream = true;
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    info.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    info.behind = n.parse().unwrap_or(0);
                }
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            info.changes += 1;
        }
    }
    info
}

pub fn fetch(path: &str) -> Result<String, String> {
    git(path, &["fetch", "--prune"]).map(|_| "fetched".into())
}

pub fn pull(path: &str) -> Result<String, String> {
    git(path, &["pull", "--ff-only"]).map(|o| {
        let first = o.lines().next().unwrap_or("pulled").trim().to_string();
        if first.is_empty() {
            "pulled".into()
        } else {
            first
        }
    })
}

pub fn switch(path: &str, branch: &str) -> Result<String, String> {
    git(path, &["switch", branch]).map(|_| format!("switched to {branch}"))
}

/// Get the `origin` remote URL, normalized to an `https://` web URL.
pub fn remote_url(path: &str) -> Result<String, String> {
    let raw = git(path, &["remote", "get-url", "origin"])?;
    normalize_remote_url(raw.trim()).ok_or_else(|| format!("unrecognized remote URL: {raw}"))
}

/// Normalize a git remote URL to an `https://host/owner/repo` web URL.
///
/// Handles `git@host:owner/repo.git` (SCP-like SSH), `ssh://git@host/owner/repo(.git)`,
/// and `https://host/owner/repo(.git)` forms. Returns `None` for anything else.
fn normalize_remote_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }

    let (host, path) = if let Some(rest) = raw.strip_prefix("ssh://") {
        // ssh://git@host/owner/repo(.git) — optionally with a port (ssh://git@host:22/owner/repo)
        let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        let (host_port, path) = rest.split_once('/')?;
        let host = host_port.split(':').next()?;
        (host, path)
    } else if let Some(rest) = raw
        .strip_prefix("https://")
        .or_else(|| raw.strip_prefix("http://"))
    {
        let (host, path) = rest.split_once('/')?;
        (host, path)
    } else {
        let rest = raw.strip_prefix("git@")?;
        // git@host:owner/repo(.git)
        let (host, path) = rest.split_once(':')?;
        (host, path)
    };

    if host.is_empty() || path.is_empty() {
        return None;
    }

    let path = path.strip_suffix(".git").unwrap_or(path);
    let path = path.trim_matches('/');
    if path.is_empty() {
        return None;
    }

    Some(format!("https://{host}/{path}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_ahead_behind_and_changes() {
        let out = "\
# branch.oid 1234abcd
# branch.head main
# branch.upstream origin/main
# branch.ab +2 -3
1 .M N... 100644 100644 100644 aaa bbb src/app.rs
? untracked.txt
";
        let info = parse_status(out);
        assert!(info.is_repo);
        assert_eq!(info.branch, "main");
        assert!(info.has_upstream);
        assert!(!info.detached);
        assert_eq!(info.ahead, 2);
        assert_eq!(info.behind, 3);
        assert_eq!(info.changes, 2);
    }

    #[test]
    fn parses_clean_repo_without_upstream() {
        let out = "\
# branch.oid deadbeef
# branch.head feature/x
";
        let info = parse_status(out);
        assert_eq!(info.branch, "feature/x");
        assert!(!info.has_upstream);
        assert_eq!(info.ahead, 0);
        assert_eq!(info.behind, 0);
        assert_eq!(info.changes, 0);
    }

    #[test]
    fn parses_detached_head() {
        let out = "# branch.oid deadbeef\n# branch.head (detached)\n";
        let info = parse_status(out);
        assert!(info.detached);
        assert_eq!(info.branch, "(detached)");
    }

    #[test]
    fn normalizes_scp_style_ssh_url() {
        assert_eq!(
            normalize_remote_url("git@github.com:owner/repo.git"),
            Some("https://github.com/owner/repo".to_string())
        );
    }

    #[test]
    fn normalizes_scp_style_ssh_url_without_git_suffix() {
        assert_eq!(
            normalize_remote_url("git@github.com:owner/repo"),
            Some("https://github.com/owner/repo".to_string())
        );
    }

    #[test]
    fn normalizes_ssh_url_scheme() {
        assert_eq!(
            normalize_remote_url("ssh://git@github.com/owner/repo.git"),
            Some("https://github.com/owner/repo".to_string())
        );
    }

    #[test]
    fn normalizes_ssh_url_scheme_with_port() {
        assert_eq!(
            normalize_remote_url("ssh://git@github.com:22/owner/repo.git"),
            Some("https://github.com/owner/repo".to_string())
        );
    }

    #[test]
    fn normalizes_https_url_with_git_suffix() {
        assert_eq!(
            normalize_remote_url("https://github.com/owner/repo.git"),
            Some("https://github.com/owner/repo".to_string())
        );
    }

    #[test]
    fn normalizes_https_url_without_git_suffix() {
        assert_eq!(
            normalize_remote_url("https://gitlab.com/owner/repo"),
            Some("https://gitlab.com/owner/repo".to_string())
        );
    }

    #[test]
    fn rejects_invalid_input() {
        assert_eq!(normalize_remote_url(""), None);
        assert_eq!(normalize_remote_url("not a url"), None);
        assert_eq!(normalize_remote_url("ftp://example.com/owner/repo"), None);
    }

    #[test]
    fn parses_multiple_log_records_including_a_merge_commit() {
        let raw = "\
aaa1\x1fbbb1\x1fAlice\x1f1000\x1frefs/heads/main\x1fFirst commit\x1e
aaa2\x1fbbb2 ccc2\x1fBob\x1f2000\x1f\x1fMerge branch 'feature'\x1e
";
        let records = parse_log_records(raw);
        assert_eq!(records.len(), 2);

        assert_eq!(records[0].hash, "aaa1");
        assert_eq!(records[0].parents, vec!["bbb1".to_string()]);
        assert_eq!(records[0].author, "Alice");
        assert_eq!(records[0].date, 1000);
        assert_eq!(records[0].subject, "First commit");
        assert_eq!(records[0].refs.len(), 1);
        assert_eq!(records[0].refs[0].kind, "branch");

        assert_eq!(records[1].hash, "aaa2");
        assert_eq!(
            records[1].parents,
            vec!["bbb2".to_string(), "ccc2".to_string()]
        );
        assert_eq!(records[1].author, "Bob");
        assert_eq!(records[1].date, 2000);
        assert_eq!(records[1].subject, "Merge branch 'feature'");
        assert!(records[1].refs.is_empty());
    }

    #[test]
    fn parses_head_arrow_branch_decoration() {
        let refs = parse_decorations("HEAD -> refs/heads/main, refs/remotes/origin/main");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].name, "main");
        assert_eq!(refs[0].kind, "branch");
        assert!(refs[0].is_head);
        assert_eq!(refs[1].name, "origin/main");
        assert_eq!(refs[1].kind, "remote");
        assert!(!refs[1].is_head);
    }

    #[test]
    fn parses_remote_decoration() {
        let refs = parse_decorations("refs/remotes/origin/feature-x");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].name, "origin/feature-x");
        assert_eq!(refs[0].kind, "remote");
        assert!(!refs[0].is_head);
    }

    #[test]
    fn parses_tag_decoration() {
        let refs = parse_decorations("tag: refs/tags/v1.0.0");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].name, "v1.0.0");
        assert_eq!(refs[0].kind, "tag");
        assert!(!refs[0].is_head);
    }

    #[test]
    fn parses_detached_head_decoration() {
        let refs = parse_decorations("HEAD");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].name, "HEAD");
        assert_eq!(refs[0].kind, "head");
        assert!(refs[0].is_head);
    }

    #[test]
    fn parses_empty_decoration_as_no_refs() {
        assert!(parse_decorations("").is_empty());
    }

    #[test]
    fn reset_rejects_invalid_mode() {
        let err = reset("C:/does/not/matter", "abc123", "nope").unwrap_err();
        assert!(err.contains("invalid reset mode"));
    }
}
