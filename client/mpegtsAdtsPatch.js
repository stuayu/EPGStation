'use strict';

const ADTS_SYNCWORD_SOURCE = 'if(4095===(i[t+0]<<8|i[t+1])>>>4)return t;t++';

// mpegts.js の minified AACADTSParser.findNextSyncwordOffset() へ注入するコード。
// 次フレームの先頭が入力末尾の外側、または末尾から4 byte未満なら次ヘッダ検証を省略する。
const ADTS_SYNCWORD_PATCH =
    'if(4095===(i[t+0]<<8|i[t+1])>>>4&&0===(i[t+1]&6)&&((i[t+2]&60)>>>2)<=12&&((i[t+3]&3)<<11|i[t+4]<<3|(224&i[t+5])>>>5)>=7){var n=((i[t+3]&3)<<11|i[t+4]<<3|(224&i[t+5])>>>5),a=t+n;if(a+4>i.byteLength||4095===(i[a+0]<<8|i[a+1])>>>4&&i[a+2]===i[t+2]&&(240&i[a+3])===(240&i[t+3]))return t}t++';

/**
 * mpegts.js の AAC ADTS 同期語探索へ偽同期語対策を適用する。
 * @param {string} source mpegts.js dist のソース
 * @return {string} 置換後のソース
 * @throws {Error} 置換元がちょうど1箇所でない場合
 */
function patchMpegtsAdtsParser(source) {
    const matchCount = source.split(ADTS_SYNCWORD_SOURCE).length - 1;
    if (matchCount !== 1) {
        throw new Error(`mpegts.js ADTS patch target count must be 1, got ${matchCount}`);
    }
    return source.replace(ADTS_SYNCWORD_SOURCE, ADTS_SYNCWORD_PATCH);
}

module.exports = {
    ADTS_SYNCWORD_PATCH,
    ADTS_SYNCWORD_SOURCE,
    patchMpegtsAdtsParser,
};
