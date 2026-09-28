import * as apid from '../../../../api';
import * as mapid from '../../../../node_modules/mirakurun/api';
import Reserve from '../../../db/entities/Reserve';
import TunerCompatibilityUtil from '../../../util/TunerCompatibilityUtil';

export default class Tuner {
    private types: apid.ChannelType[];
    private index: number;
    private name: string;
    private reserves: Reserve[] = [];

    constructor(tuner: mapid.TunerDevice) {
        this.types = tuner.types;
        this.index = tuner.index;
        this.name = tuner.name;
    }

    public getIndex(): number {
        return this.index;
    }

    public getName(): string {
        return this.name;
    }

    public getTypes(): apid.ChannelType[] {
        return this.types;
    }

    /**
     * 予約情報を追加
     * @return boolean 予約情報が追加できなかった場合 false
     */
    public add(reserve: Reserve): boolean {
        if (
            TunerCompatibilityUtil.isTunerCompatibleWithChannelType(this.types, reserve.channelType) &&
            (this.reserves.length === 0 || this.reserves[0].channel === reserve.channel)
        ) {
            this.reserves.push(reserve);

            return true;
        }

        return false;
    }

    /**
     * 予約情報を全て削除
     */
    public clear(): void {
        this.reserves = [];
    }
}
