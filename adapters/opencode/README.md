# opencode

opencode reads Claude Code's skill dirs on its own, so if you already installed this for Claude Code at ~/.claude/skills/write-like-me or <repo>/.claude/skills/write-like-me there is nothing to do. It also reads ~/.agents/skills, so a Codex install is picked up too.

If you want it opencode only, copy or symlink skills/write-like-me into one of these.

- ~/.config/opencode/skills/write-like-me, for you everywhere
- <repo>/.opencode/skills/write-like-me, for one repo

The frontmatter (name, description) is the same format opencode wants, no edits needed.

opencode doesn't read .claude/commands, but it doesn't need a command file for this. Ask it to capture your style and it loads the skill, or make a small command if you want a slash name: put a file at .opencode/commands/write-like-me.md with

    ---
    description: Capture my coding and writing style into CLAUDE.md / AGENTS.md
    ---
    Load the write-like-me skill and follow it start to finish. $ARGUMENTS

and run /write-like-me.

opencode has a built in question tool for multiple choice, the skill uses it when it's there and falls back to numbered options in chat otherwise.

For the output file, opencode reads AGENTS.md first and falls back to CLAUDE.md, so either target works.

Docs: https://opencode.ai/docs/skills/ https://opencode.ai/docs/commands/ https://opencode.ai/docs/rules/
