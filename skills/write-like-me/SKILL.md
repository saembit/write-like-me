---
name: write-like-me
description: Build a style profile of how the user writes code, comments, docs and commit messages, then write it to CLAUDE.md, AGENTS.md, .cursorrules or a custom file so agents write like them. Use when the user asks to capture their style, make the agent sound like them, set up write-like-me, or refresh an existing profile.
argument-hint: "[CLAUDE.md | AGENTS.md | .cursorrules | path] [samples=<file or dir>] [refresh]"
---

# write-like-me

Goal: produce a markdown profile of how this person writes so that you (and other agents) stop sounding like a default LLM when working in their repo. Two halves: how they write code (naming, comments, functions, error handling) and how they write prose (messages, docs, docstrings, commits).

Evidence first, questions second. The repo already has a lot of this person's real writing in it. Read that before asking them anything, and only ask about what the evidence can't settle.

Arguments: anything that looks like a filename is a target file to write to. samples=<path> points at a file or dir of the user's own writing to use as evidence. The word refresh forces the refresh path even if you'd otherwise start fresh. No arguments means ask.

# Files in this skill

Paths below are relative to this skill's own directory (the dir that holds this SKILL.md), not the user's repo. Claude Code tells you that directory when the skill loads, other agents usually do too. Run the scripts with that absolute path and keep your cwd in the user's repo.

- data/questions.json, the question bank. 14 questions across 4 axes (naming, comments, functions, errors). Each choice carries prose, glance and avoids text that goes straight into the output file.
- data/snippet-pairs.json, A/B code pairs. Each pick maps to question answers with a weight. Use when the user would rather pick code than answer a question.
- data/exercises.json, 6 short writing exercises (3 prose, 3 code documentation). Fallback for when the repo doesn't have enough of their writing.
- data/style-analysis-prompt.md, the rubric for turning writing samples into a style report. Follow it when analyzing prose.
- scripts/analyze-code.mjs, zero dependency heuristics. Run with node on a dir or files, get back comment density, function length, identifier length, acronym casing and suggested answers with confidence.
- scripts/collect-writing.mjs, pulls the user's commit messages, docs, comments and docstrings out of git into one text blob, filtered to their author and blame when the repo has other people in it. Commits with AI trailers (Co-Authored-By Claude, Copilot, etc.) are dropped and counted. Takes --samples=<file or dir> for writing the user hands over themselves, which goes first and is never trimmed. Tells you up front whether there's enough to skip the exercises.
- templates/CODE-STYLE.md and templates/WRITING-STYLE.md, the shape of the two output sections.

# Flow

1. Setup
   - Check for .write-like-me.json in the repo root. If it exists, go to Refresh below instead of starting over, unless the user says they want a clean start.
   - Ask which file(s) to write: CLAUDE.md, AGENTS.md, .cursorrules, or a custom name. More than one is fine, same content each. If a target already exists, append or replace only the write-like-me section (fenced with the marker comments from the templates), don't clobber the rest of the file.
   - Get the user's git identity with git config user.name and user.email. Used to filter history to their own work. If the repo has commits under a different email for the same person, ask which to use.

2. Infer code style from the repo
   - Run node scripts/analyze-code.mjs on the repo. In a multi author repo, run it on files they've authored instead, the whole tree would measure everyone: git log --author=<email> --name-only --format= | sort -u | node <skill dir>/scripts/analyze-code.mjs - (a lone dash reads paths from stdin, deleted files are skipped).
   - Take each suggestion in the output as a draft answer. Keep its confidence.
   - Read a handful of their files yourself for the things the script can't see: early returns vs single exit, error handling shape, whether helpers get extracted, nesting depth. Draft answers for those too and be honest about confidence.

3. Infer writing style from the repo, or from the user
   - Run node scripts/collect-writing.mjs <repo> (add --samples=<path> if they gave one) and read the output. The header says how many words of samples, commits, docs and comments it found, how many commits were skipped for AI trailers, and whether that's enough.
   - Then ask one question before trusting any of it, because a repo that was mostly written by an AI will teach you the AI's voice, not theirs: how much of the writing in this repo is actually yours? Choices: mostly mine, use it / mixed, let me say which parts / mostly AI, don't use the repo / I'd rather give you samples. Skip this question if they already passed samples= or if the script found nothing.
   - mostly mine: analyze the blob with data/style-analysis-prompt.md. If enough was no, run the exercises first (below) and analyze both.
   - mixed: ask which kinds to trust (commits, docs, comments) and drop the others. If the repo has an obvious human written file (a README they wrote by hand, a notes file) let them name it and pass it as --samples.
   - mostly AI or samples: ignore the repo blob except for what they point at. Get their own writing one of three ways, whichever they prefer: paste it in chat (a real Slack message, a README, an email, anything they wrote themselves), point at files or a dir on disk (rerun the script with --samples=<path>), or do the exercises. Two or three real samples of different kinds beat six exercises, say so.
   - Exercises, when needed: run data/exercises.json in chat one at a time, the instruction plus the material if there is one, and let them type. At least 2 completed, skipping is fine. Then analyze with the rubric.
   - Save what the user typed or pasted as writingResponses keyed by exercise id, or sample-1, sample-2 for pasted text. File paths they pointed at go under a samplePaths key so a refresh can reread them. Repo evidence doesn't go in the sidecar, it's already in git.

4. Ask only what's left
   - For each question in data/questions.json that has no answer or a low confidence draft, ask the user. Show the draft and its rationale so they can just confirm.
   - If AskUserQuestion (Claude Code), question (opencode), request_user_input (Codex) or an equivalent structured prompt is available, use it with the choices from the bank. Spectrum questions become a list of steps with leftLabel and rightLabel at the ends. Otherwise ask in plain chat with numbered options, one question per message.
   - Offer the A/B pairs for an axis only when the user seems unsure or says they'd rather look at code, and only when the prompt tool can show code previews (AskUserQuestion can). In plain chat two code blocks and pick left or right is clunky, skip the pairs and ask the question directly. Fold picks into answers using each snippet's signals and weights, highest total weight wins.
   - Don't ask everything. Five or six questions is normal, fourteen means the inference step was skipped.

5. Write the output
   - Fill templates/CODE-STYLE.md from the chosen answers. For each answered question pull the choice's glance line into At a glance, its prose into the axis section, its avoids into Anti-patterns. Skip empty ones.
   - Fill templates/WRITING-STYLE.md from the style report.
   - Write the target file(s). Write the first person voice the templates use, this is their profile not yours.
   - Save .write-like-me.json with answers, abPicks, writingResponses, writingReport, createdAt, updatedAt, version 1. Same schema as the write-like-me web app so the two stay interchangeable. Suggest adding it to .gitignore if they don't want it committed, but don't do it for them.

6. Report back in one or two lines. Which files were written, how many questions were inferred vs asked, anything you couldn't determine.

# Refresh

When .write-like-me.json already exists:

- Load it. Tell the user in one line when it was last updated and how many answers and which writing exercises it holds.
- Re-run both scripts, passing the stored samplePaths to --samples if there are any. For code, compare the new suggestions to the stored answers. Where a high confidence suggestion disagrees with a stored answer, show both and ask which to keep. Everything else keeps the stored answer, don't re-ask settled questions.
- For writing, check if there's new evidence since updatedAt (git log --author=<email> --since=<updatedAt> --oneline). If there's a meaningful amount, re-analyze with the rubric and diff the new report against the stored one field by field. Show only the fields that changed and ask whether to take the new wording. If there's nothing new, keep the stored report and say so.
- Answer any questions that were never answered the first time, same rules as step 4.
- Rewrite the write-like-me sections in the target file(s) between the markers, keep createdAt, bump updatedAt, write the sidecar.

# Rules

- Never invent a habit that isn't in the evidence. If the samples don't show it, leave it out or mark it as unknown.
- Rough edges are part of the style. If they leave typos, write lowercase, skip trailing periods in comments, or end lists with etc., the profile should say so, not clean it up.
- Concrete beats vague. "Comments sit on the line above, capitalized, no trailing period" is useful. "Writes clear comments" is not.
- If the person's style contradicts your defaults, their style wins. That's the point.
- Don't send their writing anywhere. You are the analyzer, there is no external API call in this skill.
- Keep your own messages short while running this. It's their voice we're capturing, not yours.
