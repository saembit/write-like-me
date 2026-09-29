import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, appendFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderRegisterFile, scaffold, loadData, COMMENT_TAG } from '../skills/write-like-me/scripts/scaffold-samples.mjs';
import { collectSamples } from '../skills/write-like-me/scripts/collect-writing.mjs';

const SCRIPT = new URL('../skills/write-like-me/scripts/scaffold-samples.mjs', import.meta.url).pathname;
const tmpHome = () => mkdtempSync(join(tmpdir(), 'wlm-home-'));

test('renderRegisterFile puts prompts in tagged comments and material in a fence', () => {
    const { registers, exercises } = loadData();
    const code = registers.find((r) => r.id === 'code');
    const exs = exercises.filter((e) => e.register === 'code');
    const md = renderRegisterFile(code, exs);
    assert.ok(md.startsWith(`<!--\n${COMMENT_TAG}: Code documentation`));
    for (const e of exs) assert.ok(md.includes(`${COMMENT_TAG}: ${e.title}\n${e.instruction}`), `${e.id} prompt`);
    assert.ok(md.includes('```\nfunction retryFetch'), 'material in a fence');
    // Strip comments the way the collector does and only the material is left
    const left = md.replace(/<!--[\s\S]*?-->/g, '').trim();
    assert.ok(!left.includes('Write the docstring'), 'instruction gone after strip');
    assert.ok(left.startsWith('```'), 'only material left');
});

test('scaffold writes one file per register, all by default, keeps existing unless force', () => {
    const home = tmpHome();
    const first = scaffold({ home, registers: ['chat', 'email'] });
    assert.equal(first.dir, join(home, 'samples'));
    assert.deepEqual(first.written.map((f) => f.split('/').pop()), ['chat.md', 'email.md']);
    assert.deepEqual(first.skipped, []);
    // Second run keeps what the user wrote
    appendFileSync(join(home, 'samples', 'chat.md'), 'hey all, found it\n');
    const second = scaffold({ home, registers: ['chat'] });
    assert.deepEqual(second.written, []);
    assert.equal(second.skipped.length, 1);
    assert.ok(readFileSync(join(home, 'samples', 'chat.md'), 'utf8').includes('hey all, found it'));
    // Force rewrites
    const third = scaffold({ home, registers: ['chat'], force: true });
    assert.equal(third.written.length, 1);
    assert.ok(!readFileSync(join(home, 'samples', 'chat.md'), 'utf8').includes('hey all, found it'));
    // No registers means every register
    const all = scaffold({ home: tmpHome() });
    const { registers } = loadData();
    assert.equal(all.written.length, registers.length);
    assert.throws(() => scaffold({ home: tmpHome(), registers: ['nope'] }), /unknown register/);
});

test('untouched scaffold files are empty to the collector, filled ones keep only the writing', () => {
    const home = tmpHome();
    scaffold({ home, registers: ['chat', 'academic', 'code'] });
    assert.deepEqual(collectSamples([join(home, 'samples')]), [], 'prompts and untouched snippets are not samples');
    // Chat filled in: only the writing survives, with a word count
    appendFileSync(join(home, 'samples', 'chat.md'), 'Hey all, I just found the bug. I\'ll push the fix soon.\n');
    const got = collectSamples([join(home, 'samples')]);
    assert.equal(got.length, 1);
    assert.ok(got[0].path.endsWith('chat.md'));
    assert.equal(got[0].text, 'Hey all, I just found the bug. I\'ll push the fix soon.');
    assert.equal(got[0].words, 12);
    // An edited snippet is theirs, keep it, the untouched one next to it still goes
    const codeFile = join(home, 'samples', 'code.md');
    writeFileSync(codeFile, readFileSync(codeFile, 'utf8').replace('  const seen = new Map();', '  // Map of seen events\n  const seen = new Map();'));
    const code = collectSamples([codeFile]);
    assert.equal(code.length, 1);
    assert.ok(code[0].text.includes('// Map of seen events'));
    assert.ok(!code[0].text.includes('retryFetch'), 'untouched docstring snippet still stripped');
    assert.equal(collectSamples([join(home, 'samples')]).length, 2, 'chat and code now, academic still empty');
    // An editor that saves with CRLF must not turn untouched snippets into evidence
    const crlfHome = tmpHome();
    scaffold({ home: crlfHome, registers: ['code'] });
    const crlfFile = join(crlfHome, 'samples', 'code.md');
    writeFileSync(crlfFile, readFileSync(crlfFile, 'utf8').replace(/\n/g, '\r\n'));
    assert.deepEqual(collectSamples([crlfFile]), [], 'crlf untouched file is still empty');
});

test('cli writes with --home or WRITE_LIKE_ME_HOME, lists registers, fails on bad input', () => {
    const home = tmpHome();
    const out = execFileSync('node', [SCRIPT, 'social', `--home=${home}`], { encoding: 'utf8' });
    assert.ok(out.includes(`written: ${join(home, 'samples', 'social.md')}`));
    assert.ok(existsSync(join(home, 'samples', 'social.md')));
    const list = execFileSync('node', [SCRIPT, '--list'], { encoding: 'utf8' });
    assert.ok(list.includes('chat') && list.includes('Chat and DMs'));
    assert.throws(() => execFileSync('node', [SCRIPT, '--nope'], { stdio: 'pipe' }), (e) => e.status === 2);
    assert.throws(() => execFileSync('node', [SCRIPT, 'nope', `--home=${home}`], { stdio: 'pipe' }), (e) => e.status === 1 && /unknown register/.test(e.stderr));
    const envHome = tmpHome();
    const out2 = execFileSync('node', [SCRIPT, 'email'], { encoding: 'utf8', env: { ...process.env, WRITE_LIKE_ME_HOME: envHome } });
    assert.ok(out2.includes(join(envHome, 'samples', 'email.md')));
});

test('every script still runs as main when invoked through a symlink', () => {
    // ~/.claude/skills/write-like-me is usually a symlink to the repo, argv[1] then differs from import.meta.url
    const linkDir = mkdtempSync(join(tmpdir(), 'wlm-link-'));
    const scriptsDir = new URL('../skills/write-like-me/scripts/', import.meta.url).pathname;
    const repo = new URL('..', import.meta.url).pathname;
    for (const name of ['scaffold-samples.mjs', 'analyze-code.mjs', 'collect-writing.mjs']) {
        symlinkSync(join(scriptsDir, name), join(linkDir, name));
    }
    const list = execFileSync('node', [join(linkDir, 'scaffold-samples.mjs'), '--list'], { encoding: 'utf8' });
    assert.ok(list.includes('Chat and DMs'), 'scaffold ran through the symlink');
    const code = execFileSync('node', [join(linkDir, 'analyze-code.mjs'), scriptsDir, '--json'], { encoding: 'utf8' });
    assert.ok(code.includes('"suggestions"'), 'analyze-code ran through the symlink');
    const writing = execFileSync('node', [join(linkDir, 'collect-writing.mjs'), repo], { encoding: 'utf8' });
    assert.ok(writing.startsWith('==== write-like-me'), 'collect-writing ran through the symlink');
});
