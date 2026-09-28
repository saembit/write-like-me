# Write Like Me

Make your AI an extention of yourself, this time as a skill instead of a website

# About

Write Like Me started as a small web app that asked you questions about how you write code and spit out a CLAUDE.md. It worked but it was a detour, you had to open a browser, answer stuff, export a file, then go back to your agent. The agent is the one that needs the answers, and it's already sitting inside your repo with all your commits, comments and docs, so it may as well do the work itself. This repo is that idea: a Claude Code plugin (and a plain skill you can drop into Codex, opencode, etc.) that reads your repos, figures out as much as it can about how you write, asks you about the rest, and writes a profile into the global rules file each of your agents reads. Set it up once and it follows you into every repo.

It covers two things. How you write code (naming, comments, function size, error handling) and how you write words (chat messages, email, docs, essays, docstrings, commit messages), including how those differ from each other. The second half is the part I care about most, I was annoyed how everything an AI wrote for me sounded the same, so the skill looks at your actual writing and tries to describe it well enough that an agent can copy it, rough edges included.

Most of this repo was written with Claude, using my own writing profile so it reads like me. It may not be perfect but it's better than nothing.

# Install

Claude Code, as a plugin:

    /plugin marketplace add saembit/write-like-me
    /plugin install write-like-me@write-like-me

Then run /write-like-me from anywhere (Claude Code may show it as /write-like-me:write-like-me). To try it without installing, start Claude Code with --plugin-dir pointed at a clone of this repo.

Claude Code, as a plain skill: copy or symlink skills/write-like-me into ~/.claude/skills/ and it shows up as /write-like-me.

Codex, opencode, others: see adapters/. The skill is just a SKILL.md, some json and three node scripts with no dependencies, so it ports anywhere that reads skills. opencode reads ~/.claude/skills on its own so a Claude Code install covers it too.

# How it works

1. Looks for ~/.write-like-me/profile.json. If it's there it refreshes. Otherwise it asks which agents to write for (Claude Code, Codex, opencode, Gemini, Copilot, or a file you name) and which repos hold your writing
2. Runs scripts/analyze-code.mjs over your files for comment density, function length, naming, acronym casing
3. Runs scripts/collect-writing.mjs to pull your commit messages, docs, comments and docstrings out of git, filtered to you when the repo has other authors, with AI co-authored commits dropped
4. Asks how much of that is really yours. If the repo is mostly AI written you can paste your own writing, point it at a file or folder (samples=path), or do the setup exercises instead
5. Asks which registers you want covered: chat, email, academic, essays, social posts, docs, technical explanation, code. Git can't see most of those, so for the ones you pick it takes writing you already have on disk or runs setup, below
6. Drafts the profile from all that, then asks only the questions it couldn't answer, usually 5 or 6 not 14
7. Writes ~/.write-like-me/profile.md and copies it into each agent's global rules file between marker comments, so nothing else in those files is touched. Saves profile.json next to it so you can refresh later

No API keys, no network calls. The agent running the skill is the analyzer.

# Setup, the writing exercises

Run /write-like-me setup, or pick "I'd rather give samples" when asked. It writes one markdown file per register you picked into ~/.write-like-me/samples/ with the prompts inside html comments. You fill them in with any editor, skip what you want, then run /write-like-me again. The comments and any snippet you didn't touch get stripped so only what you wrote is analyzed, and the files stay put so a refresh can reread them. Short stuff like a chat message or a commit you can type into the conversation instead if you'd rather.

If you already have writing of some kind lying around (an old paper, a blog repo, exported posts) point the skill at it instead of doing the exercise, real writing beats exercises.

# Where it writes

- ~/.write-like-me/ holds profile.json (the sidecar), profile.md (the profile) and samples/ (your writing). Set WRITE_LIKE_ME_HOME to move it
- Claude Code: ~/.claude/rules/write-like-me.md
- Codex: ~/.codex/AGENTS.md
- opencode: ~/.config/opencode/AGENTS.md
- Gemini CLI: ~/.gemini/GEMINI.md
- Copilot CLI: ~/.copilot/copilot-instructions.md
- Cursor has no global rules file, the skill prints the profile so you can paste it into Settings > Rules
- Any path you name, if you want a per repo copy in CLAUDE.md or AGENTS.md

# Layout

- skills/write-like-me/SKILL.md, the instructions the agent follows
- skills/write-like-me/data/, question bank, A/B snippet pairs, registers, writing exercises, analysis rubric
- skills/write-like-me/scripts/, the three node scripts (code heuristics, writing collector, sample scaffolder)
- skills/write-like-me/templates/, the shape of the output
- adapters/, notes for Codex and opencode
- tests/, node --test, run with npm test

# Related

The original web app lives at ~/projects/write-like-me. The question bank, snippet pairs, exercises and heuristics here were ported from it and profile.json is the same format as its .write-like-me.json, it just lives in ~/.write-like-me instead of the repo root.
