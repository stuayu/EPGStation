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

// TSDemuxer の constructor(probeData, config) で preferred_secondary_audio を初期化する箇所。
const SECONDARY_AUDIO_INIT_SOURCE = 'n.preferred_secondary_audio=!1,n.ts_packet_size_=t.ts_packet_size';

// config.preferSecondaryAudio === true なら、最初に解析する PMT から 2 本目の音声 ES を選ぶ。
const SECONDARY_AUDIO_INIT_PATCH = 'n.preferred_secondary_audio=!(!i||!0!==i.preferSecondaryAudio),n.ts_packet_size_=t.ts_packet_size';

/**
 * mpegts.js の TSDemuxer が生成時に config.preferSecondaryAudio を読むようにする。
 *
 * switchSecondaryAudio() は生成済みの TSDemuxer にしかフラグを立てられず、TSDemuxer は
 * 最初のデータが届いた処理の中で生成と最初の PMT 解析を同時に行う。プレイヤーを作り直した直後に
 * 呼ぶと Worker 側で demuxer が未生成のため指定が捨てられ、主音声のままになる。
 * @param {string} source mpegts.js dist のソース
 * @return {string} 置換後のソース
 * @throws {Error} 置換元がちょうど1箇所でない場合
 */
function patchMpegtsSecondaryAudioPreference(source) {
    const matchCount = source.split(SECONDARY_AUDIO_INIT_SOURCE).length - 1;
    if (matchCount !== 1) {
        throw new Error(`mpegts.js secondary audio patch target count must be 1, got ${matchCount}`);
    }
    return source.replace(SECONDARY_AUDIO_INIT_SOURCE, SECONDARY_AUDIO_INIT_PATCH);
}

/**
 * EPGStation が mpegts.js dist に当てる置換をすべて適用する。
 * @param {string} source mpegts.js dist のソース
 * @return {string} 置換後のソース
 */
function patchMpegtsDist(source) {
    return patchMpegtsSecondaryAudioPreference(patchMpegtsAdtsParser(source));
}

module.exports = {
    ADTS_SYNCWORD_PATCH,
    ADTS_SYNCWORD_SOURCE,
    SECONDARY_AUDIO_INIT_PATCH,
    SECONDARY_AUDIO_INIT_SOURCE,
    patchMpegtsAdtsParser,
    patchMpegtsSecondaryAudioPreference,
    patchMpegtsDist,
};
