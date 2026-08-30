import { ChildProcess } from 'child_process';
import * as apid from '../../../api';
import { EitOnAirRecord } from '../api/schedule/EitOnAirResolver';

export default interface IIPCServer {
    register(child: ChildProcess): void;
    notifyClient(): void;
    /**
     * EIT[p/f] 相当の更新をクライアントへ通知する
     * @param channelIds: number[] 対象の放送局
     */
    notifyOnAirProgramClient(channelIds: number[]): void;
    /**
     * 番組情報の更新をクライアントへ通知する (番組表の即時更新用)
     * @param option: 変更のあった放送局と時間帯
     */
    notifyProgramUpdatedClient(option: { channelIds: number[]; startAt: number | null; endAt: number | null }): void;
    notifyEitPresent(channelId: number, event: EitOnAirRecord): void;
    setEncode(addOption: apid.AddEncodeProgramOption): void;
}
