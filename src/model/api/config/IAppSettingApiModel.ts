export default interface IAppSettingApiModel {
    get(): Promise<Record<string, unknown>>;
    update(values: Record<string, unknown>): Promise<Record<string, unknown>>;
}
