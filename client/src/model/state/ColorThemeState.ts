import { inject, injectable } from 'inversify';
import IColorThemeState from '@/model/state/IColorThemeState';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import ThemeColorUtil from '@/util/ThemeColorUtil';
import Util from '@/util/Util';

@injectable()
export default class ColorThemeState implements IColorThemeState {
    private settingModel: ISettingStorageModel;

    constructor(@inject('ISettingStorageModel') settingModel: ISettingStorageModel) {
        this.settingModel = settingModel;
    }

    private static isDarkTheme(shouldUseOSColorTheme: boolean, isForceDarkTheme: boolean): boolean {
        if (shouldUseOSColorTheme) {
            return Util.getOSDarkTheme();
        } else {
            return isForceDarkTheme;
        }
    }

    public isDarkTheme(): boolean {
        const shouldUseOSColorTheme = this.settingModel.getSavedValue().shouldUseOSColorTheme;
        const isForceDarkTheme = this.settingModel.getSavedValue().isForceDarkTheme;

        return ColorThemeState.isDarkTheme(shouldUseOSColorTheme, isForceDarkTheme);
    }

    public isTmpDarkTheme(): boolean {
        const shouldUseOSColorTheme = this.settingModel.tmp.shouldUseOSColorTheme;
        const isForceDarkTheme = this.settingModel.tmp.isForceDarkTheme;

        return ColorThemeState.isDarkTheme(shouldUseOSColorTheme, isForceDarkTheme);
    }

    /**
     * 保存済みのテーマカラーを返す
     * 古い localStorage には themeColor が無いため normalize() で既定値へ倒す
     * @return ThemeColorUtil.ThemeColorType
     */
    public getThemeColor(): ThemeColorUtil.ThemeColorType {
        return ThemeColorUtil.normalize(this.settingModel.getSavedValue().themeColor);
    }

    /**
     * 設定画面で編集中 (未保存) のテーマカラーを返す
     * @return ThemeColorUtil.ThemeColorType
     */
    public getTmpThemeColor(): ThemeColorUtil.ThemeColorType {
        return ThemeColorUtil.normalize(this.settingModel.tmp.themeColor);
    }
}
