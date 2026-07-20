import { injectable } from 'inversify';
import IStorageBaseModel from './IStorageBaseModel';
import IStorageOperationModel from './IStorageOperationModel';

/**
 * IStorageBaseModel を実装する際に継承するベースクラス
 */
@injectable()
export default abstract class AbstractStorageBaseModel<T extends object> implements IStorageBaseModel<T> {
    public tmp: T;

    private op: IStorageOperationModel;

    constructor(op: IStorageOperationModel) {
        this.op = op;
        const value = this.op.get<T>(this.getStorageKey());

        if (value === null) {
            this.tmp = this.getDefaultValue();
            this.save();
            return;
        }

        const defaultValue = this.getDefaultValue();
        const isNeedSave = Object.keys(defaultValue).some(key => !(key in value));
        this.tmp = Object.assign(defaultValue, value);

        if (isNeedSave) {
            this.save();
        }
    }

    /**
     * 保存された値を取得する
     */
    public getSavedValue(): T {
        return this.op.get<T>(this.getStorageKey()) ?? this.getDefaultValue();
    }

    /**
     * tmp をリセットする
     */
    public resetTmpValue(): void {
        this.tmp = this.getSavedValue();
    }

    /**
     * tmp の内容を保存する
     */
    public save(): void {
        try {
            this.op.set(this.getStorageKey(), this.tmp);
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * デフォルト値を返す
     */
    public abstract getDefaultValue(): T;

    /**
     * 保存時に使用するキーを返す
     */
    public abstract getStorageKey(): string;
}
