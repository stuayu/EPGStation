export default interface IServerStatusState {
    isMirakurunAlive: boolean;
    isBannerClosed: boolean;
    fetch(): Promise<void>;
    startPolling(): void;
    stopPolling(): void;
    closeBanner(): void;
}
