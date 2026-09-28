#!/usr/bin/env node
/**
 * collect-writing.mjs
 * Pulls one person's writing out of a git repo (commit messages, docs, comments and
 * docstrings) into a single text blob so the agent can analyze it instead of improvising shell.
 * Usage: node collect-writing.mjs [repo-dir] [--author=<email or name>] [--samples=<file or dir>,...] [--max-words=4000] [--json] [--no-blame] [--keep-ai]
 * Zero dependencies, needs git on the path.
 **/
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Extensions whose comments are worth reading
const CODE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.java', '.kt', '.swift', '.rb', '.sh', '.svelte', '.vue']);
// Extensions that count as docs
const DOC_EXTS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
// Dirs we never look in
const SKIP_DIRS = ['node_modules/', '.git/', '.claude/', '.cursor/', 'dist/', 'build/', 'target/', 'vendor/', '.venv/', '__pycache__/'];
// Files that are almost never written by a human
const SKIP_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|CHANGELOG\.md|LICENSE(\.md)?)$/i;
// Commits carrying one of these were written with or by an AI and are skipped unless --keep-ai
const AI_MARKERS = [
    /^co-authored-by:.*\b(claude|anthropic|copilot|github-actions|chatgpt|openai|codex|cursor|gemini|aider|devin|sweep|windsurf|cline|roo)\b/im,
    /generated with \[?claude code/i,
    /claude-session:/i,
    /🤖/,
];
// Limits so the blob stays small enough to read
const MAX_DOC_FILES = 25;
const MAX_CODE_FILES = 60;
const MAX_FILE_BYTES = 200_000;
const MAX_COMMIT_WORDS_SHARE = 0.4;
const DEFAULT_MAX_WORDS = 4000;
// Below this many words in a kind, it doesn't count as evidence
const MIN_KIND_WORDS = 80;
// Enough material means this many words across this many kinds
const ENOUGH_WORDS = 300;
const ENOUGH_KINDS = 2;

/**
 * git
 * Runs a git command in the repo and returns stdout, empty string on failure
 * @param repo {string} - repo dir
 * @param args {string[]} - git args
 * @return {string}
 **/
function git(repo, args) {
    try {
        return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch {
        return '';
    }
}

/**
 * countWords
 * @param text {string}
 * @return {number}
 **/
function countWords(text) {
    return text.split(/\s+/).filter(Boolean).length;
}

/**
 * parseArgs
 * Reads argv into options
 * @param argv {string[]}
 * @return {{repo: string, author: string | null, samples: string[], maxWords: number, json: boolean, blame: boolean, keepAi: boolean}}
 **/
function parseArgs(argv) {
    const opts = { repo: process.cwd(), author: null, samples: [], maxWords: DEFAULT_MAX_WORDS, json: false, blame: true, keepAi: false };
    for (const a of argv) {
        if (a === '--json') opts.json = true;
        else if (a === '--no-blame') opts.blame = false;
        else if (a === '--keep-ai') opts.keepAi = true;
        else if (a.startsWith('--samples=')) opts.samples.push(...a.slice('--samples='.length).split(',').filter(Boolean).map((x) => resolve(x)));
        else if (a.startsWith('--author=')) opts.author = a.slice('--author='.length);
        else if (a.startsWith('--max-words=')) opts.maxWords = Number(a.slice('--max-words='.length)) || DEFAULT_MAX_WORDS;
        else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
        else opts.repo = resolve(a);
    }
    return opts;
}

/**
 * resolveAuthor
 * Picks the author to filter by. Explicit flag wins, then git config user.email, then user.name
 * @param repo {string}
 * @param explicit {string | null}
 * @return {string | null}
 **/
function resolveAuthor(repo, explicit) {
    if (explicit) return explicit;
    const email = git(repo, ['config', 'user.email']).trim();
    if (email) return email;
    const name = git(repo, ['config', 'user.name']).trim();
    return name || null;
}

/**
 * authorShare
 * Fraction of commits in the repo that match the author, used to decide if blame is needed
 * @param repo {string}
 * @param author {string}
 * @return {{mine: number, total: number}}
 **/
function authorShare(repo, author) {
    const total = git(repo, ['rev-list', '--count', 'HEAD']).trim();
    const mine = git(repo, ['rev-list', '--count', `--author=${author}`, 'HEAD']).trim();
    return { mine: Number(mine) || 0, total: Number(total) || 0 };
}

/**
 * looksAi
 * True when a commit message carries an AI trailer or marker
 * @param subject {string}
 * @param body {string}
 * @return {boolean}
 **/
function looksAi(subject, body) {
    const text = subject + '\n' + body;
    return AI_MARKERS.some((re) => re.test(text));
}

/**
 * collectCommits
 * Commit subjects and bodies by the author, merges skipped, newest first, AI marked ones counted and dropped unless keepAi
 * @param repo {string}
 * @param author {string}
 * @param keepAi {boolean}
 * @return {{commits: {hash: string, subject: string, body: string}[], aiSkipped: number}}
 **/
function collectCommits(repo, author, keepAi = false) {
    const sep = '\x01';
    const raw = git(repo, ['log', '--no-merges', `--author=${author}`, `--format=%h${sep}%s${sep}%b${sep}%x00`]);
    const out = [];
    let aiSkipped = 0;
    for (const chunk of raw.split('\x00')) {
        const [hash, subject, body] = chunk.replace(/^\n/, '').split(sep);
        if (!hash || !subject) continue;
        const commit = { hash: hash.trim(), subject: subject.trim(), body: (body ?? '').trim() };
        if (!keepAi && looksAi(commit.subject, commit.body)) {
            aiSkipped++;
            continue;
        }
        out.push(commit);
    }
    return { commits: out, aiSkipped };
}

// Html comments in samples are the prompts scaffold-samples.mjs writes, not the user's words
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
// The code snippets the exercises ship with, an untouched one in a sample isn't the user's writing either
const EXERCISE_MATERIALS = loadExerciseMaterials();

/**
 * loadExerciseMaterials
 * Reads the material field off data/exercises.json next to this script, empty list if it's missing
 * @return {string[]}
 **/
function loadExerciseMaterials() {
    try {
        const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'exercises.json');
        return JSON.parse(readFileSync(p, 'utf8')).map((e) => e.material).filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * stripScaffold
 * Removes prompt comments and untouched exercise snippets, what's left is what the user wrote
 * @param raw {string}
 * @return {string}
 **/
function stripScaffold(raw) {
    // Editors that save with CRLF would otherwise stop an untouched snippet from matching
    const noComments = raw.replace(/\r\n/g, '\n').replace(HTML_COMMENT_RE, '');
    return EXERCISE_MATERIALS.reduce((s, m) => s.split('```\n' + m + '\n```').join(''), noComments);
}

/**
 * collectSamples
 * Reads files the user handed over as their own writing, a file or a dir of files, text only.
 * Html comments are stripped so the exercise prompts don't get analyzed as theirs
 * @param paths {string[]}
 * @return {{path: string, text: string, words: number}[]}
 **/
function collectSamples(paths) {
    const out = [];
    const walk = (p) => {
        if (!existsSync(p)) {
            console.error(`samples path not found, skipping: ${p}`);
            return;
        }
        const st = statSync(p);
        if (st.isDirectory()) {
            for (const name of readdirSync(p).sort()) {
                if (name.startsWith('.')) continue;
                walk(join(p, name));
            }
            return;
        }
        if (st.size > MAX_FILE_BYTES) return;
        const raw = readFileSync(p, 'utf8');
        // Skip anything that looks binary
        if (raw.includes('\u0000')) return;
        // Drop the prompt comments and untouched snippets, what's left is what they wrote
        const text = stripScaffold(raw).trim();
        if (text) out.push({ path: p, text, words: countWords(text) });
    };
    for (const p of paths) walk(p);
    return out;
}

/**
 * authoredFiles
 * Files the author touched that still exist, most recently touched first
 * @param repo {string}
 * @param author {string}
 * @return {string[]}
 **/
function authoredFiles(repo, author) {
    const raw = git(repo, ['log', '--no-merges', `--author=${author}`, '--name-only', '--format=']);
    const seen = new Set();
    const out = [];
    for (const line of raw.split('\n')) {
        const rel = line.trim();
        if (!rel || seen.has(rel)) continue;
        seen.add(rel);
        if (SKIP_DIRS.some((d) => rel.includes(d))) continue;
        if (SKIP_FILES.test(rel)) continue;
        const abs = join(repo, rel);
        if (!existsSync(abs)) continue;
        if (statSync(abs).size > MAX_FILE_BYTES) continue;
        out.push(rel);
    }
    return out;
}

/**
 * blameLinesByAuthor
 * Set of line numbers (1-based) in a file that the author last touched
 * @param repo {string}
 * @param rel {string}
 * @param author {string}
 * @return {Set<number> | null} - null when blame failed
 **/
function blameLinesByAuthor(repo, rel, author) {
    const raw = git(repo, ['blame', '--line-porcelain', '--', rel]);
    if (!raw) return null;
    const mine = new Set();
    const needle = author.toLowerCase();
    let lineNo = 0;
    let matches = false;
    for (const line of raw.split('\n')) {
        // Header line of a blame block is "<sha> <orig> <final> [count]"
        const head = line.match(/^[0-9a-f]{40} \d+ (\d+)/);
        if (head) {
            lineNo = Number(head[1]);
            matches = false;
            continue;
        }
        if (line.startsWith('author ') || line.startsWith('author-mail ')) {
            if (line.toLowerCase().includes(needle)) matches = true;
            continue;
        }
        // Content line starts with a tab
        if (line.startsWith('\t') && matches) mine.add(lineNo);
    }
    return mine;
}

/**
 * extractComments
 * Pulls comment and docstring lines out of a source file, grouped into runs
 * @param text {string}
 * @param ext {string}
 * @param keep {Set<number> | null} - line numbers to keep, null keeps everything
 * @return {string[]} - each entry is one comment run, lines joined with \n
 **/
function extractComments(text, ext, keep) {
    const lines = text.split('\n');
    const hashStyle = ['.py', '.rb', '.sh'].includes(ext);
    const runs = [];
    let run = [];
    let inBlock = false;
    let inDoc = false;
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        const mine = keep === null || keep.has(i + 1);
        let isComment = false;
        if (hashStyle) {
            // Python docstrings open and close with triple quotes
            if (ext === '.py' && (t.startsWith('"""') || t.startsWith("'''"))) {
                isComment = true;
                const closesSameLine = t.length > 3 && (t.endsWith('"""') || t.endsWith("'''"));
                if (!closesSameLine) inDoc = !inDoc;
            } else if (inDoc) {
                isComment = true;
                if (t.endsWith('"""') || t.endsWith("'''")) inDoc = false;
            } else if (t.startsWith('#') && !t.startsWith('#!')) {
                isComment = true;
            }
        } else {
            if (inBlock) {
                isComment = true;
                if (t.includes('*/')) inBlock = false;
            } else if (t.startsWith('//')) {
                isComment = true;
            } else if (t.startsWith('/*')) {
                isComment = true;
                if (!t.includes('*/')) inBlock = true;
            } else if (t.startsWith('<!--')) {
                isComment = true;
                if (!t.includes('-->')) inBlock = true;
            }
        }
        if (isComment && mine) {
            run.push(lines[i].replace(/^\s+/, ''));
        } else if (run.length) {
            runs.push(run.join('\n'));
            run = [];
        }
    }
    if (run.length) runs.push(run.join('\n'));
    return runs;
}

/**
 * collectDocs
 * Markdown and text files the author touched, whole content
 * @param repo {string}
 * @param files {string[]}
 * @return {{path: string, text: string}[]}
 **/
function collectDocs(repo, files) {
    const out = [];
    // Issue and PR templates are mostly boilerplate, read them last
    const ordered = [...files].sort((a, b) => Number(a.startsWith('.github/')) - Number(b.startsWith('.github/')));
    for (const rel of ordered) {
        if (!DOC_EXTS.has(extname(rel).toLowerCase())) continue;
        if (out.length >= MAX_DOC_FILES) break;
        const text = readFileSync(join(repo, rel), 'utf8').trim();
        if (text) out.push({ path: rel, text });
    }
    return out;
}

/**
 * collectComments
 * Comment runs from code files the author touched, blame filtered when asked
 * @param repo {string}
 * @param files {string[]}
 * @param author {string}
 * @param useBlame {boolean}
 * @return {{path: string, runs: string[]}[]}
 **/
function collectComments(repo, files, author, useBlame) {
    const out = [];
    for (const rel of files) {
        const ext = extname(rel).toLowerCase();
        if (!CODE_EXTS.has(ext)) continue;
        if (out.length >= MAX_CODE_FILES) break;
        const text = readFileSync(join(repo, rel), 'utf8');
        const keep = useBlame ? blameLinesByAuthor(repo, rel, author) : null;
        const runs = extractComments(text, ext, keep);
        if (runs.length) out.push({ path: rel, runs });
    }
    return out;
}

/**
 * trimToBudget
 * Drops items from the end of a list until the words fit the budget
 * @param items {any[]}
 * @param wordsOf {(item: any) => number}
 * @param budget {number}
 * @return {{kept: any[], dropped: number}}
 **/
function trimToBudget(items, wordsOf, budget) {
    const kept = [];
    let used = 0;
    for (const item of items) {
        const w = wordsOf(item);
        if (used + w > budget && kept.length > 0) break;
        kept.push(item);
        used += w;
    }
    return { kept, dropped: items.length - kept.length };
}

/**
 * buildReport
 * Runs every collector and fits the result to the word budget
 * @param opts {ReturnType<typeof parseArgs>}
 * @return {object}
 **/
function buildReport(opts) {
    const repo = opts.repo;
    if (!git(repo, ['rev-parse', '--is-inside-work-tree']).trim()) {
        throw new Error(`${repo} is not a git repo`);
    }
    const author = resolveAuthor(repo, opts.author);
    if (!author) throw new Error('could not work out the author, pass --author=<email or name>');
    const share = authorShare(repo, author);
    // Blame is slow, only do it when other people have commits here
    const useBlame = opts.blame && share.total > 0 && share.mine < share.total;

    const { commits, aiSkipped } = collectCommits(repo, author, opts.keepAi);
    const samples = collectSamples(opts.samples ?? []);
    const files = authoredFiles(repo, author);
    const docs = collectDocs(repo, files);
    const comments = collectComments(repo, files, author, useBlame);

    // Samples the user handed over come first and are never trimmed, they are the best evidence there is
    const sampleWords = samples.reduce((n, x) => n + countWords(x.text), 0);
    // Commits next but capped so one kind doesn't eat the whole budget
    const commitBudget = Math.floor(opts.maxWords * MAX_COMMIT_WORDS_SHARE);
    const c = trimToBudget(commits, (x) => countWords(x.subject + ' ' + x.body), commitBudget);
    let left = opts.maxWords - c.kept.reduce((n, x) => n + countWords(x.subject + ' ' + x.body), 0);
    const d = trimToBudget(docs, (x) => countWords(x.text), Math.floor(left / 2));
    left -= d.kept.reduce((n, x) => n + countWords(x.text), 0);
    const m = trimToBudget(comments, (x) => countWords(x.runs.join(' ')), left);

    const words = {
        samples: sampleWords,
        commits: c.kept.reduce((n, x) => n + countWords(x.subject + ' ' + x.body), 0),
        docs: d.kept.reduce((n, x) => n + countWords(x.text), 0),
        comments: m.kept.reduce((n, x) => n + countWords(x.runs.join(' ')), 0),
    };
    const kindsWithEvidence = Object.values(words).filter((w) => w >= MIN_KIND_WORDS).length;
    const total = words.samples + words.commits + words.docs + words.comments;

    return {
        repo,
        author,
        share,
        blameUsed: useBlame,
        aiSkipped,
        words,
        totalWords: total,
        kindsWithEvidence,
        enough: total >= ENOUGH_WORDS && kindsWithEvidence >= ENOUGH_KINDS,
        dropped: { commits: c.dropped, docs: d.dropped, comments: m.dropped },
        samples,
        commits: c.kept,
        docs: d.kept,
        comments: m.kept,
    };
}

/**
 * renderText
 * Plain text version of the report, easier for an agent to read than json
 * @param r {object}
 * @return {string}
 **/
function renderText(r) {
    const lines = [];
    lines.push(`==== write-like-me writing samples for ${r.author} ====`);
    lines.push(`repo: ${r.repo}`);
    lines.push(`commits by author: ${r.share.mine} of ${r.share.total}${r.blameUsed ? ' (comments filtered with git blame)' : ''}`);
    if (r.aiSkipped > 0) lines.push(`commits skipped for AI trailers: ${r.aiSkipped} (pass --keep-ai to include them)`);
    lines.push(`words: samples ${r.words.samples}, commits ${r.words.commits}, docs ${r.words.docs}, comments ${r.words.comments}, total ${r.totalWords}`);
    lines.push(`kinds with evidence: ${r.kindsWithEvidence}, enough to skip exercises: ${r.enough ? 'yes' : 'no'}`);
    const drops = Object.entries(r.dropped).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
    if (drops.length) lines.push(`dropped to fit budget: ${drops.join(', ')}`);
    lines.push('');

    if (r.samples.length) {
        lines.push(`==== Samples handed over by the user (${r.samples.length}) ====`);
        lines.push('');
        for (const smp of r.samples) {
            lines.push(`--- ${smp.path} (${smp.words} words)`);
            lines.push(smp.text);
            lines.push('');
        }
    }

    lines.push(`==== Commit messages (${r.commits.length}) ====`);
    lines.push('');
    for (const c of r.commits) {
        lines.push(`--- ${c.hash}`);
        lines.push(c.subject);
        if (c.body) {
            lines.push('');
            lines.push(c.body);
        }
        lines.push('');
    }

    lines.push(`==== Docs (${r.docs.length}) ====`);
    lines.push('');
    for (const d of r.docs) {
        lines.push(`--- ${d.path}`);
        lines.push(d.text);
        lines.push('');
    }

    lines.push(`==== Comments and docstrings (${r.comments.length} files) ====`);
    lines.push('');
    for (const f of r.comments) {
        lines.push(`--- ${f.path}`);
        for (const run of f.runs) {
            lines.push(run);
            lines.push('');
        }
    }
    return lines.join('\n');
}

function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        console.error('usage: node collect-writing.mjs [repo-dir] [--author=<email or name>] [--samples=<file or dir>,...] [--max-words=4000] [--json] [--no-blame] [--keep-ai]');
        process.exit(2);
    }
    let report;
    try {
        report = buildReport(opts);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else console.log(renderText(report));
}

export { extractComments, collectCommits, collectSamples, looksAi, buildReport, renderText, countWords };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}
