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

/// Strip markdown code fences and parse JSON payload from LLM output.
pub fn parse_obsidian_response(raw: &str) -> Result<Vec<ObsidianFile>, String> {
    let trimmed = raw.trim();
    let json_str = strip_code_fences(trimmed);

    parse_json_payload(json_str).or_else(|first_err| {
        let repaired = repair_json_string_literals(json_str);
        if repaired == json_str {
            return Err(first_err);
        }
        parse_json_payload(&repaired).map_err(|repair_err| {
            format!(
                "{} (repair attempt: {})",
                first_err, repair_err
            )
        })
    })
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
}
