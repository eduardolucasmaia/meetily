use crate::database::models::{MeetingModel, Transcript};

use super::parser::ObsidianFile;
use super::writer::sanitize_filename;

const NO_SUMMARY_PLACEHOLDER: &str = "Nenhum resumo gerado ainda.";

pub fn format_transcript_timestamp(
    audio_start_time: Option<f64>,
    fallback_timestamp: &str,
) -> String {
    match audio_start_time {
        Some(seconds) => {
            let total_secs = seconds.floor() as i64;
            let mins = total_secs / 60;
            let secs = total_secs % 60;
            format!("[{:02}:{:02}]", mins, secs)
        }
        None => fallback_timestamp.to_string(),
    }
}

pub fn build_conversation_file(
    meeting: &MeetingModel,
    transcripts: &[Transcript],
    summary_markdown: Option<&str>,
) -> Result<ObsidianFile, String> {
    let date_iso = meeting.created_at.0.format("%Y-%m-%d").to_string();
    let date_display = meeting.created_at.0.format("%d/%m/%Y %H:%M UTC").to_string();

    let transcript_body = transcripts
        .iter()
        .map(|t| {
            let time = format_transcript_timestamp(t.audio_start_time, &t.timestamp);
            format!("{} {}", time, t.transcript.trim())
        })
        .collect::<Vec<_>>()
        .join("\n");

    let summary_body = summary_markdown
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(NO_SUMMARY_PLACEHOLDER);

    let content = format!(
        r#"---
title: Conversa — {title}
date: {date_iso}
type: conversation
meeting_id: {meeting_id}
tags:
  - meeting
  - conversa
---

# {title}

**Data:** {date_display}

## Transcrição

{transcript_body}

## Resumo

{summary_body}
"#,
        title = meeting.title,
        date_iso = date_iso,
        meeting_id = meeting.id,
        date_display = date_display,
        transcript_body = transcript_body,
        summary_body = summary_body,
    );

    let filename = sanitize_filename(&format!("Conversa — {}", meeting.title))?;

    Ok(ObsidianFile { filename, content })
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use crate::database::models::{DateTimeUtc, MeetingModel, Transcript};

    use super::{build_conversation_file, format_transcript_timestamp};
    use crate::obsidian_export::parser::ObsidianFile;

    fn sample_meeting() -> MeetingModel {
        MeetingModel {
            id: "meet-123".to_string(),
            title: "Team Standup".to_string(),
            created_at: DateTimeUtc(Utc.with_ymd_and_hms(2026, 7, 24, 14, 30, 0).unwrap()),
            updated_at: DateTimeUtc(Utc.with_ymd_and_hms(2026, 7, 24, 14, 30, 0).unwrap()),
            folder_path: None,
        }
    }

    fn sample_transcript(text: &str, audio_start_time: Option<f64>, timestamp: &str) -> Transcript {
        Transcript {
            id: "t1".to_string(),
            meeting_id: "meet-123".to_string(),
            transcript: text.to_string(),
            timestamp: timestamp.to_string(),
            summary: None,
            action_items: None,
            key_points: None,
            audio_start_time,
            audio_end_time: None,
            duration: None,
        }
    }

    #[test]
    fn format_timestamp_mm_ss() {
        assert_eq!(format_transcript_timestamp(Some(75.0), "14:30:05"), "[01:15]");
        assert_eq!(format_transcript_timestamp(Some(5.0), "14:30:05"), "[00:05]");
    }

    #[test]
    fn format_timestamp_fallback_wall_clock() {
        assert_eq!(format_transcript_timestamp(None, "14:30:05"), "14:30:05");
    }

    #[test]
    fn build_conversation_file_with_summary() {
        let meeting = sample_meeting();
        let transcripts = vec![
            sample_transcript("Primeiro segmento.", Some(15.0), "14:30:15"),
            sample_transcript("Segundo segmento.", Some(102.0), "14:31:42"),
        ];
        let summary = "## Decisões\n\n- Item um";

        let ObsidianFile { filename, content } =
            build_conversation_file(&meeting, &transcripts, Some(summary)).unwrap();

        assert_eq!(filename, "Conversa — Team Standup.md");
        assert!(content.contains("title: Conversa — Team Standup"));
        assert!(content.contains("type: conversation"));
        assert!(content.contains("meeting_id: meet-123"));
        assert!(content.contains("# Team Standup"));
        assert!(content.contains("## Transcrição"));
        assert!(content.contains("[00:15] Primeiro segmento."));
        assert!(content.contains("[01:42] Segundo segmento."));
        assert!(content.contains("## Resumo"));
        assert!(content.contains("## Decisões"));
        assert!(content.contains("- Item um"));
        assert!(!content.contains("Nenhum resumo gerado ainda."));
    }

    #[test]
    fn build_conversation_file_without_summary() {
        let meeting = sample_meeting();
        let transcripts = vec![sample_transcript("Olá.", Some(0.0), "14:30:00")];

        let ObsidianFile { content, .. } =
            build_conversation_file(&meeting, &transcripts, None).unwrap();

        assert!(content.contains("Nenhum resumo gerado ainda."));
    }

    #[test]
    fn build_conversation_file_empty_summary_uses_placeholder() {
        let meeting = sample_meeting();
        let transcripts = vec![sample_transcript("Olá.", Some(0.0), "14:30:00")];

        let ObsidianFile { content, .. } =
            build_conversation_file(&meeting, &transcripts, Some("   ")).unwrap();

        assert!(content.contains("Nenhum resumo gerado ainda."));
    }
}
