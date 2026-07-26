import { inject, injectable } from 'inversify';
import IAppSettingDB from '../../db/IAppSettingDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import IAppSettingApiModel from './IAppSettingApiModel';
export function validateAppSettings(v: unknown): asserts v is Record<string, unknown> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('AppSettingsMustBeObject');
    const allowed = new Set(['metadata', 'notifications', 'series', 'dashboard']);
    for (const k of Object.keys(v)) if (!allowed.has(k)) throw new Error(`UnknownAppSetting:${k}`);
}
@injectable()
export default class AppSettingApiModel implements IAppSettingApiModel {
    constructor(
        @inject('IConfiguration') private c: IConfiguration,
        @inject('IAppSettingDB') private db: IAppSettingDB,
    ) {}
    private enabled() {
        if (!isFeatureEnabled(this.c.getConfig(), 'systemSettings')) throw new Error('SystemSettingsFeatureIsDisabled');
    }
    async get() {
        this.enabled();
        return this.db.getAll();
    }
    async update(v: Record<string, unknown>) {
        this.enabled();
        validateAppSettings(v);
        await this.db.upsert(v);
        return this.db.getAll();
    }
}
