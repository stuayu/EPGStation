export default interface IProgramReminderManageModel {
    start(): void;
    refresh(): Promise<void>;
}
