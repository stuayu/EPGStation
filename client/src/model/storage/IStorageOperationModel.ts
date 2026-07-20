export default interface IStorageOperationModel {
    set<T>(key: string, value: T): void;
    get<T>(key: string): T | null;
    remove(key: string): void;
}
