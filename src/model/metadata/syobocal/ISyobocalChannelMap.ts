import { SyobocalChannelMapEntry } from './SyobocalChannelMapData';
export default interface ISyobocalChannelMap {
    /**
     * networkId/serviceId からしょぼいカレンダーのマッピング情報を引く
     * @param networkId number
     * @param serviceId number
     * @return SyobocalChannelMapEntry | undefined
     */
    find(networkId: number, serviceId: number): SyobocalChannelMapEntry | undefined;
}
