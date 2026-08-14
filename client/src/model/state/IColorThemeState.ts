import ThemeColorUtil from '@/util/ThemeColorUtil';

export default interface IColorThemeState {
    isDarkTheme(): boolean;
    isTmpDarkTheme(): boolean;
    getThemeColor(): ThemeColorUtil.ThemeColorType;
    getTmpThemeColor(): ThemeColorUtil.ThemeColorType;
}
