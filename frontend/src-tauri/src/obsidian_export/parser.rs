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
        let raw = r#"{"files":[{"filename":"Note.md","content":"# Hello"}]}"#;
        let files = parse_obsidian_response(raw).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].filename, "Note.md");
    }

    #[test]
    fn parse_json_with_fences() {
        let raw = "```json\n{\"files\":[{\"filename\":\"A.md\",\"content\":\"x\"}]}\n```";
        let files = parse_obsidian_response(raw).unwrap();
        assert_eq!(files.len(), 1);
    }
}
