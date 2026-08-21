# Write Like Me

Make your AI an extention of yourself, this time as a skill instead of a website

# About

Write Like Me started as a small web app that asked you questions about how you write code and spit out a CLAUDE.md. It worked but it was a detour, you had to open a browser, answer stuff, export a file, then go back to your agent. The agent is the one that needs the answers, and it's already sitting inside your repo with all your commits, comments and docs, so it may as well do the work itself. This repo is that idea: a Claude Code plugin (and a plain skill you can drop into Codex, opencode, etc.) that reads your repo, figures out as much as it can about how you write, asks you about the rest, and writes a profile to CLAUDE.md, AGENTS.md, .cursorrules or whatever file you want.

It covers two things. How you write code (naming, comments, function size, error handling) and how you write words (chat messages, docs, docstrings, commit messages). The second half is the part I care about most, I was annoyed how everything an AI wrote for me sounded the same, so the skill looks at your actual writing and tries to describe it well enough that an agent can copy it, rough edges included.

Most of this repo was written with Claude, using my own writing profile so it reads like me. It may not be perfect but it's better than nothing.

# Install

Claude Code, as a plugin:

    /plugin marketplace add saembit/write-like-me
    /plugin install write-like-me@write-like-me

Then run /write-like-me in any repo (Claude Code may show it as /write-like-me:write-like-me). To try it without installing, start Claude Code with --plugin-dir pointed at a clone of this repo.

Claude Code, as a plain skill: copy or symlink skills/write-like-me into ~/.claude/skills/ and it shows up as /write-like-me.

Codex, opencode, others: see adapters/. The skill is just a SKILL.md, some json and two node scripts with no dependencies, so it ports anywhere that reads skills. opencode reads ~/.claude/skills on its own so a Claude Code install covers it too.

# How it works

1. Looks for an existing .write-like-me.json and asks which file(s) to write to
2. Runs scripts/analyze-code.mjs over your files for comment density, function length, naming, acronym casing
3. Runs scripts/collect-writing.mjs to pull your commit messages, docs, comments and docstrings out of git, filtered to you when the repo has other authors
4. Reads that and drafts the profile, then asks only the questions it couldn't answer, usually 5 or 6 not 14
5. Writes the profile and saves .write-like-me.json so you can refresh later

No API keys, no network calls. The agent running the skill is the analyzer.

# Layout

- skills/write-like-me/SKILL.md, the instructions the agent follows
- skills/write-like-me/data/, question bank, A/B snippet pairs, writing exercises, analysis rubric
- skills/write-like-me/scripts/, the two node scripts (code heuristics, writing collector)
- skills/write-like-me/templates/, the shape of the output
- adapters/, notes for Codex and opencode
- tests/, node --test, run with npm test

# Related

The original web app lives at ~/projects/write-like-me. The question bank, snippet pairs, exercises and heuristics here were ported from it and the .write-like-me.json format is the same so the two can be used on the same repo.
