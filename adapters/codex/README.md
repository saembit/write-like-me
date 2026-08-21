# Codex

Codex reads SKILL.md skills natively and the frontmatter here is the same open skills format, so nothing needs to change in the skill itself.

Copy or symlink skills/write-like-me into one of these, Codex picks it up on the next start.

- ~/.agents/skills/write-like-me, for you everywhere
- <repo>/.agents/skills/write-like-me, for one repo

~/.codex/skills still works but is marked deprecated in the Codex source, so use ~/.agents/skills.

Then in Codex type $write-like-me, or just ask it to capture your style and it should pick the skill from the description. Codex used to have custom prompts in ~/.codex/prompts but those are deprecated in favor of skills too, so there is no separate command file to install.

Codex has a structured question tool called request_user_input. It is reliable in Plan mode and may need a flag in Default mode (features.default_mode_request_user_input = true in ~/.codex/config.toml). If the call fails the skill falls back to numbered options in chat, same as anywhere else.

Codex reads AGENTS.md from the repo root down to your cwd, and ~/.codex/AGENTS.md globally. It doesn't read CLAUDE.md on its own, so either pick AGENTS.md as the target when the skill asks, or add "CLAUDE.md" to project_doc_fallback_filenames in ~/.codex/config.toml.

Docs: https://learn.chatgpt.com/docs/build-skills and https://learn.chatgpt.com/docs/agent-configuration/agents-md
