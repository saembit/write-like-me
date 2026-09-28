---
name: write-like-me
description: Build a global profile of how the user writes code, comments, docs, chat, email and commit messages, then write it into the instruction files every agent reads (~/.claude/rules, ~/.codex/AGENTS.md, ~/.config/opencode/AGENTS.md, ~/.gemini/GEMINI.md or a custom file) so agents write like them everywhere. Use when the user asks to capture their style, make the agent sound like them, run write-like-me setup, do the writing exercises, or refresh an existing profile.
argument-hint: "[setup | refresh] [samples=<file or dir>] [claude | codex | opencode | gemini | copilot | <path>]"
---

# write-like-me

Goal: produce a markdown profile of how this person writes so that you (and other agents) stop sounding like a default LLM when working for them. Two halves: how they write code (naming, comments, functions, error handling) and how they write prose (chat, docs, email, essays, docstrings, commits), including how the voice shifts between those.

The profile is global. It gets built once, lives in the user's home dir, and is written into the instruction files every agent reads on startup, so it follows them into every repo. Nothing is written into the repo you happen to be in unless the user names a file there.

Evidence first, questions second. Repos hold their real commits, comments and docs. Writing they hand over or type in setup holds what git can't see: chat, email, essays, social posts. Read all of that before asking anything, and only ask about what the evidence can't settle.

Arguments: setup runs the writing exercises (see Setup). refresh forces the refresh path. samples=<path> points at a file or dir of their own writing. claude, codex, opencode, gemini, copilot pick targets without asking. Anything else that looks like a path is a custom target file. No arguments: if a profile exists, refresh it, otherwise start fresh.

# Where things live

Home is $WRITE_LIKE_ME_HOME if set, else ~/.write-like-me. It holds:

- profile.json, the sidecar. Same schema as the web app's .write-like-me.json (version 1, answers, abPicks, writingResponses, writingReport, createdAt, updatedAt) plus samplePaths, repos and targets, which the web app ignores.
- profile.md, the rendered profile, both sections. The targets are copies of this.
- samples/, the user's own writing. One file per register from the exercises, plus anything else they drop in. Reread on every refresh.

Targets are the files agents read for every project. Write the profile into each one the user picks, between the marker comments from the templates, and never clobber what else is in the file.

- Claude Code: ~/.claude/rules/write-like-me.md as its own file. Claude Code loads every .md under ~/.claude/rules for all projects. Keep it under 200 lines, that's what Claude Code recommends per rules file.
- Codex: ~/.codex/AGENTS.md
- opencode: ~/.config/opencode/AGENTS.md. opencode also falls back to ~/.claude/CLAUDE.md, not to ~/.claude/rules, so a Claude Code only install doesn't cover it.
- Gemini CLI: ~/.gemini/GEMINI.md
- GitHub Copilot CLI: ~/.copilot/copilot-instructions.md
- Cursor has no global rules file, only the Rules screen in its settings. Print the profile and tell them to paste it there.
- Custom: any path the user gives, including a repo file like CLAUDE.md or AGENTS.md when they want a per repo copy.

Only offer targets for agents they use. Check which of ~/.claude, ~/.codex, ~/.config/opencode, ~/.gemini, ~/.copilot exist and preselect those.

# Files in this skill

Paths below are relative to this skill's own directory (the dir that holds this SKILL.md), not the user's repo. Claude Code tells you that directory when the skill loads, other agents usually do too. Run the scripts with that absolute path and keep your cwd in the user's repo.

- data/questions.json, the question bank. 14 questions across 4 axes (naming, comments, functions, errors). Each choice carries prose, glance and avoids text that goes straight into the output file.
- data/snippet-pairs.json, A/B code pairs. Each pick maps to question answers with a weight. Use when the user would rather pick code than answer a question.
- data/registers.json, the writing registers (technical, docs, academic, essay, social, chat, email, code). Each lists its exercises and the minimum words before it counts as evidence.
- data/exercises.json, 11 short writing exercises, each tagged with its register. Used by setup, and as a chat fallback when the repo doesn't have enough of their writing.
- data/style-analysis-prompt.md, the rubric for turning writing samples into a style report. Follow it when analyzing prose.
- scripts/analyze-code.mjs, zero dependency heuristics. Run with node on a dir or files, get back comment density, function length, identifier length, acronym casing and suggested answers with confidence.
- scripts/collect-writing.mjs, pulls the user's commit messages, docs, comments and docstrings out of git into one text blob, filtered to their author and blame when the repo has other people in it. Commits with AI trailers (Co-Authored-By Claude, Copilot, etc.) are dropped and counted. Takes --samples=<file or dir> for their own writing, which goes first and is never trimmed. Html comments and untouched exercise snippets are stripped from samples, so a scaffold file only counts once you've written in it. Tells you up front whether there's enough to skip the exercises.
- scripts/scaffold-samples.mjs, writes one markdown file per register into <home>/samples with the prompts inside html comments. --list shows the registers, --force rewrites files that already exist.
- templates/CODE-STYLE.md and templates/WRITING-STYLE.md, the shape of the two output sections.

# Flow

1. Setup
   - Look for <home>/profile.json. If it exists go to Refresh, unless they said setup (which adds registers on top of an existing profile) or asked for a clean start.
   - Ask which targets to write. Multi select from the list above, preselect the agents whose dirs exist. Same content in each.
   - Get their git identity with git config user.name and user.email. Ask which repos hold their writing: the cwd if it's a git repo, plus any others they name. Store the list under repos in profile.json so refresh doesn't ask again. If a repo has commits under a different email for the same person, ask which to use.

2. Infer code style from the repos
   - For each repo run node scripts/analyze-code.mjs. In a multi author repo run it on files they've authored instead, the whole tree would measure everyone: git log --author=<email> --name-only --format= | sort -u | node <skill dir>/scripts/analyze-code.mjs - (a lone dash reads paths from stdin, deleted files are skipped).
   - Take each suggestion in the output as a draft answer. Keep its confidence. Where two repos disagree with high confidence on the same question, ask.
   - Read a handful of their files yourself for the things the script can't see: early returns vs single exit, error handling shape, custom error types, whether helpers get extracted, nesting depth, TODO comments. Draft answers for those too and be honest about confidence.

3. Infer writing style from the repos, or from the user
   - Run node scripts/collect-writing.mjs <repo> for each repo. Add --samples=<home>/samples when that dir has files, plus any samples= they passed. Read the output. The header says how many words of samples, commits, docs and comments it found, how many commits were skipped for AI trailers, and whether that's enough.
   - Then ask one question before trusting any of it, because a repo that was mostly written by an AI will teach you the AI's voice, not theirs: how much of the writing in this repo is actually yours? Choices: mostly mine, use it / mixed, let me say which parts / mostly AI, don't use the repo / I'd rather give you samples. Skip this question if they already passed samples= or if the script found nothing.
   - mostly mine: analyze the blob with data/style-analysis-prompt.md. If enough was no, go to Setup first and analyze both.
   - mixed: ask which kinds to trust (commits, docs, comments) and drop the others. If the repo has an obvious human written file (a README they wrote by hand, a notes file) let them name it and copy it into <home>/samples.
   - mostly AI or samples: ignore the repo blob except for what they point at. Go to Setup.
   - Registers: git only ever shows commits, comments and docs. Chat, email, essays, social and academic writing exist only if the user gives them. Ask which registers from data/registers.json they want covered (multi select, skip the ones <home>/samples already has enough words for), then go to Setup for those. Don't push registers they don't write in.
   - Save what they typed or pasted in chat as writingResponses keyed by exercise id, or sample-1, sample-2 for pasted text. Paths they pointed at outside home go under samplePaths so a refresh can reread them. Files under <home>/samples need no listing, they're always reread. Repo evidence doesn't go in the sidecar, it's already in git.

4. Ask only what's left
   - For each question in data/questions.json that has no answer or a low confidence draft, ask the user. Show the draft and its rationale so they can just confirm.
   - If AskUserQuestion (Claude Code), question (opencode), request_user_input (Codex) or an equivalent structured prompt is available, use it with the choices from the bank. Spectrum questions become a list of steps with leftLabel and rightLabel at the ends. Otherwise ask in plain chat with numbered options, one question per message.
   - Offer the A/B pairs for an axis only when the user seems unsure or says they'd rather look at code, and only when the prompt tool can show code previews (AskUserQuestion can). In plain chat two code blocks and pick left or right is clunky, skip the pairs and ask the question directly. Fold picks into answers using each snippet's signals and weights, highest total weight wins.
   - Don't ask everything. Five or six questions is normal, fourteen means the inference step was skipped.

5. Write the output
   - Fill templates/CODE-STYLE.md from the chosen answers. For each answered question pull the choice's glance line into At a glance, its prose into the axis section, its avoids into Anti-patterns. Skip empty ones.
   - Fill templates/WRITING-STYLE.md from the style report. By register gets one short block per register that has enough evidence (minWords in registers.json). A register they asked for but didn't write enough in gets "not enough evidence yet", not a guess.
   - Write <home>/profile.md with both sections, then copy it into each target between the markers. Write the first person voice the templates use, this is their profile not yours.
   - Save <home>/profile.json: version 1, answers, abPicks, writingResponses, writingReport, samplePaths, repos, targets, createdAt, updatedAt.

6. Report back in one or two lines. Which targets were written, how many questions were inferred vs asked, which registers have evidence and which don't.

# Setup

The writing exercises, one file per register, filled in by the user in their own editor. Run this when they say setup, when they pick "I'd rather give samples", or when the repo evidence is thin. Typing an essay into a chat prompt is miserable, so long registers go through files. Short ones can go either way.

1. Show the registers from data/registers.json and ask which matter to them (multi select). Everyone gets code. The rest depend on whether they actually write chat, email, essays, social posts or academic work with an agent's help. Don't pick for them, and don't push all eight.
2. For each chosen register ask whether they already have writing of that kind on disk: an old paper, exported posts, a notes folder, saved emails, a blog repo. Real writing beats exercises. Copy what they point at into <home>/samples/<register>/, or record the path under samplePaths if it's big or they'd rather not copy. A register that already has more than its minWords skips the exercise.
3. For the rest run node scripts/scaffold-samples.mjs <register ...>. It writes <home>/samples/<register>.md with the prompts in html comments, keeps files that already exist, and prints the paths.
4. Tell them, in two or three lines: the paths, that they write under each prompt in any editor and skip what they want, and to run write-like-me again (or say done) when finished. Then stop. Don't poll, don't ask them to paste. If they'd rather type the short ones (chat, social, commit) right here, take it, save it under writingResponses by exercise id, and tell them to skip those in the file.
5. When they come back, a fresh run finds <home>/samples with content and continues at step 3 of the Flow with the register question already answered. Rerun collect-writing.mjs with --samples=<home>/samples and analyze. Files that still only hold the prompts come back empty and are skipped, say which registers those were.

# Refresh

When <home>/profile.json already exists:

- Load it. Tell them in one line when it was last updated, how many answers it holds, which registers have evidence and which targets it was written to.
- Re-run both scripts on the stored repos, with --samples=<home>/samples and the stored samplePaths. For code, compare the new suggestions to the stored answers. Where a high confidence suggestion disagrees with a stored answer, show both and ask which to keep. Everything else keeps the stored answer, don't re-ask settled questions.
- For writing, check for new evidence since updatedAt: git log --author=<email> --since=<updatedAt> --oneline per repo, and sample files modified after updatedAt. If there's a meaningful amount, re-analyze with the rubric and diff the new report against the stored one field by field. Show only the fields that changed and ask whether to take the new wording. If nothing is new, keep the stored report and say so.
- Answer any questions that were never answered the first time, same rules as step 4. Offer setup for registers that still have no evidence, once, don't nag.
- Rewrite <home>/profile.md, then the sections between the markers in every stored target. Add any new target they ask for. Keep createdAt, bump updatedAt, write the sidecar.

# Rules

- Never invent a habit that isn't in the evidence. If the samples don't show it, leave it out or mark it as unknown.
- A habit seen once is "seen once", not a rule. Two or more samples before it becomes a guideline. One Slack message doesn't make "Hey all" their greeting.
- Rough edges are part of the style. If they leave typos, write lowercase, skip trailing periods in comments, or end lists with etc., the profile should say so, not clean it up.
- Concrete beats vague. "Comments sit on the line above, capitalized, no trailing period" is useful. "Writes clear comments" is not.
- If the person's style contradicts your defaults, their style wins. That's the point.
- Keep the profile tight. Under 200 lines total, it gets loaded into every session of every agent they use.
- Don't send their writing anywhere. You are the analyzer, there is no external API call in this skill.
- Keep your own messages short while running this. It's their voice we're capturing, not yours.
