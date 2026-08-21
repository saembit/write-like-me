import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../skills/write-like-me/', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const json = (p) => JSON.parse(read(p));

const questions = json('data/questions.json');
const pairs = json('data/snippet-pairs.json');
const exercises = json('data/exercises.json');
const byId = new Map(questions.map((q) => [q.id, q]));

const AXES = new Set(['naming', 'comments', 'functions', 'errors']);

test('questions.json has 14 unique questions across the 4 axes', () => {
    assert.equal(questions.length, 14);
    assert.equal(new Set(questions.map((q) => q.id)).size, 14);
    for (const q of questions) {
        assert.ok(AXES.has(q.axis), `${q.id} axis`);
        assert.ok(q.prompt, `${q.id} prompt`);
        assert.ok(q.id.startsWith(q.axis + '.'), `${q.id} id prefix matches axis`);
    }
    for (const axis of AXES) {
        assert.ok(questions.some((q) => q.axis === axis), `axis ${axis} has questions`);
    }
});

test('spectrum questions have prose and glance per step', () => {
    for (const q of questions.filter((q) => q.kind === 'spectrum')) {
        assert.ok(q.steps >= 2, `${q.id} steps`);
        assert.ok(q.leftLabel && q.rightLabel, `${q.id} labels`);
        assert.equal(q.prose.length, q.steps, `${q.id} prose per step`);
        // glance is optional, but when present it has one entry per step
        if (q.glance) assert.equal(q.glance.length, q.steps, `${q.id} glance per step`);
        assert.ok(q.prose.every((p) => p.length > 0), `${q.id} prose not empty`);
    }
});

test('single-choice questions have complete choices', () => {
    for (const q of questions.filter((q) => q.kind === 'single-choice')) {
        assert.ok(q.choices.length >= 2, `${q.id} choices`);
        assert.equal(new Set(q.choices.map((c) => c.value)).size, q.choices.length, `${q.id} unique values`);
        for (const c of q.choices) {
            // glance and avoids are optional, same as the web app schema
            assert.ok(c.value && c.label && c.prose, `${q.id}/${c.value} fields`);
        }
    }
});

test('every question is one of the two kinds', () => {
    for (const q of questions) {
        assert.ok(['spectrum', 'single-choice'].includes(q.kind), `${q.id} kind`);
    }
});

test('snippet pairs point at real questions with valid answers', () => {
    assert.ok(pairs.length >= 10);
    assert.equal(new Set(pairs.map((p) => p.id)).size, pairs.length);
    for (const p of pairs) {
        assert.ok(AXES.has(p.axis), `${p.id} axis`);
        assert.ok(p.varies && p.language, `${p.id} meta`);
        for (const side of ['left', 'right']) {
            const s = p[side];
            assert.ok(s.label && s.code, `${p.id} ${side} label/code`);
            assert.ok(s.signals.length >= 1, `${p.id} ${side} signals`);
            for (const sig of s.signals) {
                const q = byId.get(sig.questionId);
                assert.ok(q, `${p.id} ${side} -> ${sig.questionId} exists`);
                assert.equal(sig.answer.kind, q.kind, `${p.id} ${side} -> ${sig.questionId} kind`);
                if (q.kind === 'spectrum') {
                    assert.ok(Number.isInteger(sig.answer.value) && sig.answer.value >= 0 && sig.answer.value < q.steps, `${p.id} ${side} -> ${sig.questionId} value in range`);
                } else {
                    assert.ok(q.choices.some((c) => c.value === sig.answer.value), `${p.id} ${side} -> ${sig.questionId} value ${sig.answer.value} is a choice`);
                }
                assert.ok(sig.weight > 0, `${p.id} ${side} weight`);
            }
        }
    }
});

test('exercises are 3 prose and 3 code-doc with the fields the flow needs', () => {
    assert.equal(exercises.length, 6);
    assert.equal(new Set(exercises.map((e) => e.id)).size, 6);
    assert.equal(exercises.filter((e) => e.kind === 'prose').length, 3);
    assert.equal(exercises.filter((e) => e.kind === 'code-doc').length, 3);
    for (const e of exercises) {
        assert.ok(e.title && e.instruction && e.placeholder, `${e.id} fields`);
        assert.ok(e.minChars > 0, `${e.id} minChars`);
    }
});

test('style analysis rubric names every WritingStyleReport field', () => {
    const rubric = read('data/style-analysis-prompt.md');
    const fields = [
        'atAGlance',
        'general.voiceAndTone', 'general.sentenceStructure', 'general.vocabulary', 'general.formatting', 'general.guidelines',
        'codeDocs.docstrings', 'codeDocs.inlineComments', 'codeDocs.commitMessages', 'codeDocs.guidelines',
        'avoids',
    ];
    for (const f of fields) assert.ok(rubric.includes(f), `rubric mentions ${f}`);
});

test('templates carry start and end markers and the placeholders match the report fields', () => {
    const code = read('templates/CODE-STYLE.md');
    const writing = read('templates/WRITING-STYLE.md');
    assert.ok(code.includes('<!-- write-like-me:code-style:start -->') && code.includes('<!-- write-like-me:code-style:end -->'));
    assert.ok(writing.includes('<!-- write-like-me:writing-style:start -->') && writing.includes('<!-- write-like-me:writing-style:end -->'));
    for (const f of ['general.voiceAndTone', 'general.sentenceStructure', 'general.vocabulary', 'general.formatting', 'general.guidelines', 'codeDocs.docstrings', 'codeDocs.inlineComments', 'codeDocs.commitMessages', 'codeDocs.guidelines', 'atAGlance', 'avoids']) {
        assert.ok(writing.includes(`{{${f}`), `writing template has {{${f}`);
    }
});

test('SKILL.md frontmatter follows the agent skills spec', () => {
    const skill = read('SKILL.md');
    const fm = skill.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, 'has frontmatter');
    const name = fm[1].match(/^name:\s*(.+)$/m)?.[1].trim();
    const description = fm[1].match(/^description:\s*(.+)$/m)?.[1].trim();
    assert.equal(name, 'write-like-me');
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(description && description.length <= 1024, 'description present and under 1024 chars');
});
