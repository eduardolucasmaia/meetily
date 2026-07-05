use std::fs;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::parser::ObsidianFile;

pub fn meeting_subfolder_name(meeting_date: &chrono::DateTime<chrono::Utc>, title: &str) -> String {
    let date_prefix = meeting_date.format("%Y-%m-%d");
    let slug = slugify_title(title);
    if slug.is_empty() {
        format!("{}-meeting", date_prefix)
    } else {
        format!("{}-{}", date_prefix, slug)
    }
}

pub fn sanitize_filename(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Filename cannot be empty".to_string());
    }

    let mut base = trimmed.replace(['\\', '/'], "-");
    for c in ['<', '>', ':', '"', '|', '?', '*'] {
        base = base.replace(c, "-");
    }

    let base = base.trim().trim_matches('.').to_string();
    if base.is_empty() {
        return Err("Filename is invalid after sanitization".to_string());
    }

    if base.contains("..") {
        return Err("Filename cannot contain '..'".to_string());
    }

    let filename = if base.to_lowercase().ends_with(".md") {
        base
    } else {
        format!("{}.md", base)
    };

    Ok(filename)
}

pub fn write_files_to_temp(files: &[ObsidianFile]) -> Result<PathBuf, String> {
    let temp_root = std::env::temp_dir().join(format!("meetily-obsidian-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_root)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    for file in files {
        let safe_name = sanitize_filename(&file.filename)?;
        let dest = temp_root.join(&safe_name);
        fs::write(&dest, &file.content)
            .map_err(|e| format!("Failed to write temp file '{}': {}", safe_name, e))?;
    }

    Ok(temp_root)
}

pub fn move_temp_to_vault(temp_dir: &Path, vault_path: &Path, subfolder: &str) -> Result<PathBuf, String> {
    if !vault_path.exists() {
        fs::create_dir_all(vault_path)
            .map_err(|e| format!("Vault path does not exist and could not be created: {}", e))?;
    }

    if !vault_path.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path.display()));
    }

    let dest_dir = vault_path.join(subfolder);
    if dest_dir.exists() {
        fs::remove_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to replace existing export folder: {}", e))?;
    }

    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create meeting export folder: {}", e))?;

    for entry in fs::read_dir(temp_dir).map_err(|e| format!("Failed to read temp dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read temp entry: {}", e))?;
        let path = entry.path();
        if path.is_file() {
            let file_name = path
                .file_name()
                .ok_or_else(|| "Invalid temp file name".to_string())?;
            let dest_file = dest_dir.join(file_name);
            fs::rename(&path, &dest_file).map_err(|e| {
                format!(
                    "Failed to move '{}' to vault: {}",
                    file_name.to_string_lossy(),
                    e
                )
            })?;
        }
    }

    cleanup_temp_dir(temp_dir);
    Ok(dest_dir)
}

pub fn cleanup_temp_dir(temp_dir: &Path) {
    let _ = fs::remove_dir_all(temp_dir);
}

fn slugify_title(title: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;

    for c in title.chars().take(80) {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
            last_dash = false;
        } else if c.is_whitespace() || c == '-' || c == '_' {
            if !last_dash && !slug.is_empty() {
                slug.push('-');
                last_dash = true;
            }
        }
    }

    slug.trim_matches('-').chars().take(50).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify_title("Team Standup!"), "team-standup");
    }

    #[test]
    fn sanitize_adds_md_extension() {
        assert_eq!(sanitize_filename("Notes").unwrap(), "Notes.md");
    }
}
