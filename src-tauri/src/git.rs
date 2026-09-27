use crate::models::{
    BranchList, CommitEntry, CommitFileChange, CommitRef, GitInfo, GitLog, GraphOp,
};
use std::collections::{HashMap, HashSet};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Build the `git` invocation for a repository path. WSL share paths
/// (`\\wsl.localhost\...`) are routed through `wsl.exe` so git runs inside
/// the distro — Windows-side git rejects them as foreign-owned ("dubious
/// ownership") and is very slow over the 9P share.
/// `core.quotepath=false` keeps non-ASCII paths (e.g. Japanese filenames)
/// as raw UTF-8 in output instead of octal-escaping them (`\343\201\256`).
fn git_command(path: &str, args: &[&str]) -> Command {
    let mut cmd = match crate::wsl::parse_wsl_path(path) {
        Some(w) => {
            let mut cmd = Command::new("wsl.exe");
            cmd.arg("-d").arg(w.distro).arg("--").arg("git");
            cmd.arg("-c")
                .arg("core.quotepath=false")
                .arg("-C")
                .arg(w.linux_path);
            cmd
        }
        None => {
            let mut cmd = Command::new("git");
            cmd.arg("-c")
                .arg("core.quotepath=false")
                .arg("-C")
                .arg(path);
            cmd
        }
    };
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Run `git -C <path> <args>` without flashing a console window.
fn git(path: &str, args: &[&str]) -> Result<String, String> {
    match git_command(path, args).output() {
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
    match git_command(path, args).output() {
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
///
/// `--all` alone makes `git log` walk every ref's full history before
/// emitting a single commit, which is why the graph never finished loading on
/// a repo with many branches (T-0408). Unless `show_all` is set, the walk is
/// restricted to `extra_branches` plus the dynamically-computed default refs
/// (HEAD, the default branch, and their upstreams — see
/// `default_log_ref_candidates`). `request_id` identifies this load so a slow
/// one can be killed from the frontend via `cancel_log`.
pub fn read_log(
    path: &str,
    limit: u32,
    skip: u32,
    extra_branches: &[String],
    show_all: bool,
    request_id: &str,
) -> Result<GitLog, String> {
    let max_count_arg = format!("--max-count={}", limit.saturating_add(1));
    let skip_arg = format!("--skip={skip}");

    let resolved_refs = if show_all {
        Vec::new()
    } else {
        let candidates = default_log_ref_candidates(path);
        build_log_ref_args(&candidates, extra_branches, |r| {
            git(path, &["rev-parse", "--verify", "--quiet", r]).is_ok()
        })
    };
    let ref_args = log_ref_positional_args(show_all, &resolved_refs);

    let mut args: Vec<&str> = vec!["log", "--exclude=refs/stash"];
    args.extend(ref_args.iter().map(String::as_str));
    args.push("--topo-order");
    args.push("--decorate=full");
    args.push(&max_count_arg);
    args.push(&skip_arg);
    args.push("--pretty=format:%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e");

    let started = Instant::now();
    let raw = git_log_tracked(path, &args, request_id);
    let elapsed = started.elapsed();
    // A load the user cancelled for being too slow is the case the index
    // helps most, so the slow-load trigger must fire on failure too.
    let raw = raw.inspect_err(|_| maybe_write_commit_graph(path, elapsed))?;

    let mut commits = parse_log_records(&raw);
    let has_more = commits.len() > limit as usize;
    commits.truncate(limit as usize);

    let head = git(path, &["rev-parse", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let current_branch = git(path, &["symbolic-ref", "--short", "-q", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default(); // detached HEAD (or unborn branch with no ref yet)
    let uncommitted = worktree_change_count(path);

    maybe_write_commit_graph(path, elapsed);

    Ok(GitLog {
        commits,
        head,
        current_branch,
        uncommitted,
        has_more,
    })
}

/// The default refs `read_log` would use with no extra branches selected —
/// exposed so the branch-filter popover can show them as always-on rather
/// than making the user re-discover which branches those are.
pub fn default_log_refs(path: &str) -> Vec<String> {
    let candidates = default_log_ref_candidates(path);
    build_log_ref_args(&candidates, &[], |r| {
        git(path, &["rev-parse", "--verify", "--quiet", r]).is_ok()
    })
}

/// Default refs shown in the graph when not showing everything: HEAD, the
/// repo's default branch, and the upstreams of HEAD's branch and of the
/// default branch, when they exist. Resolved fresh on every call — never
/// persisted, since the right answer can change as branches/remotes do.
///
/// The default branch resolves in order: `origin/HEAD` (kept as the
/// remote-tracking name, e.g. `origin/main`, since that is guaranteed to
/// exist) → else the local `main` → else the local `master`.
fn default_log_ref_candidates(path: &str) -> Vec<String> {
    let mut out = vec!["HEAD".to_string()];

    let default_branch = git(
        path,
        &["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .or_else(|| {
        if git(
            path,
            &["rev-parse", "--verify", "--quiet", "refs/heads/main"],
        )
        .is_ok()
        {
            Some("main".to_string())
        } else if git(
            path,
            &["rev-parse", "--verify", "--quiet", "refs/heads/master"],
        )
        .is_ok()
        {
            Some("master".to_string())
        } else {
            None
        }
    });

    if let Some(db) = &default_branch {
        out.push(db.clone());
    }

    if let Ok(cur) = git(path, &["symbolic-ref", "--short", "-q", "HEAD"]) {
        let cur = cur.trim();
        if !cur.is_empty() {
            if let Some(up) = upstream_of(path, cur) {
                out.push(up);
            }
        }
    }
    if let Some(db) = &default_branch {
        if let Some(up) = upstream_of(path, db) {
            out.push(up);
        }
    }

    out
}

/// The upstream ref of a local branch (e.g. `origin/main`), or `None` when it
/// has no upstream configured (or `branch` is itself a remote-tracking ref,
/// which has no `@{u}` of its own).
fn upstream_of(path: &str, branch: &str) -> Option<String> {
    git(
        path,
        &["rev-parse", "--abbrev-ref", &format!("{branch}@{{u}}")],
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
}

/// Build the ordered, de-duplicated ref list to pass to `git log`, from the
/// resolved default-ref candidates plus the user's extra branches. `exists`
/// checks each candidate against the repo (`git rev-parse --verify`); a
/// candidate that fails it is dropped from *this* `git log` call only — it is
/// never removed from settings, since the branch may simply not exist yet
/// (or any more) on this checkout. Falls back to `["HEAD"]` when nothing in
/// the combined list survives.
fn build_log_ref_args<F: Fn(&str) -> bool>(
    default_candidates: &[String],
    extra_branches: &[String],
    exists: F,
) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for r in default_candidates.iter().chain(extra_branches.iter()) {
        let r = r.trim();
        if r.is_empty() || !seen.insert(r.to_string()) {
            continue;
        }
        if exists(r) {
            out.push(r.to_string());
        }
    }
    if out.is_empty() {
        out.push("HEAD".to_string());
    }
    out
}

/// The positional ref arguments `git log` receives: `--all` (every ref) when
/// showing everything, or the explicit resolved list otherwise.
fn log_ref_positional_args(show_all: bool, resolved_refs: &[String]) -> Vec<String> {
    if show_all {
        vec!["--all".to_string()]
    } else {
        resolved_refs.to_vec()
    }
}

/// Registry of in-flight `git log` child processes, keyed by the frontend's
/// `request_id`, so `cancel_log` can find and kill one.
fn log_process_registry() -> &'static Mutex<HashMap<String, u32>> {
    static REG: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Request ids killed via `cancel_log`, so the process that was waiting on
/// them can tell "killed on purpose" apart from an ordinary git failure.
fn log_cancelled_registry() -> &'static Mutex<HashSet<String>> {
    static REG: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Kill the `git log` started under `request_id`, if one is still running.
/// Best-effort: on Windows this terminates the process tree via `taskkill`,
/// but a `git log` routed through `wsl.exe` (see `git_command`, for WSL share
/// paths) may leave the in-distro git process running — killing the Windows
/// wrapper is the best that can be done without a matching in-distro kill.
pub fn cancel_log(request_id: &str) {
    let pid = log_process_registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(request_id);
    if let Some(pid) = pid {
        log_cancelled_registry()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(request_id.to_string());
        kill_pid(pid);
    }
}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd.output();
}

#[cfg(not(windows))]
fn kill_pid(pid: u32) {
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
}

/// Run a `git log` invocation as a tracked, killable child process (see
/// `cancel_log`), returning its stdout on success. A process killed via
/// `cancel_log` returns `Err("cancelled")`, which the frontend recognizes and
/// does not surface as a load failure.
fn git_log_tracked(path: &str, args: &[&str], request_id: &str) -> Result<String, String> {
    let mut cmd = git_command(path, args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Err(format!("failed to run git: {e}")),
    };
    let pid = child.id();
    log_process_registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(request_id.to_string(), pid);

    let out = child.wait_with_output();

    log_process_registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(request_id);

    match out {
        Ok(out) if out.status.success() => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
        Ok(out) => {
            let was_cancelled = log_cancelled_registry()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(request_id);
            if was_cancelled {
                Err("cancelled".to_string())
            } else {
                let err = String::from_utf8_lossy(&out.stderr).into_owned();
                let err = err.trim();
                Err(if err.is_empty() {
                    "git log failed".to_string()
                } else {
                    err.to_string()
                })
            }
        }
        Err(e) => Err(format!("failed to run git: {e}")),
    }
}

/// Repository paths a `commit-graph write` has already been attempted for
/// during this app run (see `maybe_write_commit_graph`).
fn commit_graph_attempted() -> &'static Mutex<HashSet<String>> {
    static DONE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    DONE.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Whether a `commit-graph write` is worth doing after a log load just
/// finished: either the repo has no commit-graph file yet, or the load was
/// slow enough that one would clearly have helped.
fn should_write_commit_graph(has_commit_graph: bool, load_duration: Duration) -> bool {
    const SLOW_THRESHOLD: Duration = Duration::from_secs(3);
    !has_commit_graph || load_duration > SLOW_THRESHOLD
}

/// UNC paths (`\\server\share`, `\\wsl.localhost\...`) and mapped network
/// drives are excluded from the automatic `commit-graph write`: a write over
/// a slow or unreliable share can itself become the thing making the repo
/// slow, and the win is smallest exactly where the read is already routed
/// through `wsl.exe` or a share.
fn is_network_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    normalized.starts_with("//") || is_mapped_network_drive(&normalized)
}

#[cfg(windows)]
fn is_mapped_network_drive(normalized_path: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;
    use windows::Win32::System::WindowsProgramming::DRIVE_REMOTE;

    let mut chars = normalized_path.chars();
    let Some(drive_letter) = chars.next() else {
        return false;
    };
    if !drive_letter.is_ascii_alphabetic() || chars.next() != Some(':') {
        return false;
    }
    let root = format!("{drive_letter}:\\");
    let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    let drive_type = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
    drive_type == DRIVE_REMOTE
}

#[cfg(not(windows))]
fn is_mapped_network_drive(_normalized_path: &str) -> bool {
    false
}

/// Whether the repo already has a commit-graph file, resolved via
/// `git rev-parse --git-common-dir` so a linked worktree checks the main
/// repository's shared `objects/info/` rather than its own per-worktree dir.
fn commit_graph_file_present(path: &str) -> bool {
    let Ok(common_dir) = git(path, &["rev-parse", "--git-common-dir"]) else {
        return false;
    };
    let common_dir = common_dir.trim();
    if common_dir.is_empty() {
        return false;
    }
    let common_dir = std::path::Path::new(common_dir);
    let common_dir = if common_dir.is_absolute() {
        common_dir.to_path_buf()
    } else {
        std::path::Path::new(path).join(common_dir)
    };
    common_dir.join("objects/info/commit-graph").exists()
        || common_dir.join("objects/info/commit-graphs").is_dir()
}

/// After a log load, write a `commit-graph` in the background when warranted
/// (see `should_write_commit_graph`), at most once per repository path per
/// app run — this is the "at most once" reservation, made before the file
/// check so two loads racing on the same repo don't both spawn a write.
/// Never blocks the caller; failures go only to the diagnostic log, never
/// the UI (per `.claude/rules/diagnostic-logging.md`).
fn maybe_write_commit_graph(path: &str, load_duration: Duration) {
    if is_network_path(path) {
        return;
    }
    if commit_graph_attempted()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(path)
    {
        return;
    }

    // Decide before reserving the slot: a fast first load must not use up
    // the one write, or a later slow "show all" load could never trigger it.
    let has_commit_graph = commit_graph_file_present(path);
    if !should_write_commit_graph(has_commit_graph, load_duration) {
        return;
    }
    if !commit_graph_attempted()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(path.to_string())
    {
        return;
    }

    let path = path.to_string();
    std::thread::spawn(move || {
        if let Err(e) = git(&path, &["commit-graph", "write", "--reachable", "--split"]) {
            crate::diag!("commit-graph write failed for {path}: {e}");
        }
    });
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

/// The frontend's pseudo-hash for the uncommitted-changes row.
const WORKTREE_HASH: &str = "WORKTREE";

/// Hash of git's well-known empty tree, used as the diff base for root commits.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// Diff range for a commit (or the worktree pseudo-commit): first parent vs
/// the commit itself, the empty tree for a root commit, HEAD vs the worktree.
fn diff_range(path: &str, hash: &str) -> Result<Vec<String>, String> {
    if hash == WORKTREE_HASH {
        return Ok(vec!["HEAD".into()]);
    }
    let out = git(path, &["rev-list", "--parents", "-n", "1", hash])?;
    let mut ids = out.split_whitespace();
    ids.next(); // the commit itself
    let base = ids.next().unwrap_or(EMPTY_TREE).to_string();
    Ok(vec![base, hash.to_string()])
}

/// List the files changed by a commit (or by the uncommitted worktree,
/// including untracked files).
pub fn commit_files(path: &str, hash: &str) -> Result<Vec<CommitFileChange>, String> {
    if hash == WORKTREE_HASH {
        return worktree_files(path);
    }
    let range = diff_range(path, hash)?;
    tracked_files(path, &range)
}

/// Changed files for a diff range via paired `--name-status` / `--numstat`.
fn tracked_files(path: &str, range: &[String]) -> Result<Vec<CommitFileChange>, String> {
    let mut name_status_args = vec!["diff", "--name-status", "-M"];
    name_status_args.extend(range.iter().map(String::as_str));
    let name_status = git(path, &name_status_args)?;

    let mut numstat_args = vec!["diff", "--numstat", "-M"];
    numstat_args.extend(range.iter().map(String::as_str));
    let numstat = git(path, &numstat_args)?;

    Ok(parse_commit_files(&name_status, &numstat))
}

/// Uncommitted worktree changes: tracked modifications (staged + unstaged vs
/// HEAD) plus untracked files, so an in-progress repo — including brand-new
/// files an agent just created — is fully represented. `git diff HEAD` alone
/// omits untracked files, so they are listed separately and reported as "U"
/// (untracked), kept distinct from a tracked "A" (added) change.
fn worktree_files(path: &str) -> Result<Vec<CommitFileChange>, String> {
    let has_head = git(path, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok();
    let mut files = if has_head {
        tracked_files(path, &["HEAD".to_string()])?
    } else {
        Vec::new()
    };
    let others = git(path, &["ls-files", "--others", "--exclude-standard"])?;
    for line in others.lines().map(str::trim).filter(|l| !l.is_empty()) {
        files.push(CommitFileChange {
            path: line.to_string(),
            old_path: None,
            // Untracked file — reported as "U" (VS Code's Untracked marker) to
            // keep it distinct from a tracked "A" (added) change.
            status: "U".into(),
            additions: None,
            deletions: None,
        });
    }
    Ok(files)
}

/// How many uncommitted changes the working tree has, counted from the very
/// list the diff panel renders.
///
/// Deliberately not `git status --porcelain`: status and `git diff HEAD` do
/// not always agree. With `core.autocrlf=true` and `* text=auto`, a tracked
/// file left with LF endings in the working tree is reported as modified by
/// status while its HEAD, index and working-tree blobs are all the same hash,
/// so `git diff HEAD` produces nothing. Counting from status then showed a
/// "2 uncommitted changes" row whose file list was empty. Sharing one source
/// keeps the count and the detail view from disagreeing by construction.
pub fn worktree_change_count(path: &str) -> u32 {
    worktree_files(path).map(|f| f.len() as u32).unwrap_or(0)
}

/// Parse paired `git diff --name-status` / `--numstat` output (same flags →
/// same file order, so rows are joined by index).
fn parse_commit_files(name_status: &str, numstat: &str) -> Vec<CommitFileChange> {
    let counts: Vec<(Option<u32>, Option<u32>)> = numstat
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let mut f = l.splitn(3, '\t');
            let a = f.next().unwrap_or("-").trim().parse().ok();
            let d = f.next().unwrap_or("-").trim().parse().ok();
            (a, d)
        })
        .collect();

    name_status
        .lines()
        .filter(|l| !l.trim().is_empty())
        .enumerate()
        .map(|(i, l)| {
            let mut f = l.split('\t');
            let status_raw = f.next().unwrap_or("").trim();
            let status_char = status_raw.chars().next().unwrap_or('?');
            let first = f.next().unwrap_or("").to_string();
            let second = f.next().map(str::to_string);
            let (old_path, file_path) = match (status_char, second) {
                ('R' | 'C', Some(new_path)) => (Some(first), new_path),
                (_, _) => (None, first),
            };
            let (additions, deletions) = counts.get(i).copied().unwrap_or((None, None));
            CommitFileChange {
                path: file_path,
                old_path,
                status: status_char.to_string(),
                additions,
                deletions,
            }
        })
        .collect()
}

/// Unified diff of a single file within a commit (or the worktree). For an
/// untracked worktree file there is no HEAD blob to diff against, so it is
/// diffed against the empty file to render its full contents as additions.
pub fn commit_file_diff(
    path: &str,
    hash: &str,
    file: &str,
    old_file: Option<&str>,
) -> Result<String, String> {
    if hash == WORKTREE_HASH {
        let others = git(
            path,
            &["ls-files", "--others", "--exclude-standard", "--", file],
        )?;
        if !others.trim().is_empty() {
            return untracked_diff(path, file);
        }
    }
    let range = diff_range(path, hash)?;
    let mut args = vec!["diff", "-M"];
    args.extend(range.iter().map(String::as_str));
    args.push("--");
    if let Some(old) = old_file {
        args.push(old);
    }
    args.push(file);
    git(path, &args)
}

/// Diff an untracked file against the empty file. `git diff --no-index` exits
/// with status 1 when the inputs differ (as `diff(1)` does), which is the
/// normal case here, so its stdout is taken rather than treated as an error.
fn untracked_diff(path: &str, file: &str) -> Result<String, String> {
    match git_out_err(path, &["diff", "--no-index", "--", "/dev/null", file]) {
        Ok(out) => Ok(out),
        Err((stdout, stderr)) => {
            if stdout.is_empty() {
                Err(stderr.trim().to_string())
            } else {
                Ok(stdout)
            }
        }
    }
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
        GraphOp::Checkout { branch } => checkout(path, &branch),
        GraphOp::CheckoutCommit { hash } => checkout_commit(path, &hash),
        GraphOp::DiscardChanges { include_untracked } => discard_changes(path, include_untracked),
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
    // Status over-reports (see `worktree_change_count`), so a non-zero count is
    // re-measured against the diff. A clean repo — the common case — pays for
    // no extra git call.
    if info.changes > 0 {
        info.changes = worktree_change_count(path);
    }
    if let Ok(branches) = git(path, &["branch", "--format=%(refname:short)"]) {
        info.branches = branches
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
    }
    info
}

/// List local and remote branch names for the branch switcher, plus the
/// currently checked-out branch. Remote `*/HEAD` symrefs are excluded — they
/// are aliases, not checkoutable branches.
pub fn list_branches(path: &str) -> BranchList {
    let mut list = BranchList {
        current: read_status(path).branch,
        ..Default::default()
    };
    if let Ok(local) = git(path, &["branch", "--format=%(refname:short)"]) {
        list.local = local
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
    }
    if let Ok(remote) = git(path, &["branch", "-r", "--format=%(refname:short)"]) {
        list.remote = remote
            .lines()
            .map(|l| l.trim().to_string())
            // Keep only `<remote>/<branch>` names. A remote's HEAD symref shows
            // up as the bare remote name (e.g. `origin`, no slash) or as
            // `<remote>/HEAD`; neither is a checkoutable branch.
            .filter(|l| l.contains('/') && !l.ends_with("/HEAD"))
            .collect();
    }
    list
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

/// Check out a ref selected in the graph view. When `branch` names a
/// remote-tracking ref (e.g. `origin/main`), switch to the local branch that
/// tracks it, creating it if necessary — this is git's `--guess` (DWIM)
/// behavior. `git switch` refuses a bare remote ref, so we strip the remote
/// prefix and let git resolve the local branch.
pub fn checkout(path: &str, branch: &str) -> Result<String, String> {
    let remotes = git(path, &["remote"]).unwrap_or_default();
    let remote_names: Vec<&str> = remotes
        .lines()
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .collect();
    let local = strip_remote_prefix(&remote_names, branch).unwrap_or_else(|| branch.to_string());
    git(path, &["switch", "--guess", &local]).map(|_| format!("switched to {local}"))
}

/// Check out an arbitrary commit, leaving the repository on a detached HEAD.
pub fn checkout_commit(path: &str, hash: &str) -> Result<String, String> {
    git(path, &["checkout", "--detach", hash])
        .map(|_| format!("checked out {} (detached HEAD)", short_hash(hash)))
}

/// Discard all uncommitted changes (staged and unstaged). With
/// `include_untracked`, also delete untracked files and directories.
pub fn discard_changes(path: &str, include_untracked: bool) -> Result<String, String> {
    git(path, &["reset", "--hard", "HEAD"])?;
    if include_untracked {
        git(path, &["clean", "-fd"])?;
        return Ok("discarded all changes including untracked files".into());
    }
    Ok("discarded changes to tracked files".into())
}

/// Abbreviate a full commit hash for status messages.
fn short_hash(hash: &str) -> &str {
    if hash.len() > 7 {
        &hash[..7]
    } else {
        hash
    }
}

/// If `branch` begins with a known remote name (`<remote>/<name>`), return the
/// name with that remote prefix stripped so it can be resolved as a local
/// branch. Returns `None` for a local branch, or for a remote's `HEAD` symref
/// (which is not checkoutable).
fn strip_remote_prefix(remotes: &[&str], branch: &str) -> Option<String> {
    for remote in remotes {
        if let Some(rest) = branch.strip_prefix(&format!("{remote}/")) {
            if rest.is_empty() || rest == "HEAD" {
                return None;
            }
            return Some(rest.to_string());
        }
    }
    None
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

/// One entry parsed from `git worktree list --porcelain`, before enrichment.
struct RawWorktree {
    path: String,
    head: String,
    /// Short branch name (`refs/heads/` stripped); empty when detached/bare.
    branch: String,
    locked: bool,
    bare: bool,
    detached: bool,
}

/// Parse `git worktree list --porcelain` output into per-worktree records.
/// Entries are separated by blank lines; the first entry is always the repo's
/// main working tree.
fn parse_worktrees(porcelain: &str) -> Vec<RawWorktree> {
    let mut out: Vec<RawWorktree> = Vec::new();
    let mut cur: Option<RawWorktree> = None;
    for line in porcelain.lines() {
        let line = line.trim_end();
        if let Some(rest) = line.strip_prefix("worktree ") {
            if let Some(w) = cur.take() {
                out.push(w);
            }
            cur = Some(RawWorktree {
                path: rest.replace('\\', "/"),
                head: String::new(),
                branch: String::new(),
                locked: false,
                bare: false,
                detached: false,
            });
        } else if let Some(rest) = line.strip_prefix("HEAD ") {
            if let Some(w) = cur.as_mut() {
                w.head = rest.to_string();
            }
        } else if let Some(rest) = line.strip_prefix("branch ") {
            if let Some(w) = cur.as_mut() {
                w.branch = rest.strip_prefix("refs/heads/").unwrap_or(rest).to_string();
            }
        } else if line == "detached" {
            if let Some(w) = cur.as_mut() {
                w.detached = true;
            }
        } else if line == "bare" {
            if let Some(w) = cur.as_mut() {
                w.bare = true;
            }
        } else if line == "locked" || line.starts_with("locked ") {
            if let Some(w) = cur.as_mut() {
                w.locked = true;
            }
        }
    }
    if let Some(w) = cur.take() {
        out.push(w);
    }
    out
}

/// List the git worktrees of `repo_path`, enriched with the owning repo's
/// name, a derived task id (from a `task/<id>` branch), and a per-worktree
/// dirty flag. The first worktree (the repo's main working tree) is flagged
/// `is_main` and left un-enriched with a dirty check.
pub fn list_worktrees(
    repo_path: &str,
    repo_name: &str,
) -> Result<Vec<crate::models::Worktree>, String> {
    let raw = git(repo_path, &["worktree", "list", "--porcelain"])?;
    let parsed = parse_worktrees(&raw);
    let out = parsed
        .into_iter()
        .enumerate()
        .map(|(i, w)| {
            let is_main = i == 0;
            let task_id = w.branch.strip_prefix("task/").map(str::to_string);
            // Only linked (non-main) worktrees are cleanup candidates, so only
            // they pay for a status check.
            let dirty = if is_main || w.bare {
                false
            } else {
                worktree_change_count(&w.path) > 0
            };
            crate::models::Worktree {
                path: w.path,
                repo_path: repo_path.to_string(),
                repo_name: repo_name.to_string(),
                branch: w.branch,
                head: w.head,
                is_main,
                bare: w.bare,
                locked: w.locked,
                detached: w.detached,
                dirty,
                task_id,
            }
        })
        .collect();
    Ok(out)
}

/// Remove a linked worktree. `git worktree remove` refuses a worktree with
/// uncommitted or untracked changes unless `force` is set.
pub fn remove_worktree(
    repo_path: &str,
    worktree_path: &str,
    force: bool,
) -> Result<String, String> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);
    git(repo_path, &args).map(|_| format!("removed worktree {worktree_path}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A repo whose only "change" is a CRLF-converted file rewritten with LF
    /// endings: `git status` reports it as modified, `git diff HEAD` finds
    /// nothing. The count must follow the diff, or the graph shows an
    /// uncommitted-changes row with an empty file list.
    #[test]
    fn crlf_only_difference_is_not_counted_as_a_change() {
        let dir = std::env::temp_dir().join(format!(
            "workhub-git-crlf-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().to_string();

        for args in [
            vec!["init", "-q", "."],
            vec!["config", "core.autocrlf", "true"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "test"],
        ] {
            git(&path, &args).unwrap();
        }
        std::fs::write(dir.join(".gitattributes"), "* text=auto\n").unwrap();
        std::fs::write(dir.join("f.txt"), "a\nb\n").unwrap();
        git(&path, &["add", "-A"]).unwrap();
        git(&path, &["commit", "-qm", "init"]).unwrap();

        // Re-checkout so the index records the CRLF working-tree stat, then
        // write the file back with LF endings — same blob, different stat.
        std::fs::remove_file(dir.join("f.txt")).unwrap();
        git(&path, &["checkout", "--", "f.txt"]).unwrap();
        std::fs::write(dir.join("f.txt"), "a\nb\n").unwrap();

        let status = git(&path, &["status", "--porcelain"]).unwrap();
        assert!(
            status.contains("f.txt"),
            "expected status to over-report the file, got {status:?}"
        );
        assert_eq!(worktree_change_count(&path), 0);

        // A real edit is still counted, and so is an untracked file.
        std::fs::write(dir.join("f.txt"), "a\nb\nc\n").unwrap();
        std::fs::write(dir.join("new.txt"), "hello\n").unwrap();
        assert_eq!(worktree_change_count(&path), 2);

        std::fs::remove_dir_all(&dir).ok();
    }

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
    fn short_hash_abbreviates_long_hashes_only() {
        assert_eq!(short_hash("0123456789abcdef"), "0123456");
        assert_eq!(short_hash("0123456"), "0123456");
        assert_eq!(short_hash("abc"), "abc");
    }

    #[test]
    fn strips_remote_prefix_for_remote_tracking_ref() {
        let remotes = ["origin", "upstream"];
        assert_eq!(
            strip_remote_prefix(&remotes, "origin/main"),
            Some("main".to_string())
        );
        // Nested branch names keep everything after the remote.
        assert_eq!(
            strip_remote_prefix(&remotes, "origin/feature/x"),
            Some("feature/x".to_string())
        );
        assert_eq!(
            strip_remote_prefix(&remotes, "upstream/dev"),
            Some("dev".to_string())
        );
    }

    #[test]
    fn strip_remote_prefix_ignores_local_and_head() {
        let remotes = ["origin"];
        // A local branch name is returned untouched (None -> caller keeps it).
        assert_eq!(strip_remote_prefix(&remotes, "main"), None);
        // A remote HEAD symref is not checkoutable.
        assert_eq!(strip_remote_prefix(&remotes, "origin/HEAD"), None);
        // A branch that merely shares a prefix but no `/` is not a remote ref.
        assert_eq!(strip_remote_prefix(&remotes, "origin-mirror"), None);
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
    fn parses_commit_files_with_rename_and_binary() {
        let name_status =
            "M\tsrc/app.rs\nR100\told/name.rs\tnew/name.rs\nA\tassets/icon.png\nD\tREADME.md\n";
        let numstat =
            "10\t2\tsrc/app.rs\n0\t0\t{old => new}/name.rs\n-\t-\tassets/icon.png\n0\t5\tREADME.md\n";
        let files = parse_commit_files(name_status, numstat);
        assert_eq!(files.len(), 4);

        assert_eq!(files[0].path, "src/app.rs");
        assert_eq!(files[0].status, "M");
        assert_eq!(files[0].old_path, None);
        assert_eq!(files[0].additions, Some(10));
        assert_eq!(files[0].deletions, Some(2));

        assert_eq!(files[1].path, "new/name.rs");
        assert_eq!(files[1].status, "R");
        assert_eq!(files[1].old_path.as_deref(), Some("old/name.rs"));

        assert_eq!(files[2].path, "assets/icon.png");
        assert_eq!(files[2].status, "A");
        assert_eq!(files[2].additions, None);
        assert_eq!(files[2].deletions, None);

        assert_eq!(files[3].path, "README.md");
        assert_eq!(files[3].status, "D");
        assert_eq!(files[3].deletions, Some(5));
    }

    #[test]
    fn parses_commit_files_preserves_non_ascii_path() {
        // With `core.quotepath=false`, git emits Japanese paths as raw UTF-8
        // (no octal escaping, no surrounding quotes), so the path round-trips.
        let name_status = "M\ttasks/T-0042 repos の git graph 改善.md\n";
        let numstat = "3\t1\ttasks/T-0042 repos の git graph 改善.md\n";
        let files = parse_commit_files(name_status, numstat);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "tasks/T-0042 repos の git graph 改善.md");
        assert_eq!(files[0].status, "M");
        assert_eq!(files[0].additions, Some(3));
        assert_eq!(files[0].deletions, Some(1));
    }

    #[test]
    fn parses_commit_files_tolerates_count_mismatch() {
        let files = parse_commit_files("M\ta.txt\n", "");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].additions, None);
        assert_eq!(files[0].deletions, None);
    }

    #[test]
    fn reset_rejects_invalid_mode() {
        let err = reset("C:/does/not/matter", "abc123", "nope").unwrap_err();
        assert!(err.contains("invalid reset mode"));
    }

    #[test]
    fn parses_worktree_porcelain() {
        let porcelain = "worktree C:/repos/workhub\nHEAD aaaa\nbranch refs/heads/main\n\nworktree C:/repos/.worktrees/T-0018/workhub\nHEAD bbbb\nbranch refs/heads/task/T-0018\n\nworktree C:/repos/.worktrees/detached\nHEAD cccc\ndetached\nlocked\n";
        let ws = parse_worktrees(porcelain);
        assert_eq!(ws.len(), 3);

        assert_eq!(ws[0].path, "C:/repos/workhub");
        assert_eq!(ws[0].branch, "main");
        assert!(!ws[0].detached);

        assert_eq!(ws[1].path, "C:/repos/.worktrees/T-0018/workhub");
        assert_eq!(ws[1].branch, "task/T-0018");
        assert_eq!(ws[1].head, "bbbb");

        assert!(ws[2].branch.is_empty());
        assert!(ws[2].detached);
        assert!(ws[2].locked);
    }

    // ---- T-0408: branch filter + commit-graph auto-write ----

    #[test]
    fn build_log_ref_args_includes_default_and_extra_branches() {
        let defaults = vec!["HEAD".to_string(), "main".to_string()];
        let extras = vec!["feature/x".to_string()];
        let refs = build_log_ref_args(&defaults, &extras, |_| true);
        assert_eq!(refs, vec!["HEAD", "main", "feature/x"]);
    }

    #[test]
    fn build_log_ref_args_dedupes_overlapping_extra_branch() {
        let defaults = vec!["HEAD".to_string(), "main".to_string()];
        // The user picked "main" as an extra branch too — it must not repeat.
        let extras = vec!["main".to_string(), "feature/x".to_string()];
        let refs = build_log_ref_args(&defaults, &extras, |_| true);
        assert_eq!(refs, vec!["HEAD", "main", "feature/x"]);
    }

    #[test]
    fn build_log_ref_args_drops_refs_that_do_not_exist() {
        let defaults = vec!["HEAD".to_string(), "main".to_string()];
        let extras = vec!["deleted-branch".to_string()];
        let refs = build_log_ref_args(&defaults, &extras, |r| r != "deleted-branch");
        assert_eq!(refs, vec!["HEAD", "main"]);
    }

    #[test]
    fn build_log_ref_args_falls_back_to_head_when_nothing_survives() {
        let defaults = vec!["main".to_string()];
        let extras = vec!["gone".to_string()];
        let refs = build_log_ref_args(&defaults, &extras, |_| false);
        assert_eq!(refs, vec!["HEAD"]);
    }

    #[test]
    fn log_ref_positional_args_uses_all_flag_when_showing_everything() {
        let resolved = vec!["HEAD".to_string(), "main".to_string()];
        assert_eq!(log_ref_positional_args(true, &resolved), vec!["--all"]);
        assert_eq!(log_ref_positional_args(false, &resolved), resolved);
    }

    #[test]
    fn should_write_commit_graph_when_file_missing() {
        assert!(should_write_commit_graph(false, Duration::from_millis(50)));
    }

    #[test]
    fn should_write_commit_graph_when_load_was_slow() {
        assert!(should_write_commit_graph(true, Duration::from_secs(4)));
    }

    #[test]
    fn should_not_write_commit_graph_when_present_and_fast() {
        assert!(!should_write_commit_graph(true, Duration::from_millis(200)));
    }

    #[test]
    fn unc_paths_are_excluded_from_commit_graph_auto_write() {
        assert!(is_network_path(r"\\wsl.localhost\Ubuntu\home\user\repo"));
        assert!(is_network_path("//server/share/repo"));
        assert!(!is_network_path("C:/repos/workhub"));
    }

    #[test]
    fn commit_graph_attempted_registry_reserves_a_repo_path_once() {
        let path = format!(
            "test-repo-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let mut attempted = commit_graph_attempted().lock().unwrap();
        assert!(attempted.insert(path.clone()), "first reservation succeeds");
        assert!(
            !attempted.insert(path.clone()),
            "second reservation is refused"
        );
    }

    #[test]
    fn commit_graph_file_present_reflects_a_real_repo() {
        let dir = std::env::temp_dir().join(format!(
            "workhub-git-commit-graph-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().to_string();

        for args in [
            vec!["init", "-q", "."],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "test"],
        ] {
            git(&path, &args).unwrap();
        }
        std::fs::write(dir.join("f.txt"), "a\n").unwrap();
        git(&path, &["add", "-A"]).unwrap();
        git(&path, &["commit", "-qm", "init"]).unwrap();

        assert!(!commit_graph_file_present(&path));
        git(&path, &["commit-graph", "write", "--reachable"]).unwrap();
        assert!(commit_graph_file_present(&path));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn cancel_log_of_an_unknown_request_id_is_a_no_op() {
        // No process was ever registered under this id — cancelling it must
        // not panic (e.g. on a poisoned/missing registry entry).
        cancel_log("no-such-request-id");
    }
}
