export default interface ISystemSettingApiModel {
    get(): Promise<Record<string, any>>;
    update(value: Record<string, any>): Promise<Record<string, any>>;
    testNotification(targetName?: string): Promise<void>;
}
