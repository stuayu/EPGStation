import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import RecordingPreset from '../../../db/entities/RecordingPreset';
import IRecordingPresetDB from '../../db/IRecordingPresetDB';
import IRecordingPresetApiModel from './IRecordingPresetApiModel';

@injectable()
export default class RecordingPresetApiModel implements IRecordingPresetApiModel {
    private static readonly SETTINGS_KEYS = [
        'parentDirectoryName',
        'directory',
        'recordedFormat',
        'mode1',
        'encodeParentDirectoryName1',
        'directory1',
        'mode2',
        'encodeParentDirectoryName2',
        'directory2',
        'mode3',
        'encodeParentDirectoryName3',
        'directory3',
        'isDeleteOriginalAfterEncode',
        'priority',
        'conflictPolicy',
        'allowEndLack',
        'startMarginSec',
        'endMarginSec',
        'tags',
    ] as const;

    constructor(@inject('IRecordingPresetDB') private readonly db: IRecordingPresetDB) {}

    public async gets(): Promise<apid.RecordingPresetItems> {
        const items = await this.db.findAll();
        return { items: items.map(item => this.toApiItem(item)), total: items.length };
    }

    public async get(id: number): Promise<apid.RecordingPresetItem> {
        const item = await this.db.findId(id);
        if (item === null) throw new Error('RecordingPresetIsNotFound');
        return this.toApiItem(item);
    }

    public async getDefault(): Promise<apid.RecordingPresetItem | null> {
        const item = await this.db.findDefault();
        return item === null ? null : this.toApiItem(item);
    }

    public async create(option: apid.AddRecordingPresetOption): Promise<number> {
        const { name, settings } = this.validate(option);
        const now = Date.now();
        const item = new RecordingPreset();
        item.name = name;
        item.isDefault = option.isDefault === true;
        item.settings = JSON.stringify(settings);
        item.createdAt = now;
        item.updatedAt = now;
        if (item.isDefault) await this.clearDefault();
        return await this.db.insert(item);
    }

    public async update(id: number, option: apid.UpdateRecordingPresetOption): Promise<void> {
        const item = await this.db.findId(id);
        if (item === null) throw new Error('RecordingPresetIsNotFound');
        const { name, settings } = this.validate(option);
        item.name = name;
        item.settings = JSON.stringify(settings);
        if (typeof option.isDefault === 'boolean') item.isDefault = option.isDefault;
        if (item.isDefault) await this.clearDefault(id);
        item.updatedAt = Date.now();
        await this.db.update(item);
    }

    public async delete(id: number): Promise<void> {
        if ((await this.db.findId(id)) === null) throw new Error('RecordingPresetIsNotFound');
        await this.db.delete(id);
    }

    private validate(option: apid.AddRecordingPresetOption | apid.UpdateRecordingPresetOption): {
        name: string;
        settings: apid.RecordingPresetSettings;
    } {
        const name = typeof option?.name === 'string' ? option.name.trim() : '';
        const settings = option?.settings;
        if (
            name.length < 1 ||
            name.length > 100 ||
            settings === null ||
            typeof settings !== 'object' ||
            Array.isArray(settings)
        ) {
            throw new Error('InvalidRequestBody');
        }
        if (RecordingPresetApiModel.SETTINGS_KEYS.some(key => !Object.prototype.hasOwnProperty.call(settings, key))) {
            throw new Error('InvalidRequestBody');
        }
        for (const [key, value] of Object.entries(settings)) {
            if (!(RecordingPresetApiModel.SETTINGS_KEYS as readonly string[]).includes(key))
                throw new Error('InvalidRequestBody');
            if (key === 'isDeleteOriginalAfterEncode' || key === 'allowEndLack') {
                if (typeof value !== 'boolean') throw new Error('InvalidRequestBody');
            } else if (key === 'priority') {
                if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5)
                    throw new Error('InvalidRequestBody');
            } else if (key === 'startMarginSec' || key === 'endMarginSec') {
                if (
                    value !== null &&
                    (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3600)
                )
                    throw new Error('InvalidRequestBody');
            } else if (key === 'tags') {
                if (
                    !Array.isArray(value) ||
                    value.some(id => typeof id !== 'number' || !Number.isInteger(id) || id < 1)
                )
                    throw new Error('InvalidRequestBody');
            } else if (key === 'conflictPolicy') {
                if (
                    ![
                        'STRICT',
                        'ALLOW_END_LACK',
                        'ALLOW_HEAD_LACK',
                        'ALLOW_PARTIAL',
                        'PREEMPT_LOWER_PRIORITY',
                    ].includes(String(value))
                )
                    throw new Error('InvalidRequestBody');
            } else if (value !== null && typeof value !== 'string') throw new Error('InvalidRequestBody');
        }
        return { name, settings };
    }

    private async clearDefault(exceptId?: number): Promise<void> {
        const items = await this.db.findAll();
        for (const item of items) {
            if (item.isDefault && item.id !== exceptId) {
                item.isDefault = false;
                await this.db.update(item);
            }
        }
    }

    private toApiItem(item: RecordingPreset): apid.RecordingPresetItem {
        return {
            id: item.id,
            name: item.name,
            isDefault: item.isDefault,
            settings: JSON.parse(item.settings),
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        };
    }
}
