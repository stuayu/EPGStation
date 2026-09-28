import { inject, injectable } from 'inversify';
import IIPCClient from '../../ipc/IIPCClient';
import IPowerApiModel from './IPowerApiModel';

@injectable()
export default class PowerApiModel implements IPowerApiModel {
    constructor(@inject('IIPCClient') private readonly ipc: IIPCClient) {}

    /** Operator 側の休止予定を取り消す */
    public async cancel(): Promise<void> {
        await this.ipc.power.cancel();
    }
}
