import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeSample, analyzeSamples } from '../skills/write-like-me/scripts/analyze-code.mjs';

const SCRIPT = new URL('../skills/write-like-me/scripts/analyze-code.mjs', import.meta.url).pathname;

// A small js file with one comment per statement, like the sample in WRITING-SAMPLE.txt
const DENSE_JS = `function dedupeEvents(events) {
  // Map of seen events
  const seen = new Map();
  // Loop iterating through events in the parameter
  for (const e of events) {
    // The key for the current event
    const key = \`\${e.type}:\${e.entityId}\`;
    // Get the value if the key already exists in the map
    const prev = seen.get(key);
    // Check if the key is not already in the map then set it
    if (!prev || e.timestamp > prev.timestamp) {
      seen.set(key, e);
    }
  }
  // Return a sorted list of values
  return [...seen.values()].sort((a, b) => a.timestamp - b.timestamp);
}
`;

const BARE_PY = `def add(a, b):
    return a + b


def sub(a, b):
    return a - b


class Thing:
    def run(self):
        total = 0
        for i in range(10):
            total += i
        return total
`;

test('detects language from extension', () => {
    assert.equal(analyzeSample({ name: 'a.ts', content: '' }).language, 'typescript');
    assert.equal(analyzeSample({ name: 'a.py', content: '' }).language, 'python');
    assert.equal(analyzeSample({ name: 'a.go', content: '' }).language, 'go');
    assert.equal(analyzeSample({ name: 'a.rs', content: '' }).language, 'rust');
    assert.equal(analyzeSample({ name: 'a.txt', content: '' }).language, 'unknown');
});

test('counts comment lines and code lines in js', () => {
    const r = analyzeSample({ name: 'dedupe.js', content: DENSE_JS });
    assert.equal(r.commentLines, 6);
    assert.equal(r.loc, 17);
    assert.equal(r.functionLengths.length, 1);
    assert.equal(r.functionLengths[0], 17);
});

test('measures python functions by indentation', () => {
    const r = analyzeSample({ name: 'x.py', content: BARE_PY });
    assert.equal(r.commentLines, 0);
    // add, sub, run
    assert.equal(r.functionLengths.length, 3);
    assert.ok(r.functionLengths.every((n) => n >= 2));
});

test('counts acronym casing hits', () => {
    const caps = analyzeSample({ name: 'a.ts', content: 'const parseURL = 1; const fetchHTTP = 2; const userID = 3;' });
    assert.equal(caps.acronymUppercaseHits, 3);
    assert.equal(caps.acronymTitleCaseHits, 0);
    const title = analyzeSample({ name: 'a.ts', content: 'const parseUrl = 1; const fetchHttp = 2; const userId = 3;' });
    assert.equal(title.acronymTitleCaseHits, 3);
    assert.equal(title.acronymUppercaseHits, 0);
});

test('suggestions only appear with enough evidence and carry the right shape', () => {
    const small = analyzeSamples([{ name: 'a.js', content: 'const a = 1;' }]);
    assert.deepEqual(small.suggestions, []);

    // Pad the dense sample so totalLoc clears the 30 line floor for comments.density
    const padded = DENSE_JS.repeat(3);
    const r = analyzeSamples([{ name: 'a.js', content: padded }]);
    const density = r.suggestions.find((s) => s.questionId === 'comments.density');
    assert.ok(density, 'comments.density suggested');
    assert.equal(density.answer.kind, 'spectrum');
    assert.equal(density.answerLabel, 'Heavy');
    assert.ok(['low', 'medium', 'high'].includes(density.confidence));
    assert.match(density.rationale, /comments per 100 lines/);
    for (const s of r.suggestions) {
        assert.ok(s.questionId && s.prompt && s.answer && s.answerLabel && s.confidence && s.rationale);
    }
});

test('cli walks a dir, skips node_modules and prints slim json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlm-analyze-'));
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.js'), DENSE_JS);
    writeFileSync(join(dir, 'src', 'b.py'), BARE_PY);
    writeFileSync(join(dir, 'src', 'notes.txt'), 'not code');
    writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;');
    const out = JSON.parse(execFileSync('node', [SCRIPT, dir], { encoding: 'utf8' }));
    assert.equal(out.files, 2);
    assert.equal(out.perSample.length, 2);
    assert.ok(out.aggregate.totalLoc > 0);
    assert.ok(Array.isArray(out.suggestions));
    // Per sample entries are slim, no identifier arrays
    assert.equal(out.perSample[0].identifierLengths, undefined);
});

test('cli reads paths from stdin with - and skips missing files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlm-stdin-'));
    writeFileSync(join(dir, 'a.js'), DENSE_JS);
    const input = [join(dir, 'a.js'), join(dir, 'gone.js'), ''].join('\n');
    const out = JSON.parse(execFileSync('node', [SCRIPT, '-'], { encoding: 'utf8', input }));
    assert.equal(out.files, 1);
});

test('cli exits 2 with no args and 1 with no source files', () => {
    assert.throws(() => execFileSync('node', [SCRIPT], { stdio: 'pipe' }), (e) => e.status === 2);
    const dir = mkdtempSync(join(tmpdir(), 'wlm-empty-'));
    writeFileSync(join(dir, 'readme.md'), '# nothing');
    assert.throws(() => execFileSync('node', [SCRIPT, dir], { stdio: 'pipe' }), (e) => e.status === 1);
});
