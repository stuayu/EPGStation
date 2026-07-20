import { DPlayerType } from 'dplayer';
import Hls from 'hls.js';
import Mpegts from 'mpegts.js';
import container from '../model/ModelContainer';
import { ISettingStorageModel } from '../model/storage/setting/ISettingStorageModel';
import UaUtil from './UaUtil';

namespace DPlayerUtil {
    let isInitedGlobals = false;

    /**
     * DPlayer (tsukumijima フォーク) が参照する window.Hls / window.mpegts を設定する
     * DPlayer は hls.js / mpegts.js を import ではなく window 経由で参照するため、
     * DPlayer を生成する前に一度だけ呼び出す必要がある
     */
    export const setupGlobals = (): void => {
        if (isInitedGlobals === true) {
            return;
        }

        (window as any).Hls = Hls;
        (window as any).mpegts = Mpegts;
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
