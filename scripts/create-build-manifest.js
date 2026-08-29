#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const mirakurunIndex = args.indexOf('--mirakurun-dir');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : 'build-manifest.txt';
const mirakurunDir = mirakurunIndex >= 0 ? args[mirakurunIndex + 1] : path.join('..', 'Mirakurun');

if (!outputPath || !mirakurunDir) {
    throw new Error('Usage: create-build-manifest.js [--output path] [--mirakurun-dir path]');
}

/**
 * 指定した Git リポジトリの HEAD を取得する。
 *
 * @param {string} repositoryPath リポジトリのパス
 * @return {string} commit SHA
 */
function getRevision(repositoryPath) {
    return execFileSync('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

/**
 * lockfile の SHA-256 を取得する。
 *
 * @param {string} lockfilePath lockfile のパス
 * @return {string} SHA-256
 */
function getFileHash(lockfilePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(lockfilePath)).digest('hex');
}

const repositoryPath = path.resolve(__dirname, '..');
const manifest = [
    `EPGStation commit: ${getRevision(repositoryPath)}`,
    `Mirakurun revision: ${getRevision(path.resolve(repositoryPath, mirakurunDir))}`,
    `EPGStation package-lock.json SHA-256: ${getFileHash(path.join(repositoryPath, 'package-lock.json'))}`,
    `EPGStation client/package-lock.json SHA-256: ${getFileHash(path.join(repositoryPath, 'client', 'package-lock.json'))}`,
    '',
].join('\n');

fs.writeFileSync(path.resolve(repositoryPath, outputPath), manifest);
