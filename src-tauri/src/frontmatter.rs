//! The frontmatter fence reader shared by task files and vault notes.
//!
//! `split_frontmatter` cuts `---\n<frontmatter>\n---\n<body>` into its two
//! halves and keeps the body byte-for-byte; `unquote` strips one pair of
//! matching quotes from a scalar. Both used to exist twice, in `tasks.rs`
//! (returning a `Result` with a message) and in `vault_note.rs` (returning an
//! `Option`); this module holds the one copy and each caller adapts the result.
//!
//! Deliberately small and dependency-free so that `tasks.rs`, `vault_note.rs`
//! and `vault_template.rs` can all use it without pointing at each other.
//! `persona.rs` and `plugins.rs` read frontmatter under different contracts
//! (flat only, tolerant of a malformed block) and keep their own readers.

use std::fmt;

/// Why a file has no readable frontmatter block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrontmatterError {
    /// The first line is not `---` (or the file is empty).
    Missing,
    /// The opening `---` has no closing one.
    Unclosed,
}

impl fmt::Display for FrontmatterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Missing => "file does not start with a frontmatter block",
            Self::Unclosed => "frontmatter block is not closed",
        })
    }
}

/// Splits `---\n<frontmatter>\n---\n<body>` into (frontmatter text, body).
/// The body is the exact remainder of the file, byte-for-byte.
pub fn split_frontmatter(content: &str) -> Result<(String, String), FrontmatterError> {
    let mut lines = content.split_inclusive('\n');
    let first = lines.next().unwrap_or("");
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return Err(FrontmatterError::Missing);
    }
    let mut consumed = first.len();
    let mut front = String::new();
    let mut closed = false;
    for line in lines {
        consumed += line.len();
        if line.trim_end_matches(['\r', '\n']) == "---" {
            closed = true;
            break;
        }
        front.push_str(line);
    }
    if !closed {
        return Err(FrontmatterError::Unclosed);
    }
    Ok((front, content[consumed..].to_string()))
}

/// Trims `s` and strips one pair of matching `"` or `'` around it.
pub fn unquote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 {
        let bytes = s.as_bytes();
        if (bytes[0] == b'"' && bytes[s.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[s.len() - 1] == b'\'')
        {
            return s[1..s.len() - 1].to_string();
        }
    }
    s.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_the_fence_and_keeps_the_body_byte_for_byte() {
        let (front, body) = split_frontmatter("---\na: 1\nb: 2\n---\n\nbody\r\n  tail").unwrap();
        assert_eq!(front, "a: 1\nb: 2\n");
        assert_eq!(body, "\nbody\r\n  tail");
    }

    #[test]
    fn crlf_fences_are_recognised_and_stay_in_the_halves() {
        let (front, body) = split_frontmatter("---\r\na: 1\r\n---\r\nbody").unwrap();
        assert_eq!(front, "a: 1\r\n");
        assert_eq!(body, "body");
    }

    #[test]
    fn an_empty_block_and_an_empty_body_are_fine() {
        assert_eq!(
            split_frontmatter("---\n---\n").unwrap(),
            (String::new(), String::new())
        );
        assert_eq!(
            split_frontmatter("---\na: 1\n---").unwrap(),
            ("a: 1\n".to_string(), String::new())
        );
    }

    #[test]
    fn a_file_that_does_not_open_with_a_fence_is_missing() {
        for text in [
            "",
            "no frontmatter",
            "\n---\na: 1\n---\n",
            "--- \na: 1\n---\n",
        ] {
            assert_eq!(
                split_frontmatter(text),
                Err(FrontmatterError::Missing),
                "{text:?}"
            );
        }
    }

    #[test]
    fn an_unterminated_block_is_unclosed() {
        assert_eq!(
            split_frontmatter("---\na: 1\n"),
            Err(FrontmatterError::Unclosed)
        );
        assert_eq!(split_frontmatter("---\n"), Err(FrontmatterError::Unclosed));
    }

    /// The task reader reported these messages before the split was shared.
    #[test]
    fn the_error_messages_are_the_ones_the_task_reader_used() {
        assert_eq!(
            FrontmatterError::Missing.to_string(),
            "file does not start with a frontmatter block"
        );
        assert_eq!(
            FrontmatterError::Unclosed.to_string(),
            "frontmatter block is not closed"
        );
    }

    #[test]
    fn unquote_strips_one_matching_pair_and_trims() {
        assert_eq!(unquote("  \"a b\" "), "a b");
        assert_eq!(unquote("'a'"), "a");
        assert_eq!(unquote("\"a'"), "\"a'");
        assert_eq!(unquote("\""), "\"");
        assert_eq!(unquote("\"\""), "");
        assert_eq!(unquote("plain"), "plain");
    }
}
