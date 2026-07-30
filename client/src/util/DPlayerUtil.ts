import { DPlayerType } from 'dplayer';
import Hls from 'hls.js';
import Mpegts from 'mpegts.js';
import container from '../model/ModelContainer';
import { ISettingStorageModel } from '../model/storage/setting/ISettingStorageModel';
import UaUtil from './UaUtil';

namespace DPlayerUtil {
    let isInitedGlobals = false;

    /**
     * DPlayer が参照する window.mpegts 用のオブジェクトを生成する
     *
     * DPlayer は window.mpegts.createPlayer() で直接プレイヤーを生成するため、
     * createPlayer をラップしてメディア要素アタッチ前に
     * disableRemotePlayback / playsinline を設定する。
     * iOS / iPadOS Safari 17.1+ の ManagedMediaSource (MMS) は
     * disableRemotePlayback が設定されていない video 要素では動作しないため必須。
     */
    const createMpegtsGlobal = (): typeof Mpegts => {
        const wrapped: any = { ...Mpegts };
        wrapped.createPlayer = (mediaDataSource: any, config?: any): any => {
            const player = (Mpegts as any).createPlayer(mediaDataSource, config);
            const originalAttach = player.attachMediaElement.bind(player);
            player.attachMediaElement = (element: HTMLMediaElement): void => {
                (element as any).disableRemotePlayback = true;
                element.setAttribute('playsinline', '');
                element.setAttribute('webkit-playsinline', '');
                originalAttach(element);
            };

            return player;
        };

        return wrapped;
    };

    /**
     * DPlayer が参照する window.Hls 用のオブジェクトを生成する
     *
     * Safari では MSE (hls.js) ではなく標準 video 要素によるネイティブ HLS 再生を使いたいが、
     * DPlayer は `window.Hls.isSupported()` が true ならば無条件に hls.js を選ぶ。
     * かといって type に 'normal' を渡すと DPlayer の initMSE() が
     * ARIB 字幕 (aribb24.js) を初期化する分岐 (case 'hls' / case 'mpegts') を通らず、
     * 字幕が一切表示されなくなる。
     *
     * そこで Safari のみ isSupported() が false を返すようにして、
     * DPlayer に「ネイティブ HLS + aribb24 の in-band metadata 自動検出」の分岐を選ばせる。
     * WebKit は fMP4 の emsg (ID3) を metadata text track (com.apple.streaming) として
     * 通知するため、この経路でも in-memory HLS の字幕が表示できる。
     */
    const createHlsGlobal = (): typeof Hls => {
        if (UaUtil.isSafari() === false) {
            return Hls;
        }

        const wrapped: any = Object.create(Hls);
        wrapped.isSupported = (): boolean => false;

        return wrapped;
    };

    /**
     * DPlayer (tsukumijima フォーク) が参照する window.Hls / window.mpegts を設定する
     * DPlayer は hls.js / mpegts.js を import ではなく window 経由で参照するため、
     * DPlayer を生成する前に一度だけ呼び出す必要がある
     */
    export const setupGlobals = (): void => {
        if (isInitedGlobals === true) {
            return;
        }

        (window as any).Hls = createHlsGlobal();
        (window as any).mpegts = createMpegtsGlobal();
        isInitedGlobals = true;
    };

    /**
     * DPlayer 組み込みの aribb24.js (ARIB 字幕) 用オプションを生成する
     * @return DPlayerType.PluginOptions['aribb24']
     */
    export const createAribb24Options = (): NonNullable<DPlayerType.PluginOptions['aribb24']> => {
        const storageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
        const config = storageModel.getSavedValue();

        // Windows Firefox では Yu Gothic や Meiryo では Canvas の垂直位置の指定がずれるため、MS Gothic を使用する #478
        const font =
            UaUtil.isWindows() === true && UaUtil.isFirefox() === true
                ? '"Windows TV MaruGothic", "MS Gothic", "Yu Gothic", sans-serif'
                : '"Windows TV MaruGothic", "Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", sans-serif';

        const option: NonNullable<DPlayerType.PluginOptions['aribb24']> = {
            normalFont: font,
            gaijiFont: font,
            drcsReplacement: true,
        };

        if (config.isForceEnableSubtitleStroke === true) {
            option.forceStrokeColor = 'black';
        }

        return option;
    };
}

export default DPlayerUtil;
