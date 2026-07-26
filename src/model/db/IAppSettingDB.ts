export default interface IAppSettingDB {
    getAll(): Promise<Record<string, unknown>>;
    upsert(values: Record<string, unknown>): Promise<void>;
}
