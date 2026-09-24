import * as apid from '../../../api';
import { applyAudioTrackWithRetry } from '../../../src/util/AudioTrackApplyUtil';

/**
 * HLS 配信で「主音声・副音声を同時に含むストリーム」を再接続無しに切り替えるユーティリティ。
 *
 * サーバーは tsreadex を通す in-memory HLS (LL-HLS) で `audioTrack=all` を受けると、
 * 映像レンディションと音声レンディション 2 本 (`#EXT-X-MEDIA:TYPE=AUDIO`) を持つ
 * マスタープレイリストを返す (PlaybackProfile.embeddedAudioSwitch.hls が true)。
 *
 * **切替の入口は再生経路で 2 通りある**。
 * - hls.js (Safari 以外): `hls.audioTrack = <index>`
 * - ネイティブ HLS (Safari): `video.audioTracks[<index>].enabled = true` (他は false)
 *
 * DPlayer フォーク自身も音声メニューを持つが、EPGStation は
 * `DPlayerEnhancer.applyAudioTrackSwitcher()` で独自パネルへ差し替えているため、
 * 切替処理もここで面倒を見る。
 */
namespace HlsAudioTrackUtil {
    /** audioTracks が揃うまで待つ最大時間 (ms) */
    const WAIT_TRACKS_TIMEOUT = 5000;
    /** audioTracks が揃うのを待つ間隔 (ms) */
    const WAIT_TRACKS_INTERVAL = 200;

    /**
     * 音声トラック指定子が副音声 (レンディション index 1) を指すか判定する
     * 'sub' / 音声 ES インデックス '1' を副音声とみなす ('main' / '0' / それ以外は主音声)
     * @param track: apid.AudioTrackSpecifier
     * @return boolean
     */
    export const isSecondaryAudioTrack = (track: apid.AudioTrackSpecifier): boolean => {
        if (track === 'sub') {
            return true;
        }
        if (track === 'main') {
            return false;
        }

        return Number.parseInt(track, 10) === 1;
    };

    /**
     * 音声トラック指定子をレンディションの index へ変換する
     * @param track: apid.AudioTrackSpecifier
     * @return number 0 = 主音声 / 1 = 副音声
     */
    export const toTrackIndex = (track: apid.AudioTrackSpecifier): number =>
        isSecondaryAudioTrack(track) === true ? 1 : 0;

    /**
     * 再生中の HLS で音声レンディションを切り替える (再接続しない)
     *
     * hls.js は audioTracks の一覧がマスタープレイリストの解析後に揃うため、
     * 揃うまで短時間待ってから設定する。一覧が 2 本に満たない場合 (サーバーが単一音声で
     * 配信している、まだ解析前など) は false を返し、呼び出し側が従来の再接続方式へ落とせるようにする
     * @param dp: any DPlayer インスタンス
     * @param track: apid.AudioTrackSpecifier
     * @return Promise<boolean> 切り替えられた場合 true
     */
    export const switchAudioTrack = async (dp: any, track: apid.AudioTrackSpecifier): Promise<boolean> => {
        const index = toTrackIndex(track);
        const hls = dp?.plugins?.hls;

        if (hls !== undefined && hls !== null && Array.isArray(hls.audioTracks) === true) {
            const ready = await waitFor(() => hls.audioTracks.length > index);
            if (ready === false) {
                return false;
            }

            // **設定しただけで成功にしない**。hls.js はマスタープレイリストの解析途中や
            // レベル切替の直後だと audioTracks の中身を組み直すため、代入が黙って
            // 既定トラックへ戻されることがある (1 回目の操作だけ効かない症状になる)。
            // 選択が実際に反映されたことを読み返して確かめ、駄目なら呼び出し側の
            // 再接続方式へ落とす
            return await applyAudioTrackWithRetry(
                () => {
                    hls.audioTrack = index;
                },
                () => hls.audioTrack === index,
            );
        }

        // ネイティブ HLS (Safari): video.audioTracks で選ぶ
        const video: HTMLVideoElement | null = dp?.video ?? null;
        const audioTracks = (video as any)?.audioTracks;
        if (video === null || audioTracks === undefined || audioTracks === null) {
            return false;
        }

        const ready = await waitFor(() => audioTracks.length > index);
        if (ready === false) {
            return false;
        }

        return await applyAudioTrackWithRetry(
            () => {
                // **選びたいトラックを先に有効化する**。先に全部を無効化すると
                // 一瞬どのトラックも有効でない状態ができ、実装によっては既定トラックへ
                // 戻される (AudioTrackList は排他なので、有効化すれば他は自動で無効になる)
                audioTracks[index].enabled = true;
                for (let i = 0; i < audioTracks.length; i++) {
                    if (i !== index) {
                        audioTracks[i].enabled = false;
                    }
                }
            },
            () => audioTracks[index]?.enabled === true,
        );
    };


    /**
     * 条件が満たされるまで待つ
     * @param check: () => boolean
     * @return Promise<boolean> タイムアウトした場合は false
     */
    const waitFor = (check: () => boolean): Promise<boolean> => {
        if (check() === true) {
            return Promise.resolve(true);
        }

        return new Promise<boolean>(resolve => {
            let waited = 0;
            const timerId = setInterval(() => {
                waited += WAIT_TRACKS_INTERVAL;
                if (check() === true) {
                    clearInterval(timerId);
                    resolve(true);

                    return;
                }
                if (waited >= WAIT_TRACKS_TIMEOUT) {
                    clearInterval(timerId);
                    resolve(false);
                }
            }, WAIT_TRACKS_INTERVAL);
        });
    };
}

export default HlsAudioTrackUtil;
