use crate::database::models::{MeetingModel, Transcript};

const MAX_TRANSCRIPT_CHARS: usize = 120_000;

pub fn build_meeting_context(
    meeting: &MeetingModel,
    transcripts: &[Transcript],
    summary_markdown: Option<&str>,
) -> String {
    let date = meeting.created_at.0.format("%Y-%m-%d %H:%M:%S UTC");
    let mut transcript_text = transcripts
        .iter()
        .map(|t| {
            let time = t
                .audio_start_time
                .map(|s| format!("[{:.0}s]", s))
                .unwrap_or_default();
            format!("{} {}", time, t.transcript.trim())
        })
        .collect::<Vec<_>>()
        .join("\n");

    let truncated = transcript_text.len() > MAX_TRANSCRIPT_CHARS;
    if truncated {
        transcript_text.truncate(MAX_TRANSCRIPT_CHARS);
        transcript_text.push_str("\n\n[Transcript truncated due to length limit]");
    }

    let summary_section = match summary_markdown {
        Some(md) if !md.trim().is_empty() => md.to_string(),
        _ => "No summary generated yet.".to_string(),
    };

    format!(
        r#"## Meeting Metadata
- Meeting ID: {id}
- Title: {title}
- Date: {date}

## Existing Summary
{summary}

## Transcript
{transcript}
"#,
        id = meeting.id,
        title = meeting.title,
        date = date,
        summary = summary_section,
        transcript = transcript_text,
    )
}

pub fn build_user_prompt(user_instructions: &str, meeting_context: &str) -> String {
    format!(
        "{user_instructions}\n\n---\n\n{meeting_context}",
        user_instructions = user_instructions.trim(),
        meeting_context = meeting_context,
    )
}

pub const OBSIDIAN_SYSTEM_PROMPT: &str = r#"You are an assistant that creates Obsidian vault notes from meeting data.

All exported note CONTENT must be written in Brazilian Portuguese.

Respond with ONLY this format (no markdown code fences, no commentary, NOT JSON):

===FILE: Main Note.md===
---
title: Example
---

Content here
===END===

Rules:
- Repeat ===FILE: ... === / body / ===END=== for each note
- Each file must have a safe filename ending in .md
- Use YAML frontmatter in every note (type, date, tags, topics, people, projects)
- Use wikilinks [[Note Name]] extensively for topics, people, projects, and cross-meeting linking
- Reuse exact canonical topic names so future meetings connect to the same graph nodes
- Create topic hub stub notes ("Topic — {name}.md") for new subjects
- Create separate notes when useful (main note, action items, decisions, topic hubs)
- Filenames must not contain path separators or invalid characters
"#;

pub const JSON_RETRY_SUFFIX: &str = r#"

IMPORTANT: Your previous response was invalid or truncated. Reply again using ONLY the ===FILE:/===END=== format shown above (NOT JSON). Include complete markdown for every note."#;
