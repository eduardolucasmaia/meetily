use std::path::PathBuf;

use reqwest::Client;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, Runtime};
use tracing::info;

use crate::database::models::Transcript;
use crate::database::repositories::setting::SettingsRepository;
use crate::database::repositories::summary::SummaryProcessesRepository;
use crate::database::repositories::meeting::MeetingsRepository;
use crate::summary::llm_client::{generate_summary, LLMProvider};

use super::parser::{parse_obsidian_response, ObsidianExportResult};
use super::prompt::{
    build_meeting_context, build_user_prompt, JSON_RETRY_SUFFIX, OBSIDIAN_SYSTEM_PROMPT,
};
use super::writer::{cleanup_temp_dir, meeting_subfolder_name, move_temp_to_vault, write_files_to_temp};

struct LlmConfig {
    provider: LLMProvider,
    model_name: String,
    api_key: String,
    ollama_endpoint: Option<String>,
    custom_openai_endpoint: Option<String>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<PathBuf>,
}

pub async fn export_meeting_to_obsidian(
    app: &AppHandle<impl Runtime>,
    pool: &SqlitePool,
    meeting_id: &str,
    vault_path: &str,
    user_prompt: &str,
) -> Result<ObsidianExportResult, String> {
    let vault = PathBuf::from(vault_path.trim());
    if vault_path.trim().is_empty() {
        return Err("Obsidian vault path is not configured".to_string());
    }

    let meeting = MeetingsRepository::get_meeting_metadata(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load meeting: {}", e))?
        .ok_or_else(|| "Meeting not found".to_string())?;

    let transcripts = load_transcripts(pool, meeting_id).await?;
    if transcripts.is_empty() {
        return Err("Meeting has no transcript to export".to_string());
    }

    let summary_markdown = load_summary_markdown(pool, meeting_id).await?;
    let meeting_context = build_meeting_context(&meeting, &transcripts, summary_markdown.as_deref());
    let user_prompt_full = build_user_prompt(user_prompt, &meeting_context);

    let llm = load_llm_config(pool, app).await?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let raw = call_llm(&client, &llm, &user_prompt_full, None).await?;
    let files = match parse_obsidian_response(&raw) {
        Ok(files) => files,
        Err(first_err) => {
            info!("Obsidian export JSON parse failed, retrying once: {}", first_err);
            let retry_prompt = format!("{}{}", user_prompt_full, JSON_RETRY_SUFFIX);
            let retry_raw = call_llm(&client, &llm, &retry_prompt, None).await?;
            parse_obsidian_response(&retry_raw).map_err(|retry_err| {
                format!(
                    "AI returned invalid export format. First error: {}. Retry error: {}",
                    first_err, retry_err
                )
            })?
        }
    };

    let file_count = files.len();
    let subfolder = meeting_subfolder_name(&meeting.created_at.0, &meeting.title);
    let temp_dir = write_files_to_temp(&files)?;

    match move_temp_to_vault(&temp_dir, &vault, &subfolder) {
        Ok(exported_path) => {
            info!(
                "Exported {} Obsidian files for meeting {} to {}",
                file_count,
                meeting_id,
                exported_path.display()
            );
            Ok(ObsidianExportResult {
                exported_path: exported_path.to_string_lossy().to_string(),
                file_count,
            })
        }
        Err(e) => {
            cleanup_temp_dir(&temp_dir);
            Err(e)
        }
    }
}

async fn load_transcripts(pool: &SqlitePool, meeting_id: &str) -> Result<Vec<Transcript>, String> {
    sqlx::query_as::<_, Transcript>(
        "SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load transcripts: {}", e))
}

async fn load_summary_markdown(pool: &SqlitePool, meeting_id: &str) -> Result<Option<String>, String> {
    let process = SummaryProcessesRepository::get_summary_data(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load summary: {}", e))?;

    let Some(process) = process else {
        return Ok(None);
    };

    let Some(result) = process.result else {
        return Ok(None);
    };

    let value: serde_json::Value = serde_json::from_str(&result)
        .map_err(|e| format!("Failed to parse summary JSON: {}", e))?;

    Ok(value
        .get("markdown")
        .and_then(|m| m.as_str())
        .map(|s| s.to_string()))
}

async fn load_llm_config(pool: &SqlitePool, app: &AppHandle<impl Runtime>) -> Result<LlmConfig, String> {
    let config = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to load model config: {}", e))?
        .ok_or_else(|| "Summary model is not configured. Set it in Settings > Summary.".to_string())?;

    let provider = LLMProvider::from_str(&config.provider)?;
    let model_name = config.model.clone();

    let api_key = if provider == LLMProvider::Ollama
        || provider == LLMProvider::BuiltInAI
        || provider == LLMProvider::CustomOpenAI
    {
        String::new()
    } else {
        SettingsRepository::get_api_key(pool, &config.provider)
            .await
            .map_err(|e| format!("Failed to load API key: {}", e))?
            .filter(|k| !k.is_empty())
            .ok_or_else(|| format!("API key not found for provider '{}'", config.provider))?
    };

    let ollama_endpoint = if provider == LLMProvider::Ollama {
        config.ollama_endpoint.clone()
    } else {
        None
    };

    let (custom_openai_endpoint, custom_openai_api_key, max_tokens, temperature, top_p) =
        if provider == LLMProvider::CustomOpenAI {
            match SettingsRepository::get_custom_openai_config(pool).await {
                Ok(Some(custom)) => (
                    Some(custom.endpoint),
                    custom.api_key,
                    custom.max_tokens.map(|t| t as u32),
                    custom.temperature,
                    custom.top_p,
                ),
                Ok(None) => {
                    return Err("Custom OpenAI provider selected but no configuration found".to_string())
                }
                Err(e) => return Err(format!("Failed to load custom OpenAI config: {}", e)),
            }
        } else {
            (None, None, None, None, None)
        };

    let final_api_key = if provider == LLMProvider::CustomOpenAI {
        custom_openai_api_key.unwrap_or_default()
    } else {
        api_key
    };

    let app_data_dir = if provider == LLMProvider::BuiltInAI {
        Some(
            app.path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve app data dir: {}", e))?,
        )
    } else {
        None
    };

    Ok(LlmConfig {
        provider,
        model_name,
        api_key: final_api_key,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
    })
}

async fn call_llm(
    client: &Client,
    llm: &LlmConfig,
    user_prompt: &str,
    cancellation_token: Option<&tokio_util::sync::CancellationToken>,
) -> Result<String, String> {
    generate_summary(
        client,
        &llm.provider,
        &llm.model_name,
        &llm.api_key,
        OBSIDIAN_SYSTEM_PROMPT,
        user_prompt,
        llm.ollama_endpoint.as_deref(),
        llm.custom_openai_endpoint.as_deref(),
        llm.max_tokens,
        llm.temperature,
        llm.top_p,
        llm.app_data_dir.as_ref(),
        cancellation_token,
    )
    .await
}

pub fn open_folder_in_explorer(folder_path: &str) -> Result<(), String> {
    let path = PathBuf::from(folder_path);
    if !path.exists() {
        return Err(format!("Folder not found: {}", folder_path));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}
