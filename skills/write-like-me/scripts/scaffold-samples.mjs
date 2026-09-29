#!/usr/bin/env node
/**
 * scaffold-samples.mjs
 * Writes one markdown file per writing register into <home>/samples so the user can do the
 * exercises in their own editor instead of typing essays into a chat prompt. The prompts sit
 * inside <!-- write-like-me --> comments and collect-writing.mjs strips those, so only what the
 * user writes gets analyzed.
 * Usage: node scaffold-samples.mjs [register ...] [--home=<dir>] [--force] [--list]
 * Home is $WRITE_LIKE_ME_HOME or ~/.write-like-me. No registers means all of them.
 **/
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Where the data files live, next to this script
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
// Every instruction comment starts with this so the collector and a human can tell them apart
const COMMENT_TAG = 'write-like-me';

/**
 * defaultHome
 * The global write-like-me dir, env override first
 * @return {string}
 **/
function defaultHome() {
    return process.env.WRITE_LIKE_ME_HOME || join(homedir(), '.write-like-me');
}

/**
 * loadData
 * Reads registers and exercises from the data dir
 * @param dataDir = DATA_DIR {string}
 * @return {{registers: object[], exercises: object[]}}
 **/
function loadData(dataDir = DATA_DIR) {
    const registers = JSON.parse(readFileSync(join(dataDir, 'registers.json'), 'utf8'));
    const exercises = JSON.parse(readFileSync(join(dataDir, 'exercises.json'), 'utf8'));
    return { registers, exercises };
}

/**
 * note
 * Wraps text in a tagged html comment, one line per input line
 * @param lines {string[]}
 * @return {string}
 **/
function note(lines) {
    return ['<!--', `${COMMENT_TAG}: ${lines[0]}`, ...lines.slice(1), '-->'].join('\n');
}

/**
 * renderRegisterFile
 * The markdown for one register: a header comment, then a prompt comment per exercise
 * with the material (if any) in a fenced block the user edits in place
 * @param register {object}
 * @param exercises {object[]} - the exercises that belong to this register
 * @return {string}
 **/
function renderRegisterFile(register, exercises) {
    const head = note([
        register.label,
        register.description,
        'Write below each prompt in your own words, the way you really would. Skip any you want, leave them empty.',
        'Everything inside these comments is ignored. Everything else counts as your writing.',
    ]);
    const blocks = exercises.map((ex) => {
        const prompt = note([ex.title, ex.instruction]);
        const material = ex.material ? `\n\n\`\`\`\n${ex.material}\n\`\`\`` : '';
        return `${prompt}${material}\n\n\n`;
    });
    return [head, '', ...blocks].join('\n');
}

/**
 * scaffold
 * Writes the register files, keeps existing ones unless force
 * @param opts {{home?: string, registers?: string[], force?: boolean, dataDir?: string}}
 * @return {{dir: string, written: string[], skipped: string[]}}
 **/
function scaffold({ home = defaultHome(), registers: wanted = [], force = false, dataDir = DATA_DIR } = {}) {
    const { registers, exercises } = loadData(dataDir);
    const byId = new Map(exercises.map((e) => [e.id, e]));
    const unknown = wanted.filter((id) => !registers.some((r) => r.id === id));
    if (unknown.length) {
        throw new Error(`unknown register(s): ${unknown.join(', ')}. Known: ${registers.map((r) => r.id).join(', ')}`);
    }
    const chosen = wanted.length ? registers.filter((r) => wanted.includes(r.id)) : registers;
    const dir = join(home, 'samples');
    mkdirSync(dir, { recursive: true });
    const written = [];
    const skipped = [];
    for (const r of chosen) {
        const file = join(dir, `${r.id}.md`);
        if (existsSync(file) && !force) {
            skipped.push(file);
            continue;
        }
        const exs = r.exercises.map((id) => byId.get(id)).filter(Boolean);
        writeFileSync(file, renderRegisterFile(r, exs));
        written.push(file);
    }
    return { dir, written, skipped };
}

/**
 * parseArgs
 * @param argv {string[]}
 * @return {{home: string, registers: string[], force: boolean, list: boolean}}
 **/
function parseArgs(argv) {
    const opts = { home: defaultHome(), registers: [], force: false, list: false };
    for (const a of argv) {
        if (a === '--force') opts.force = true;
        else if (a === '--list') opts.list = true;
        else if (a.startsWith('--home=')) opts.home = resolve(a.slice('--home='.length));
        else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
        else opts.registers.push(a);
    }
    return opts;
}

/**
 * main
 * @param argv {string[]}
 * @return {number} - exit code
 **/
function main(argv) {
    let opts;
    try {
        opts = parseArgs(argv);
    } catch (e) {
        console.error(e.message);
        console.error('usage: node scaffold-samples.mjs [register ...] [--home=<dir>] [--force] [--list]');
        return 2;
    }
    if (opts.list) {
        const { registers } = loadData();
        for (const r of registers) console.log(`${r.id.padEnd(10)} ${r.label}. ${r.description}`);
        return 0;
    }
    try {
        const { dir, written, skipped } = scaffold(opts);
        console.log(`samples dir: ${dir}`);
        for (const f of written) console.log(`written: ${f}`);
        for (const f of skipped) console.log(`kept (already there, --force to rewrite): ${f}`);
        if (written.length) console.log('fill these in with any editor, then run write-like-me again');
        return 0;
    } catch (e) {
        console.error(e.message);
        return 1;
    }
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
    process.exit(main(process.argv.slice(2)));
}

export { defaultHome, loadData, renderRegisterFile, scaffold, COMMENT_TAG };
