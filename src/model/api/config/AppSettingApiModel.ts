import { inject, injectable } from 'inversify';
import IAppSettingDB from '../../db/IAppSettingDB';
import { isFeatureEnabled } from '../../FeatureFlags';
import IConfiguration from '../../IConfiguration';
import ISecretCrypto from '../../security/ISecretCrypto';
import IAppSettingApiModel from './IAppSettingApiModel';

export function validateAppSettings(value: unknown): asserts value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('AppSettingsMustBeObject');
    }
    const allowed = new Set(['metadata', 'notifications', 'series', 'dashboard']);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new Error(`UnknownAppSetting:${key}`);
    }
}

@injectable()
export default class AppSettingApiModel implements IAppSettingApiModel {
    private static readonly SECRET_KEYS = new Set(['token', 'apiKey', 'secret', 'password']);

    constructor(
        @inject('IConfiguration') private readonly configuration: IConfiguration,
        @inject('IAppSettingDB') private readonly db: IAppSettingDB,
        @inject('ISecretCrypto') private readonly crypto: ISecretCrypto,
    ) {}

    public async get(): Promise<Record<string, unknown>> {
        this.ensureEnabled();
        return this.transformSecrets(await this.db.getAll(), null, 'mask') as Record<string, unknown>;
    }

    public async update(value: Record<string, unknown>): Promise<Record<string, unknown>> {
        this.ensureEnabled();
        validateAppSettings(value);
        const current = await this.db.getAll();
        const protectedValues = this.transformSecrets(value, current, 'encrypt') as Record<string, unknown>;
        await this.db.upsert(protectedValues);
        return this.transformSecrets(await this.db.getAll(), null, 'mask') as Record<string, unknown>;
    }

    private transformSecrets(value: unknown, current: unknown, mode: 'encrypt' | 'mask', key = ''): unknown {
        if (Array.isArray(value)) {
            const currentArray = Array.isArray(current) ? current : [];
            return value.map((item, index) => this.transformSecrets(item, currentArray[index], mode));
        }
        if (typeof value === 'object' && value !== null) {
            const source = value as Record<string, unknown>;
            const currentObject =
                typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : {};
            return Object.fromEntries(
                Object.entries(source).map(([childKey, child]) => [
                    childKey,
                    this.transformSecrets(child, currentObject[childKey], mode, childKey),
                ]),
            );
        }
        if (typeof value !== 'string' || !AppSettingApiModel.SECRET_KEYS.has(key)) return value;
        if (mode === 'mask') {
            if (value === '') return '';
            return this.crypto.isEncrypted(value) ? this.crypto.mask(value) : `********${value.slice(-4)}`;
        }
        if (value.startsWith('********') && typeof current === 'string') return current;
        return value === '' ? '' : this.crypto.encrypt(value);
    }

    private ensureEnabled(): void {
        if (!isFeatureEnabled(this.configuration.getConfig(), 'systemSettings')) {
            throw new Error('SystemSettingsFeatureIsDisabled');
        }
    }
}
