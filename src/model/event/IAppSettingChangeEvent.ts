export default interface IAppSettingChangeEvent {
    emitChanged(keys: string[]): void;
    setChanged(callback: (keys: string[]) => void): void;
}
