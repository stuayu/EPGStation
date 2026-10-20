export interface StorageInfo {
    name: string;
    available: string;
    used: string;
    total: string;
    useRate: number;
    reservedEstimatedSize?: number;
    firstShortfallReserveId?: number;
    firstShortfallReserveStartAt?: number;
    firstShortfallReserveName?: string;
}

export default interface IStorageState {
    clearData(): void;
    fetchData(): Promise<void>;
    getInfos(): StorageInfo[];
}
