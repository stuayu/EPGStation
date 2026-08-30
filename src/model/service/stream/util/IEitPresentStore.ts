import { EitOnAirRecord } from '../../../api/schedule/EitOnAirResolver';

/**
 * 配信中の TS から読み取った EIT[p/f] を放送局ごとに保持する。
 *
 * **present と following は別々に持つ**。EIT[p/f] は present と following が交互に流れてくるため、
 * 同じ入れ物へ入れると後から来た following が present を上書きしてしまい、
 * 放送中番組の判定 (present しか使わない) がほとんど成立しなくなる
 */
export default interface IEitPresentStore {
    /**
     * 読み取った EIT[p/f] を保存する
     * @param channelId: number
     * @param event: EitOnAirRecord
     * @return boolean 直前の値から変化した場合 true
     */
    update(channelId: number, event: EitOnAirRecord): boolean;

    /**
     * 現在番組 (present) を返す
     * @param channelId: number
     * @return EitOnAirRecord | null 受信していなければ null
     */
    get(channelId: number): EitOnAirRecord | null;

    /**
     * 次番組 (following) を返す
     * @param channelId: number
     * @return EitOnAirRecord | null 受信していなければ null
     */
    getFollowing(channelId: number): EitOnAirRecord | null;

    /**
     * 保持している内容を破棄する (配信終了時)
     * @param channelId: number
     */
    clear(channelId: number): void;

    /**
     * present が変わったときに呼ばれるリスナを登録する
     * @param listener: (channelId: number) => void
     */
    onChange(listener: (channelId: number, event: EitOnAirRecord) => void): void;
}
