'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const root = path.join(__dirname, '../../src/model/service/api');

const listTypeScriptFiles = directory => {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...listTypeScriptFiles(fullPath));
        else if (entry.isFile() && fullPath.endsWith('.ts')) files.push(fullPath);
    }

    return files;
};

const listClientSourceFiles = directory => {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...listClientSourceFiles(fullPath));
        else if (entry.isFile() && /\.(?:ts|vue)$/u.test(fullPath)) files.push(fullPath);
    }

    return files;
};

const extractImports = source => [...source.matchAll(/(?:from|import\s*\(|require\s*\()\s*["']([^"']+)["']/gu)].map(match => match[1]);

const resolveSourceImport = (fromFile, specifier) => {
    if (!specifier.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [base, `${base}.ts`, `${base}.vue`, `${base}.js`, path.join(base, 'index.ts')];
    return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
};

const hasFunctionAncestor = node => {
    for (let current = node.parent; current !== undefined; current = current.parent) {
        if (ts.isFunctionLike(current)) return true;
    }

    return false;
};

const findTopLevelNodeUsage = (file, source) => {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const violations = [];
    const visit = node => {
        if (ts.isIdentifier(node) && (node.text === 'Buffer' || node.text === 'process') && hasFunctionAncestor(node) === false) {
            if (node.parent === undefined || ts.isTypeNode?.(node.parent) !== true) violations.push(node.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    return violations;
};

test('API route の相対 import は dist からリポジトリ直下の src を指さない', () => {
    const violations = [];
    for (const file of listTypeScriptFiles(root)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/(?:from|require\s*\()\s*["']([^"']+)["']/gu)) {
            if (/^(?:\.\.\/)+src\//u.test(match[1])) violations.push(`${path.relative(process.cwd(), file)}: ${match[1]}`);
        }
    }

    assert.deepEqual(violations, []);
});

test('クライアントから推移的に import される src/util はブラウザー非対応の Node API をモジュール最上位で評価しない', () => {
    const clientRoot = path.join(__dirname, '../../client/src');
    const utilRoot = path.join(__dirname, '../../src/util');
    const pending = [];
    for (const file of listClientSourceFiles(clientRoot)) {
        for (const specifier of extractImports(fs.readFileSync(file, 'utf8'))) {
            const resolved = resolveSourceImport(file, specifier);
            if (resolved !== null && resolved.startsWith(`${utilRoot}${path.sep}`)) pending.push(resolved);
        }
    }

    const visited = new Set();
    const violations = [];
    const nodeImport = /^(?:node:|(?:assert|buffer|child_process|crypto|events|fs|http|https|os|path|process|stream|url|util|zlib)$)/u;
    while (pending.length > 0) {
        const file = pending.pop();
        if (visited.has(file)) continue;
        visited.add(file);
        const source = fs.readFileSync(file, 'utf8');
        for (const specifier of extractImports(source)) {
            if (nodeImport.test(specifier)) violations.push(`${path.relative(process.cwd(), file)}: Node import ${specifier}`);
            const resolved = resolveSourceImport(file, specifier);
            if (resolved !== null && resolved.startsWith(`${utilRoot}${path.sep}`)) pending.push(resolved);
        }
        for (const value of new Set(findTopLevelNodeUsage(file, source))) {
            violations.push(`${path.relative(process.cwd(), file)}: top-level ${value}`);
        }
    }

    assert.ok(visited.size > 0, 'クライアントから src/util の import が見つからない');
    assert.deepEqual(violations, []);
});
