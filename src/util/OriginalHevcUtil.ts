import { SourceCapabilities } from '../model/stream/capability/ISourceCapabilities';

export const ORIGINAL_HEVC_PROFILE_ID = 'original-hevc';

/** tsreplace などが作った HEVC の MPEG-TS を端末デコードへ渡せる素材か判定する。 */
export const isOriginalHevcSource = (source: SourceCapabilities): boolean =>
    source.transport === 'mpegts' && source.codec === 'hevc';

/**
 * HEVC を再エンコードせず、fMP4 の標準出力へ詰め替える録画 HLS コマンドを作る。
 * **音声は copy しない (AAC へ再エンコードする)**。放送の AAC を copy した fMP4 は、Safari / WebKit で
 * 最初のフラグメント境界 (4〜6 秒) で再生が止まる。実測 (Playwright WebKit、tsreplace 出力 3 本):
 * 音声 copy の fMP4 は 4.40 / 4.80 / 6.29 秒で停止、映像のみ・音声 AAC 再エンコードはいずれも 24 秒まで進行。
 * 映像の CRA/RASL・in-band PPS・AUD を除いても直らず、原因は音声トラック側 (copy 後の ffprobe で profile=-1、
 * `Number of bands (49) exceeds limit (32)`)。副音声の `-dual_mono_mode` も音声をデコードしないと効かない。
 */
export const createOriginalHevcHlsCommand = (useTsreadex: boolean, input: 'pipe' | 'file' = 'pipe'): string => {
    const tsreadex = useTsreadex === true ? '%TSREADEX% | ' : '';
    const inputArgs =
        input === 'pipe' ? '-f mpegts -analyzeduration 5000000 -probesize 5000000 -i pipe:0' : '-ss %SS% -i %INPUT%';

    return (
        `${tsreadex}%FFMPEG% -fflags +genpts ${inputArgs} -sn -threads 0 ` +
        `%DUALMONOMODE% %AUDIOMAP% -c:v copy -tag:v hvc1 -c:a aac -ar 48000 -b:a 192k -ac 2 %AUDIOFILTER% ` +
        `-avoid_negative_ts make_zero -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1`
    );
};
