-- Per-meeting Obsidian vault subfolder (interviewee name), between vault root and meeting folder
ALTER TABLE meetings ADD COLUMN obsidian_vault_segment TEXT;
