#!/usr/bin/env node
/**
 * analyze-code.mjs
 * Zero dependency heuristics over code files. Measures comment density, function length,
 * identifier length and acronym casing, then suggests answers for questions in data/questions.json
 * Usage: node analyze-code.mjs <file-or-dir> [...more] [--json]
 *        git log --author=me --name-only --format= | sort -u | node analyze-code.mjs -   (reads paths from stdin)
 * Ported from the write-like-me web app (src/server/analyze.ts)
 **/
import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT_TO_LANGUAGE = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    pyi: 'python',
    go: 'go',
    rs: 'rust',
};
const LANGUAGE_KEYWORDS = {
    typescript: new Set([
        'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
        'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super',
        'import', 'export', 'from', 'as', 'default', 'async', 'await', 'try', 'catch',
        'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'true', 'false', 'null',
        'undefined', 'void', 'type', 'interface', 'enum', 'public', 'private', 'protected',
        'readonly', 'static', 'abstract', 'implements', 'namespace', 'declare',
    ]),
    javascript: new Set([
        'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
        'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super',
        'import', 'export', 'from', 'as', 'default', 'async', 'await', 'try', 'catch',
        'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'true', 'false', 'null',
        'undefined', 'void',
    ]),
    python: new Set([
        'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue',
        'class', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with',
        'pass', 'lambda', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is',
        'global', 'nonlocal', 'yield', 'async', 'await', 'self', 'cls',
    ]),
    go: new Set([
        'func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default',
        'break', 'continue', 'fallthrough', 'package', 'import', 'type', 'struct',
        'interface', 'map', 'chan', 'go', 'defer', 'select', 'var', 'const', 'true',
        'false', 'nil', 'iota',
    ]),
    rust: new Set([
        'fn', 'let', 'mut', 'return', 'if', 'else', 'match', 'for', 'while', 'loop',
        'break', 'continue', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod',
        'crate', 'self', 'Self', 'true', 'false', 'as', 'in', 'ref', 'move', 'async',
        'await', 'where', 'type', 'const', 'static', 'unsafe', 'extern', 'dyn', 'box',
    ]),
    unknown: new Set(),
};
const TITLE_CASED_ACRONYMS = ['Url', 'Html', 'Http', 'Api', 'Id', 'Sql', 'Json', 'Xml', 'Css', 'Uri', 'Dom', 'Tcp', 'Udp', 'Ssl', 'Tls'];
function detectLanguage(name) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return EXT_TO_LANGUAGE[ext] ?? 'unknown';
}
function isCommentLine(line, language) {
    const trimmed = line.trim();
    if (trimmed === '')
        return false;
    if (language === 'python')
        return trimmed.startsWith('#');
    // JS/TS/Go/Rust + unknown: count // lines (and /* on same line as content)
    if (trimmed.startsWith('//'))
        return true;
    if (trimmed.startsWith('/*') || trimmed.startsWith('*'))
        return true;
    return false;
}
function isCodeLine(line, language) {
    const trimmed = line.trim();
    if (trimmed === '')
        return false;
    if (isCommentLine(line, language))
        return false;
    return true;
}
function findFunctionStartsBraceLanguage(lines, language) {
    const decls = [];
    let pattern;
    switch (language) {
        case 'typescript':
        case 'javascript':
            pattern = /\b(?:function\s+\w+\s*\(|function\s*\(|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?function\b)/;
            break;
        case 'go':
            pattern = /\bfunc\s+(?:\([^)]*\)\s+)?\w+\s*\(/;
            break;
        case 'rust':
            pattern = /\bfn\s+\w+\s*\(/;
            break;
        default:
            return decls;
    }
    for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
            decls.push({ startLine: i, bodyIndent: 0, declLine: lines[i] });
        }
    }
    return decls;
}
function measureFunctionLengthBrace(lines, startLine) {
    let depth = 0;
    let opened = false;
    let i = startLine;
    while (i < lines.length) {
        const line = lines[i];
        for (const ch of line) {
            if (ch === '{') {
                depth++;
                opened = true;
            }
            else if (ch === '}') {
                depth--;
                if (opened && depth === 0) {
                    return i - startLine + 1;
                }
            }
        }
        i++;
        if (i - startLine > 5000)
            return i - startLine;
    }
    if (!opened)
        return 1;
    return i - startLine;
}
function measurePythonFunctionLengths(lines) {
    const lengths = [];
    const defPattern = /^(\s*)(?:async\s+)?def\s+\w+\s*\(/;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(defPattern);
        if (!m)
            continue;
        const defIndent = m[1].length;
        let end = i;
        for (let j = i + 1; j < lines.length; j++) {
            const next = lines[j];
            if (next.trim() === '') {
                end = j;
                continue;
            }
            const indent = next.length - next.trimStart().length;
            if (indent > defIndent) {
                end = j;
            }
            else {
                break;
            }
        }
        lengths.push(end - i + 1);
    }
    return lengths;
}
function functionLengthsFor(lines, language) {
    if (language === 'python')
        return measurePythonFunctionLengths(lines);
    if (language === 'typescript' || language === 'javascript' || language === 'go' || language === 'rust') {
        const decls = findFunctionStartsBraceLanguage(lines, language);
        return decls.map((d) => measureFunctionLengthBrace(lines, d.startLine));
    }
    return [];
}
function extractIdentifiers(content, language) {
    const keywords = LANGUAGE_KEYWORDS[language];
    const matches = content.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    return matches.filter((id) => {
        if (id.length === 0)
            return false;
        if (keywords.has(id))
            return false;
        if (/^\d/.test(id))
            return false;
        return true;
    });
}
function countAcronymHits(identifiers) {
    let uppercaseHits = 0;
    let titleCaseHits = 0;
    const upperPattern = /[a-z][A-Z]{2,}/;
    const upperEndPattern = /[A-Z]{2,}$/;
    const titlePattern = new RegExp(`(?:^|[a-z])(${TITLE_CASED_ACRONYMS.join('|')})(?:[A-Z]|$)`);
    for (const id of identifiers) {
        if (upperPattern.test(id) || upperEndPattern.test(id))
            uppercaseHits++;
        if (titlePattern.test(id))
            titleCaseHits++;
    }
    return { uppercaseHits, titleCaseHits };
}
export function analyzeSample(sample) {
    const language = detectLanguage(sample.name);
    const lines = sample.content.split('\n');
    let commentLines = 0;
    let codeLines = 0;
    let totalLineLength = 0;
    let nonEmptyLines = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '')
            continue;
        nonEmptyLines++;
        totalLineLength += line.length;
        if (isCommentLine(line, language))
            commentLines++;
        else if (isCodeLine(line, language))
            codeLines++;
    }
    const avgLineLength = nonEmptyLines > 0 ? totalLineLength / nonEmptyLines : 0;
    const functionLengths = functionLengthsFor(lines, language);
    const identifiers = extractIdentifiers(sample.content, language);
    const identifierLengths = identifiers.map((id) => id.length);
    const { uppercaseHits, titleCaseHits } = countAcronymHits(identifiers);
    return {
        name: sample.name,
        language,
        loc: codeLines + commentLines,
        commentLines,
        avgLineLength,
        functionLengths,
        identifierLengths,
        acronymUppercaseHits: uppercaseHits,
        acronymTitleCaseHits: titleCaseHits,
    };
}
function aggregate(perSample) {
    let totalLoc = 0;
    let totalCommentLines = 0;
    const allFunctionLengths = [];
    const allIdentifierLengths = [];
    let acronymUppercaseHits = 0;
    let acronymTitleCaseHits = 0;
    for (const s of perSample) {
        totalLoc += s.loc;
        totalCommentLines += s.commentLines;
        allFunctionLengths.push(...s.functionLengths);
        allIdentifierLengths.push(...s.identifierLengths);
        acronymUppercaseHits += s.acronymUppercaseHits;
        acronymTitleCaseHits += s.acronymTitleCaseHits;
    }
    const commentsPer100Loc = totalLoc > 0 ? (totalCommentLines / totalLoc) * 100 : 0;
    const avgFunctionLength = allFunctionLengths.length > 0
        ? allFunctionLengths.reduce((a, b) => a + b, 0) / allFunctionLengths.length
        : undefined;
    const avgIdentifierLength = allIdentifierLengths.length > 0
        ? allIdentifierLengths.reduce((a, b) => a + b, 0) / allIdentifierLengths.length
        : undefined;
    return {
        totalSamples: perSample.length,
        totalLoc,
        totalCommentLines,
        commentsPer100Loc,
        avgFunctionLength,
        functionsDetected: allFunctionLengths.length,
        avgIdentifierLength,
        identifiersAnalyzed: allIdentifierLengths.length,
        acronymUppercaseHits,
        acronymTitleCaseHits,
    };
}
function bucketize(value, thresholds) {
    for (let i = 0; i < thresholds.length; i++) {
        if (value < thresholds[i])
            return i;
    }
    return thresholds.length;
}
function suggestCommentsDensity(agg) {
    if (agg.totalLoc < 30)
        return null;
    const step = bucketize(agg.commentsPer100Loc, [0.5, 2, 5, 10]);
    const confidence = agg.totalLoc >= 200 ? 'high' : agg.totalLoc >= 80 ? 'medium' : 'low';
    return {
        questionId: 'comments.density',
        prompt: 'How dense are comments in code you write?',
        answer: { kind: 'spectrum', value: step },
        answerLabel: ['Bare', 'Sparse', 'Moderate', 'Dense', 'Heavy'][step],
        confidence,
        rationale: `${agg.commentsPer100Loc.toFixed(1)} comments per 100 lines of code across ${agg.totalLoc} lines.`,
    };
}
function suggestFunctionSize(agg) {
    if (agg.avgFunctionLength === undefined || agg.functionsDetected < 3)
        return null;
    const step = bucketize(agg.avgFunctionLength, [15, 25, 40, 60]);
    const confidence = agg.functionsDetected >= 15 ? 'high' : agg.functionsDetected >= 6 ? 'medium' : 'low';
    return {
        questionId: 'functions.size',
        prompt: 'Preferred function size?',
        answer: { kind: 'spectrum', value: step },
        answerLabel: ['≤ 15 lines', '~ 25 lines', '25-40 lines', '40-60 lines', '60+ lines'][step],
        confidence,
        rationale: `Average function length is ${agg.avgFunctionLength.toFixed(1)} lines across ${agg.functionsDetected} detected functions.`,
    };
}
function suggestNamingVerbosity(agg) {
    if (agg.avgIdentifierLength === undefined || agg.identifiersAnalyzed < 50)
        return null;
    const step = bucketize(agg.avgIdentifierLength, [4, 6, 9, 13]);
    const confidence = agg.identifiersAnalyzed >= 500 ? 'high' : agg.identifiersAnalyzed >= 150 ? 'medium' : 'low';
    return {
        questionId: 'naming.verbosity',
        prompt: 'How verbose should identifier names be?',
        answer: { kind: 'spectrum', value: step },
        answerLabel: ['Very terse', 'Terse', 'Balanced', 'Descriptive', 'Very descriptive'][step],
        confidence,
        rationale: `Average identifier length is ${agg.avgIdentifierLength.toFixed(1)} characters across ${agg.identifiersAnalyzed} identifiers.`,
    };
}
function suggestAcronymCasing(agg) {
    const total = agg.acronymUppercaseHits + agg.acronymTitleCaseHits;
    if (total < 5)
        return null;
    const titleRatio = agg.acronymTitleCaseHits / total;
    let value;
    let label;
    if (titleRatio >= 0.7) {
        value = 'title-case';
        label = 'parseUrl, fetchHttp';
    }
    else if (titleRatio <= 0.3) {
        value = 'all-caps';
        label = 'parseURL, fetchHTTP';
    }
    else {
        value = 'context-dependent';
        label = 'It depends';
    }
    const confidence = total >= 20 ? 'high' : total >= 10 ? 'medium' : 'low';
    return {
        questionId: 'naming.acronyms',
        prompt: 'How do you case acronyms inside identifiers?',
        answer: { kind: 'single-choice', value },
        answerLabel: label,
        confidence,
        rationale: `Found ${agg.acronymTitleCaseHits} title-cased acronyms (e.g. parseUrl) and ${agg.acronymUppercaseHits} all-caps acronyms (e.g. parseURL).`,
    };
}
function buildSuggestions(agg) {
    const all = [
        suggestCommentsDensity(agg),
        suggestFunctionSize(agg),
        suggestNamingVerbosity(agg),
        suggestAcronymCasing(agg),
    ];
    return all.filter((s) => s !== null);
}
export function analyzeSamples(samples) {
    const perSample = samples.map(analyzeSample);
    const agg = aggregate(perSample);
    const suggestions = buildSuggestions(agg);
    return { perSample, aggregate: agg, suggestions };
}

// ---- CLI ----------------------------------------------------------------

const ACCEPTED = new Set(Object.keys(EXT_TO_LANGUAGE).map((e) => '.' + e));
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'vendor', '.venv', '__pycache__']);
const MAX_FILES = 400;
const MAX_BYTES = 2_000_000;

// Walk a path and collect source files we know how to analyze
// Missing paths are skipped so piping git log --name-only through xargs works even when files were deleted
function collect(path, out) {
    if (out.length >= MAX_FILES) return;
    if (!existsSync(path)) return;
    const st = statSync(path);
    if (st.isDirectory()) {
        for (const name of readdirSync(path)) {
            if (SKIP_DIRS.has(name)) continue;
            collect(join(path, name), out);
        }
        return;
    }
    if (!ACCEPTED.has(extname(path).toLowerCase())) return;
    if (st.size > MAX_BYTES) return;
    out.push(path);
}

function main() {
    let args = process.argv.slice(2).filter((a) => a !== '--json');
    // A lone - means read one path per line from stdin, handy after git log --name-only
    if (args.includes('-')) {
        const piped = readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
        args = args.filter((a) => a !== '-').concat(piped);
    }
    if (args.length === 0) {
        console.error('usage: node analyze-code.mjs <file-or-dir> [...more]   or   ... | node analyze-code.mjs -');
        process.exit(2);
    }
    const files = [];
    for (const a of args) collect(a, files);
    if (files.length === 0) {
        console.error('no supported source files found (ts, js, py, go, rs)');
        process.exit(1);
    }
    const samples = files.map((f) => ({ name: f, content: readFileSync(f, 'utf8') }));
    const report = analyzeSamples(samples);
    // Drop the per-identifier arrays, they are huge and the agent only needs the aggregate
    const slim = {
        files: files.length,
        aggregate: report.aggregate,
        suggestions: report.suggestions,
        perSample: report.perSample.map((s) => ({
            name: s.name,
            language: s.language,
            loc: s.loc,
            commentLines: s.commentLines,
            functions: s.functionLengths.length,
        })),
    };
    console.log(JSON.stringify(slim, null, 2));
}

/**
 * isMain
 * True when this file is the script node was started with, through a symlink or not.
 * argv[1] keeps the symlink path while import.meta.url is the real one, so compare real paths
 * @return {boolean}
 **/
function isMain() {
    if (!process.argv[1]) return false;
    try {
        return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
}

if (isMain()) {
    main();
}
