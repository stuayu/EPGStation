import IRepositoryModel from '../api/IRepositoryModel';
import AbstractStorageBaseModel from './AbstractStorageBaseModel';
import IStorageBaseModel from './IStorageBaseModel';
import { CLIENT_SETTINGS_SYNC_ENABLED_KEY, CLIENT_SETTINGS_SYNC_KEYS } from './ClientSettingsSyncKeys';
import { extractSyncableSettings, mergeSyncableSettings } from '../../../../src/util/ClientSettingsSyncUtil';

export interface ClientSettingsResponse {
    settings: Record<string, Record<string, unknown>>;
    updatedAt: number;
}

/** 許可リストに基づき localStorage 設定をサーバーと同期する */
export default class ClientSettingsSyncModel {
    private readonly models: IStorageBaseModel<any>[];
    private updatedAt = 0;
    private locked = false;
    private applying = false;
    private hasPendingChanges = false;
    private pushTimer: number | null = null;
    private lastPullAt = 0;

    constructor(
        private readonly repository: IRepositoryModel,
        models: IStorageBaseModel<any>[],
    ) {
        this.models = models;
    }

    public isEnabled(): boolean {
        return localStorage.getItem(CLIENT_SETTINGS_SYNC_ENABLED_KEY) === 'true';
    }

    public setEnabled(enabled: boolean): void {
        localStorage.setItem(CLIENT_SETTINGS_SYNC_ENABLED_KEY, String(enabled));
    }

    public initialize(): void {
        AbstractStorageBaseModel.setSaveListener(key => this.onSaved(key));
        document.addEventListener('visibilitychange', this.onVisibilityChange);
        if (this.isEnabled() && window.location.hash.startsWith('#/offline-videos') === false) void this.pull(false);
    }

    public dispose(): void {
        AbstractStorageBaseModel.setSaveListener(null);
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
        if (this.pushTimer !== null) window.clearTimeout(this.pushTimer);
    }

    public async getServerState(): Promise<ClientSettingsResponse> {
        return (await this.repository.get('/client-settings')).data as ClientSettingsResponse;
    }

    public async chooseServer(): Promise<void> {
        const response = await this.getServerState();
        this.updatedAt = response.updatedAt;
        if (response.updatedAt > 0 && this.apply(response.settings)) {
            this.notifySettingsApplied();
            if (this.isWatching() === false) window.location.reload();
        }
        this.lastPullAt = Date.now();
    }

    public async chooseLocal(): Promise<void> {
        const response = await this.getServerState();
        this.updatedAt = response.updatedAt;
        await this.push();
    }

    private onVisibilityChange = (): void => {
        if (document.visibilityState === 'visible' && Date.now() - this.lastPullAt >= 30_000) void this.pull(false);
    };

    private onSaved(key: string): void {
        if (this.isEnabled() === false || Object.hasOwn(CLIENT_SETTINGS_SYNC_KEYS, key) === false || navigator.onLine === false) return;
        if (this.locked === true) {
            if (this.applying === false) this.hasPendingChanges = true;
            return;
        }
        this.schedulePush();
    }

    private schedulePush(): void {
        if (this.pushTimer !== null) window.clearTimeout(this.pushTimer);
        this.pushTimer = window.setTimeout(() => {
            this.pushTimer = null;
            void this.push();
        }, 2000);
    }

    private extract(): Record<string, Record<string, unknown>> {
        const values = Object.fromEntries(this.models.map(model => [model.getStorageKey(), model.getSavedValue()])) as Record<string, Record<string, unknown>>;
        return extractSyncableSettings(values, CLIENT_SETTINGS_SYNC_KEYS);
    }

    private apply(settings: Record<string, Record<string, unknown>>): boolean {
        this.applying = true;
        this.locked = true;
        let changed = false;
        try {
            const values = Object.fromEntries(this.models.map(model => [model.getStorageKey(), model.getSavedValue()])) as Record<string, Record<string, unknown>>;
            const merged = mergeSyncableSettings(values, settings, CLIENT_SETTINGS_SYNC_KEYS);
            for (const model of this.models) {
                if (Object.hasOwn(CLIENT_SETTINGS_SYNC_KEYS, model.getStorageKey()) === false) continue;
                if (JSON.stringify(values[model.getStorageKey()]) !== JSON.stringify(merged[model.getStorageKey()])) changed = true;
                model.tmp = merged[model.getStorageKey()];
                model.save();
            }
        } finally {
            this.applying = false;
            this.locked = false;
        }
        return changed;
    }

    private notifySettingsApplied(): void {
        window.dispatchEvent(new Event('client-settings-synced'));
    }

    private isWatching(): boolean {
        return /^#\/(onair\/watch|recorded\/(watch|streaming)|offline-videos\/.*\/watch)(\/|$|\?)/.test(window.location.hash);
    }

    private async pull(force: boolean): Promise<void> {
        if (this.isEnabled() === false || navigator.onLine === false || this.locked === true) return;
        if (force === false && Date.now() - this.lastPullAt < 30_000) return;
        this.locked = true;
        try {
            const response = await this.getServerState();
            this.updatedAt = response.updatedAt;
            if (response.updatedAt > 0 && this.apply(response.settings)) {
                this.lastPullAt = Date.now();
                this.notifySettingsApplied();
                return;
            }
            this.lastPullAt = Date.now();
        } catch (error) {
            console.warn('client settings sync pull failed', error);
        } finally {
            this.locked = false;
            if (this.hasPendingChanges === true) {
                this.hasPendingChanges = false;
                this.schedulePush();
            }
        }
    }

    private async push(): Promise<void> {
        if (this.isEnabled() === false || navigator.onLine === false || this.locked === true) return;
        this.locked = true;
        try {
            const response = await this.repository.put('/client-settings', { settings: this.extract(), baseUpdatedAt: this.updatedAt });
            this.updatedAt = Number(response.data.updatedAt ?? Date.now());
        } catch (error: any) {
            if (error?.response?.status === 409) {
                const remote = error.response.data as ClientSettingsResponse;
                this.updatedAt = remote.updatedAt;
                if (this.apply(remote.settings)) this.notifySettingsApplied();
                this.lastPullAt = Date.now();
            } else console.warn('client settings sync push failed', error);
        } finally {
            this.locked = false;
            if (this.hasPendingChanges === true) {
                this.hasPendingChanges = false;
                this.schedulePush();
            }
        }
    }
}
