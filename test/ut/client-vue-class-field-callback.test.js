'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function listSourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const filePath = path.join(directory, entry.name);
        return entry.isDirectory() ? listSourceFiles(filePath) : /\.(ts|vue)$/.test(filePath) ? [filePath] : [];
    });
}

test('Vue component classes and BaseVideo descendants do not store this-bound arrow callbacks in fields', () => {
    const classes = [];
    for (const filePath of listSourceFiles(path.join(__dirname, '../../client/src'))) {
        let source = fs.readFileSync(filePath, 'utf8');
        if (filePath.endsWith('.vue')) source = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
        const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
        const visit = node => {
            if (ts.isClassDeclaration(node) && node.name !== undefined) {
                const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
                const isVueComponent = decorators.some(decorator =>
                    /^(Component|ComponentBase)\b/.test(decorator.expression.getText(sourceFile)),
                );
                classes.push({
                    filePath,
                    sourceFile,
                    node,
                    name: node.name.text,
                    parent: node.heritageClauses
                        ?.flatMap(clause => clause.types)
                        .map(type => type.expression.getText(sourceFile))[0],
                    isVueComponent,
                });
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }

    const relevantClasses = new Set(
        classes.filter(item => item.isVueComponent || item.name === 'BaseVideo').map(item => item.name),
    );
    let changed = true;
    while (changed) {
        changed = false;
        for (const item of classes) {
            if (relevantClasses.has(item.parent) && !relevantClasses.has(item.name)) {
                relevantClasses.add(item.name);
                changed = true;
            }
        }
    }

    const violations = [];
    for (const item of classes.filter(value => relevantClasses.has(value.name))) {
        for (const member of item.node.members) {
            if (!ts.isPropertyDeclaration(member) || !member.initializer || !ts.isArrowFunction(member.initializer))
                continue;
            let referencesThis = false;
            const visit = node => {
                if (node.kind === ts.SyntaxKind.ThisKeyword) referencesThis = true;
                ts.forEachChild(node, visit);
            };
            visit(member.initializer);
            if (referencesThis) {
                const line = item.sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1;
                violations.push(
                    `${path.relative(process.cwd(), item.filePath)}:${line} ${member.name.getText(item.sourceFile)}`,
                );
            }
        }
    }

    // 現在、例外として許可するクラスフィールドコールバックはない。
    assert.deepEqual(violations, []);
});
