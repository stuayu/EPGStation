'use strict';const assert=require('node:assert/strict');const test=require('node:test');const{normalizeSeriesTitle,parseSeriesInfo,displaySeriesTitle}=require('../../dist/model/series/SeriesNormalizer');
test('normalizes Japanese broadcast noise and episode suffixes',()=>{assert.equal(normalizeSeriesTitle('＜アニメギルド＞　作品名　第１２話「最終回」'),'作品名');assert.equal(normalizeSeriesTitle('【再】アニメA・作品名 #03'),'作品名');});
test('parses episode, season and rerun markers',()=>{assert.deepEqual(parseSeriesInfo('作品名 第2期 第12.5話【再】'),{normalizedTitle:'作品名 第2期',seasonNumber:2,episodeNumber:12.5,episodeLabel:'第12.5話',airType:'rerun'});});
test('full-width and ASCII episode forms converge',()=>{assert.equal(parseSeriesInfo('作品名 ＃０３').episodeNumber,3);assert.equal(parseSeriesInfo('作品名 EP03').episodeNumber,3);});
test('does not strip bare "再" occurring inside a real title (regression for over-eager bare match)',()=>{assert.equal(normalizeSeriesTitle('再婚承認を要求します'),'再婚承認を要求します');assert.equal(normalizeSeriesTitle('再会の街で'),'再会の街で');});
test('removes only bracket-enclosed rerun markers, including full-width parentheses folded by NFKC',()=>{assert.equal(normalizeSeriesTitle('作品名（再）'),'作品名');assert.equal(normalizeSeriesTitle('作品名(再放送)'),'作品名');});
test('removes (新)(終)(字)(デ) style bracketed markers',()=>{assert.equal(normalizeSeriesTitle('作品名(新)'),'作品名');assert.equal(normalizeSeriesTitle('作品名(終)'),'作品名');assert.equal(normalizeSeriesTitle('作品名(字)'),'作品名');assert.equal(normalizeSeriesTitle('作品名(デ)'),'作品名');assert.equal(normalizeSeriesTitle('作品名(新)(終)'),'作品名');});
test('falls back to the original title when normalization would otherwise produce an empty string',()=>{assert.equal(normalizeSeriesTitle('第1話'),'第1話'.toLocaleLowerCase('ja-JP'));assert.equal(normalizeSeriesTitle('「サブタイトル」'),'「サブタイトル」'.toLocaleLowerCase('ja-JP'));});
test('detects (再) parenthesis rerun markers that the bracket-only regex previously missed',()=>{assert.equal(parseSeriesInfo('作品名(再)').airType,'rerun');assert.equal(parseSeriesInfo('作品名 再放送').airType,'rerun');assert.equal(parseSeriesInfo('作品名【再】').airType,'rerun');});

test('displaySeriesTitle keeps original casing while removing episode markers',()=>{assert.equal(displaySeriesTitle('CLANNAD AFTER STORY(HDマスター版) #16'),'CLANNAD AFTER STORY(HDマスター版)');assert.equal(displaySeriesTitle('＜アニメギルド＞　作品名　第１２話「最終回」'),'作品名');assert.equal(normalizeSeriesTitle('CLANNAD AFTER STORY #16'),'clannad after story');});

test('isDerivedFromTitle rejects a real-but-unrelated work name the llm hallucinated', () => {
    const { isDerivedFromTitle } = require('../../dist/model/series/SeriesNormalizer');
    // 装飾・話数・サブタイトルを取り除いただけの抽出は通す
    assert.equal(isDerivedFromTitle('よわよわ先生 Lesson.1', 'よわよわ先生'), true);
    assert.equal(isDerivedFromTitle('それいけ!アンパンマン「カレーパンマンとハロウィンマン・他」[多]', 'それいけ!アンパンマン'), true);
    assert.equal(isDerivedFromTitle('MAO(15)「不知火」(16)', 'MAO'), true);
    assert.equal(isDerivedFromTitle('第75回NHK紅白歌合戦 有吉・環奈・沙莉!', 'NHK紅白歌合戦'), true);

    // 実在する別作品の名前 (辞書では引けてしまうので、ここで落とさないと誤リンクになる)
    assert.equal(isDerivedFromTitle('あそビバ', 'あそびにいくヨ!'), false);
    assert.equal(isDerivedFromTitle('TUF新春ロードショー', 'THE UNLIMITED -兵部京介-'), false);
    assert.equal(isDerivedFromTitle('プロフェッショナルランキング★日曜劇場名場面ランキングBEST10', 'プロフェッショナル 仕事の流儀'), false);

    assert.equal(isDerivedFromTitle('作品名', ''), false);
});
