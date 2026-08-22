import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractComments, buildReport, renderText, looksAi, collectSamples } from '../skills/write-like-me/scripts/collect-writing.mjs';

const SCRIPT = new URL('../skills/write-like-me/scripts/collect-writing.mjs', import.meta.url).pathname;

// Builds a throwaway repo with two authors so blame filtering gets exercised
function makeRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'wlm-collect-'));
    const git = (args, env = {}) => execFileSync('git', ['-C', dir, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z', ...env },
        stdio: 'pipe',
    });
    const me = { GIT_AUTHOR_NAME: 'Me', GIT_AUTHOR_EMAIL: 'me@example.com', GIT_COMMITTER_NAME: 'Me', GIT_COMMITTER_EMAIL: 'me@example.com' };
    const them = { GIT_AUTHOR_NAME: 'Them', GIT_AUTHOR_EMAIL: 'them@example.com', GIT_COMMITTER_NAME: 'Them', GIT_COMMITTER_EMAIL: 'them@example.com' };
    git(['init', '-q']);
    git(['config', 'user.email', 'me@example.com']);
    git(['config', 'user.name', 'Me']);

    // Their file with their comments
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'theirs.js'), '// Their comment, very formal.\nexport const x = 1;\n');
    git(['add', '.'], them);
    git(['commit', '-q', '-m', 'Their initial commit'], them);

    // My file, my readme, my comments
    writeFileSync(join(dir, 'src', 'mine.js'), '// Map of seen events\nconst seen = new Map();\n\n/** retry\n * Tries again\n **/\nfunction retry() {}\n');
    writeFileSync(join(dir, 'README.md'), '# thing\n\nMake your AI an extention of yourself. It may not be perfect but it\'s better than nothing.\n');
    writeFileSync(join(dir, 'CHANGELOG.md'), '## 1.0.0\n- stuff\n');
    git(['add', '.'], me);
    git(['commit', '-q', '-m', 'Fix: env vars were read in in the wrong file\n\n## Problem\nServer logs were grouped by UTC\n\n## Solution\nUnified the timezone settings'], me);

    // I append one comment line to their file, so blame should keep only that line
    writeFileSync(join(dir, 'src', 'theirs.js'), '// Their comment, very formal.\nexport const x = 1;\n// Get the value if it exists\nexport const y = x;\n');
    git(['add', '.'], me);
    git(['commit', '-q', '-m', 'Add y'], me);

    // A commit an AI wrote for me, should be skipped by default
    writeFileSync(join(dir, 'src', 'ai.js'), 'export const z = 3;\n');
    git(['add', '.'], me);
    git(['commit', '-q', '-m', 'Refactor the module for clarity\n\nThis change improves maintainability.\n\nCo-Authored-By: Claude <noreply@anthropic.com>'], me);
    return dir;
}

test('extractComments groups runs and honours the keep set', () => {
    const js = 'const a = 1;\n// one\n// two\nconst b = 2;\n/* block\n   still block */\nconst c = 3;\n';
    const runs = extractComments(js, '.js', null);
    assert.deepEqual(runs, ['// one\n// two', '/* block\nstill block */']);
    const onlySecond = extractComments(js, '.js', new Set([3]));
    assert.deepEqual(onlySecond, ['// two']);
});

test('extractComments handles python hashes and docstrings', () => {
    const py = '#!/usr/bin/env python\nimport os\n# a comment\ndef f():\n    """Doc line one\n    line two\n    """\n    return 1\n';
    const runs = extractComments(py, '.py', null);
    assert.deepEqual(runs, ['# a comment', '"""Doc line one\nline two\n"""']);
});

test('buildReport filters to the author and uses blame when others have commits', () => {
    const dir = makeRepo();
    const r = buildReport({ repo: dir, author: null, samples: [], maxWords: 4000, json: true, blame: true, keepAi: false });
    assert.equal(r.author, 'me@example.com');
    assert.equal(r.share.mine, 3);
    assert.equal(r.share.total, 4);
    assert.equal(r.blameUsed, true);
    assert.equal(r.aiSkipped, 1);
    // Commits: only mine, newest first, body kept
    assert.deepEqual(r.commits.map((c) => c.subject), ['Add y', 'Fix: env vars were read in in the wrong file']);
    assert.match(r.commits[1].body, /## Problem/);
    // Docs: README yes, CHANGELOG skipped
    assert.deepEqual(r.docs.map((d) => d.path), ['README.md']);
    // Comments: my lines only
    const all = r.comments.flatMap((f) => f.runs).join('\n');
    assert.ok(all.includes('// Map of seen events'));
    assert.ok(all.includes('// Get the value if it exists'));
    assert.ok(!all.includes('Their comment'));
    assert.ok(r.words.commits > 0 && r.words.docs > 0 && r.words.comments > 0);
    assert.equal(r.enough, false, 'tiny repo is not enough evidence');
});

test('looksAi catches the usual trailers and leaves human messages alone', () => {
    assert.equal(looksAi('Fix thing', 'Co-Authored-By: Claude <noreply@anthropic.com>'), true);
    assert.equal(looksAi('Fix thing', 'Co-authored-by: GitHub Copilot <copilot@github.com>'), true);
    assert.equal(looksAi('Fix thing', '🤖 Generated with [Claude Code](https://claude.com/claude-code)'), true);
    assert.equal(looksAi('Fix thing', 'Claude-Session: https://claude.ai/code/session_x'), true);
    assert.equal(looksAi('Fix thing', 'Co-Authored-By: Pat Human <pat@example.com>'), false);
    assert.equal(looksAi('Add claude to the list of names', 'he is a friend'), false);
});

test('keep-ai keeps the AI commit and it shows in the list', () => {
    const dir = makeRepo();
    const r = buildReport({ repo: dir, author: 'me@example.com', samples: [], maxWords: 4000, json: true, blame: false, keepAi: true });
    assert.equal(r.aiSkipped, 0);
    assert.ok(r.commits.some((c) => c.subject === 'Refactor the module for clarity'));
});

test('samples are read from files and dirs, come first, and are never trimmed', () => {
    const dir = makeRepo();
    const sdir = mkdtempSync(join(tmpdir(), 'wlm-samples-'));
    writeFileSync(join(sdir, 'one.txt'), 'Hey all, I just found the bug that was causing the OAuth flow to mess up.');
    mkdirSync(join(sdir, 'more'));
    writeFileSync(join(sdir, 'more', 'two.md'), '# Write Like Me\n\nIt may not be perfect but it\'s better than nothing.');
    writeFileSync(join(sdir, '.hidden'), 'should be skipped');
    const direct = collectSamples([sdir]);
    assert.deepEqual(direct.map((x) => x.path.endsWith('one.txt') || x.path.endsWith('two.md')), [true, true]);
    const r = buildReport({ repo: dir, author: 'me@example.com', samples: [sdir], maxWords: 10, json: true, blame: false, keepAi: false });
    assert.equal(r.samples.length, 2);
    assert.ok(r.words.samples > 10, 'samples ignore the word budget');
    const text = renderText(r);
    assert.ok(text.indexOf('==== Samples handed over by the user (2) ====') < text.indexOf('==== Commit messages'));
    const out = execFileSync('node', [SCRIPT, dir, `--samples=${join(sdir, 'one.txt')},${join(sdir, 'more')}`], { encoding: 'utf8' });
    assert.ok(out.includes('words: samples'));
    assert.ok(out.includes('Hey all, I just found the bug'));
});

test('no-blame keeps everything in touched files', () => {
    const dir = makeRepo();
    const r = buildReport({ repo: dir, author: 'me@example.com', maxWords: 4000, json: true, blame: false });
    assert.equal(r.blameUsed, false);
    const all = r.comments.flatMap((f) => f.runs).join('\n');
    assert.ok(all.includes('Their comment'));
});

test('max-words budget drops items and reports it', () => {
    const dir = makeRepo();
    const r = buildReport({ repo: dir, author: 'me@example.com', maxWords: 10, json: true, blame: false });
    assert.ok(r.totalWords <= 40, 'stays near the budget, one item per kind minimum');
    assert.ok(r.dropped.commits + r.dropped.docs + r.dropped.comments >= 1);
});

test('renderText has the section markers and cli prints it', () => {
    const dir = makeRepo();
    const r = buildReport({ repo: dir, author: 'me@example.com', maxWords: 4000, json: true, blame: true });
    const text = renderText(r);
    assert.ok(text.includes('==== Commit messages (2) ===='), 'AI commit is not counted');
    assert.ok(text.includes('==== Docs (1) ===='));
    assert.ok(text.includes('==== Comments and docstrings'));
    const out = execFileSync('node', [SCRIPT, dir], { encoding: 'utf8' });
    assert.ok(out.startsWith('==== write-like-me writing samples for me@example.com ===='));
    const j = JSON.parse(execFileSync('node', [SCRIPT, dir, '--json'], { encoding: 'utf8' }));
    assert.equal(j.author, 'me@example.com');
});

test('cli fails cleanly outside a git repo and on bad flags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlm-nogit-'));
    assert.throws(() => execFileSync('node', [SCRIPT, dir], { stdio: 'pipe' }), (e) => e.status === 1 && /not a git repo/.test(e.stderr));
    assert.throws(() => execFileSync('node', [SCRIPT, '--nope'], { stdio: 'pipe' }), (e) => e.status === 2);
});
