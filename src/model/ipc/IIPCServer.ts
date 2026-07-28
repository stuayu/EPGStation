import { ChildProcess } from 'child_process';
import * as apid from '../../../api';

export default interface IIPCServer {
    register(child: ChildProcess): void;
    notifyClient(): void;
    /**
     * EIT[p/f] 相当の更新をクライアントへ通知する
     * @param channelIds: number[] 対象の放送局
     */
    notifyOnAirProgramClient(channelIds: number[]): void;
    setEncode(addOption: apid.AddEncodeProgramOption): void;
}
