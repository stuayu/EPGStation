'use strict';const assert=require('node:assert/strict');const test=require('node:test');const{normalizeSeriesTitle,parseSeriesInfo}=require('../../dist/model/series/SeriesNormalizer');
test('normalizes Japanese broadcast noise and episode suffixes',()=>{assert.equal(normalizeSeriesTitle('＜アニメギルド＞　作品名　第１２話「最終回」'),'作品名');assert.equal(normalizeSeriesTitle('【再】アニメA・作品名 #03'),'作品名');});
test('parses episode, season and rerun markers',()=>{assert.deepEqual(parseSeriesInfo('作品名 第2期 第12.5話【再】'),{normalizedTitle:'作品名 第2期',seasonNumber:2,episodeNumber:12.5,episodeLabel:'第12.5話',airType:'rerun'});});
test('full-width and ASCII episode forms converge',()=>{assert.equal(parseSeriesInfo('作品名 ＃０３').episodeNumber,3);assert.equal(parseSeriesInfo('作品名 EP03').episodeNumber,3);});
