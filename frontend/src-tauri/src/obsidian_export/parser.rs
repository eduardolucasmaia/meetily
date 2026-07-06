use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsidianFile {
    pub filename: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ObsidianExportPayload {
    pub files: Vec<ObsidianFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianExportResult {
    pub exported_path: String,
    pub file_count: usize,
}

/// Strip markdown code fences and parse LLM output (JSON or delimiter format).
pub fn parse_obsidian_response(raw: &str) -> Result<Vec<ObsidianFile>, String> {
    let trimmed = raw.trim();
    let body = strip_code_fences(trimmed);

    if body.contains("===FILE:") {
        if let Ok(files) = parse_delimiter_format(body) {
            if !files.is_empty() {
                return Ok(files);
            }
        }
    }

    let repaired = repair_json_string_literals(body);
    let closed = close_truncated_json(&repaired);

    let mut last_err = String::new();
    for candidate in [body, repaired.as_str(), closed.as_str()] {
        match parse_json_payload(candidate) {
            Ok(files) => return Ok(files),
            Err(e) => last_err = e,
        }
    }

    for candidate in [body, repaired.as_str(), closed.as_str()] {
        match extract_files_lenient(candidate) {
            Ok(files) => return Ok(files),
            Err(e) => last_err = e,
        }
    }

    Err(last_err)
}

fn parse_json_payload(json_str: &str) -> Result<Vec<ObsidianFile>, String> {
    let payload: ObsidianExportPayload = serde_json::from_str(json_str).map_err(|e| {
        format!(
            "Failed to parse Obsidian export JSON: {}. Response preview: {}",
            e,
            json_str.chars().take(200).collect::<String>()
        )
    })?;

    if payload.files.is_empty() {
        return Err("AI returned no files to export".to_string());
    }

    Ok(payload.files)
}

/// Delimiter format fallback when JSON is unreliable.
///
/// ```text
/// ===FILE: Note Name.md===
/// markdown body
/// ===END===
/// ```
pub fn parse_delimiter_format(input: &str) -> Result<Vec<ObsidianFile>, String> {
    const MARKER: &str = "===FILE:";
    const END: &str = "===END===";

    let mut files = Vec::new();
    let mut rest = input;

    while let Some(start) = rest.find(MARKER) {
        let after_marker = &rest[start + MARKER.len()..];
        let header_end = after_marker
            .find("===")
            .ok_or_else(|| "Invalid delimiter format: missing header terminator".to_string())?;
        let filename = after_marker[..header_end].trim();
        if filename.is_empty() {
            return Err("Invalid delimiter format: empty filename".to_string());
        }

        let body_start = &after_marker[header_end + 3..];
        let (content, consumed) = if let Some(end_pos) = body_start.find(END) {
            (body_start[..end_pos].trim().to_string(), end_pos + END.len())
        } else {
            (body_start.trim().to_string(), body_start.len())
        };

        if !content.is_empty() {
            files.push(ObsidianFile {
                filename: filename.to_string(),
                content,
            });
        }

        rest = &body_start[consumed..];
    }

    if files.is_empty() {
        return Err("No files found in delimiter format response".to_string());
    }

    Ok(files)
}

/// Scan for repeated `"filename"` / `"content"` pairs even when JSON is malformed or truncated.
fn extract_files_lenient(input: &str) -> Result<Vec<ObsidianFile>, String> {
    let mut files = Vec::new();
    let mut search_from = 0;

    while let Some(rel) = input[search_from..].find("\"filename\"") {
        let key_pos = search_from + rel;
        let Some((filename, after_filename)) = read_json_string_value(input, key_pos + "\"filename\"".len())
        else {
            break;
        };

        let content_key = input[after_filename..]
            .find("\"content\"")
            .map(|p| after_filename + p);
        let Some(content_key_pos) = content_key else {
            break;
        };

        let Some((content, next_pos)) =
            read_json_string_value(input, content_key_pos + "\"content\"".len())
        else {
            break;
        };

        if !filename.trim().is_empty() && !content.trim().is_empty() {
            files.push(ObsidianFile { filename, content });
        }

        search_from = next_pos;
    }

    if files.is_empty() {
        return Err("Could not extract any files from LLM response".to_string());
    }

    Ok(files)
}

fn read_json_string_value(input: &str, from: usize) -> Option<(String, usize)> {
    let tail = input.get(from..)?;
    let mut iter = tail.char_indices().peekable();

    while let Some((_, ch)) = iter.next() {
        if !ch.is_whitespace() && ch != ':' {
            return None;
        }
        if ch == ':' {
            break;
        }
    }

    while let Some((_, ch)) = iter.peek() {
        if ch.is_whitespace() {
            iter.next();
            continue;
        }
        if *ch != '"' {
            return None;
        }
        break;
    }

    let (quote_idx, _) = iter.next()?;
    let value_start = from + quote_idx + 1;
    read_json_string_at(input, value_start)
}

fn read_json_string_at(input: &str, value_start: usize) -> Option<(String, usize)> {
    let mut out = String::new();
    let mut escape = false;
    let mut chars = input[value_start..].char_indices();

    while let Some((offset, ch)) = chars.next() {
        if escape {
            match ch {
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                'u' => {
                    let rest = &input[value_start + offset + 1..];
                    if rest.len() >= 4 {
                        if let Ok(code) = u32::from_str_radix(&rest[..4], 16) {
                            if let Some(c) = char::from_u32(code) {
                                out.push(c);
                            }
                        }
                    }
                }
                other => out.push(other),
            }
            escape = false;
            continue;
        }

        if ch == '\\' {
            escape = true;
            continue;
        }

        if ch == '"' {
            return Some((out, value_start + offset + 1));
        }

        out.push(ch);
    }

    // Truncated response: accept partial content
    if !out.is_empty() {
        Some((out, input.len()))
    } else {
        None
    }
}

/// Escape raw control characters inside JSON string literals (common LLM mistake).
fn repair_json_string_literals(json: &str) -> String {
    let mut out = String::with_capacity(json.len() + json.len() / 8);
    let mut in_string = false;
    let mut escape_next = false;

    for ch in json.chars() {
        if escape_next {
            out.push(ch);
            escape_next = false;
            continue;
        }

        if ch == '\\' && in_string {
            out.push(ch);
            escape_next = true;
            continue;
        }

        if ch == '"' {
            in_string = !in_string;
            out.push(ch);
            continue;
        }

        if in_string {
            match ch {
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c if c.is_control() => {
                    out.push_str(&format!("\\u{:04x}", c as u32));
                }
                c => out.push(c),
            }
        } else {
            out.push(ch);
        }
    }

    out
}

/// Close an unterminated JSON string and any open arrays/objects (truncated LLM output).
fn close_truncated_json(json: &str) -> String {
    let mut s = json.to_string();
    let mut in_string = false;
    let mut escape_next = false;

    for ch in s.chars() {
        if escape_next {
            escape_next = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape_next = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
        }
    }

    if in_string {
        s.push('"');
    }

    let open_brackets = s.chars().filter(|c| *c == '[').count();
    let close_brackets = s.chars().filter(|c| *c == ']').count();
    let open_braces = s.chars().filter(|c| *c == '{').count();
    let close_braces = s.chars().filter(|c| *c == '}').count();

    for _ in 0..open_brackets.saturating_sub(close_brackets) {
        s.push(']');
    }
    for _ in 0..open_braces.saturating_sub(close_braces) {
        s.push('}');
    }

    s
}

fn strip_code_fences(input: &str) -> &str {
    let mut s = input.trim();
    if s.starts_with("```") {
        if let Some(rest) = s.strip_prefix("```json") {
            s = rest.trim_start();
        } else if let Some(rest) = s.strip_prefix("```") {
            s = rest.trim_start();
        }
        if let Some(body) = s.strip_suffix("```") {
            s = body.trim();
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_json() {
        let raw = r##"{"files":[{"filename":"Note.md","content":"# Hello"}]}"##;
        let files = parse_obsidian_response(raw).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].filename, "Note.md");
        assert_eq!(files[0].content, "# Hello");
    }

    #[test]
    fn parse_json_with_fences() {
        let raw = "```json\n{\"files\":[{\"filename\":\"A.md\",\"content\":\"x\"}]}\n```";
        let files = parse_obsidian_response(raw).unwrap();
        assert_eq!(files.len(), 1);
    }

    #[test]
    fn parse_json_with_literal_newlines_in_content() {
        let raw = r##"{"files":[{"filename":"Note.md","content":"---
title: Test
date: 2026-07-06

Body"}]}"##;
        let files = parse_obsidian_response(raw).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].content.contains("title: Test"));
        assert!(files[0].content.contains('\n'));
    }

    #[test]
    fn parse_truncated_json_via_lenient_extractor() {
        let raw = r#"{"files":[{"filename":"Meeting.md","content":"---
title: Test

# Summary
Partial content without closing quote"#;
        let files = parse_obsidian_response(raw).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].content.contains("Partial content"));
    }

    #[test]
    fn parse_duplicate_filename_fields_leniently() {
        let raw = r#"{"files":[{"filename":"A.md","content":"first","filename":"B.md","content":"second"}]}"#;
        let files = parse_obsidian_response(raw).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].filename, "A.md");
        assert_eq!(files[1].filename, "B.md");
    }

    #[test]
    fn parses_delimiter_format_response() {
        let raw = r#"===FILE: Main.md===
# Title

Body
===END===
===FILE: Actions.md===
- item
===END===" "#;
        let files = parse_delimiter_format(raw).unwrap();
        assert_eq!(files.len(), 2);
        assert!(files[0].content.contains("# Title"));
    }
}
