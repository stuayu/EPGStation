import * as apid from '../../../../../api';

export default interface IReservesApiModel {
    add(option: apid.ManualReserveOption): Promise<apid.AddedReserve>;
    edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void>;
    get(reserveId: apid.ReserveId, isHalfWidth: boolean): Promise<apid.ReserveItem>;
    gets(option: apid.GetReserveOption): Promise<apid.Reserves>;
    getLists(option: apid.GetReserveListsOption): Promise<apid.ReserveLists>;
    getCnts(): Promise<apid.ReserveCnts>;
    getTuners(): Promise<apid.TunerItems>;
    cancel(reserveId: apid.ReserveId): Promise<void>;
    removeSkip(reserveId: apid.ReserveId): Promise<void>;
    removeOverlap(reserveId: apid.ReserveId): Promise<void>;
    updateAll(): Promise<void>;
}
