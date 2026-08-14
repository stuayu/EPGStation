/**
 * システム全体のテーマカラー
 *
 * Vuetify の theme に `appTheme` という独自の色を足し、その値を切り替えることで
 * ヘッダー・ナビゲーション・トグルスイッチ・プログレスバーの色をまとめて変える。
 * `primary` そのものは差し替えない (ボタン・チップなど `color="primary"` を
 * 明示している箇所の色まで連動して変わってしまうため)
 */
namespace ThemeColorUtil {
    export type ThemeColorType = 'indigo' | 'blue' | 'teal' | 'green' | 'orange' | 'red' | 'purple' | 'blueGrey';

    export interface ThemeColorDefinition {
        value: ThemeColorType;
        title: string;
        // ライトテーマ用 (濃いめ。白文字が載る前提)
        light: string;
        // ダークテーマ用 (背景が暗いため明るめの色にしないと沈む)
        dark: string;
    }

    /**
     * Vuetify theme へ登録する色名
     * `bg-appTheme` / `text-appTheme` / `--v-theme-appTheme` として使える
     */
    export const COLOR_NAME = 'appTheme';

    /**
     * 既定のテーマカラー
     * 従来ハードコードされていたヘッダー色 (indigo) と同じ見た目を保つ
     */
    export const DEFAULT_COLOR: ThemeColorType = 'indigo';

    /**
     * 選択可能なテーマカラー一覧 (設定画面のセレクトボックスの選択肢でもある)
     */
    export const COLORS: ThemeColorDefinition[] = [
        { value: 'indigo', title: 'ブルー (既定)', light: '#3F51B5', dark: '#7986CB' },
        { value: 'blue', title: 'ライトブルー', light: '#1976D2', dark: '#64B5F6' },
        { value: 'teal', title: 'ティール', light: '#00897B', dark: '#4DB6AC' },
        { value: 'green', title: 'グリーン', light: '#43A047', dark: '#81C784' },
        { value: 'orange', title: 'オレンジ', light: '#EF6C00', dark: '#FFB74D' },
        { value: 'red', title: 'レッド', light: '#D32F2F', dark: '#E57373' },
        { value: 'purple', title: 'パープル', light: '#7B1FA2', dark: '#BA68C8' },
        { value: 'blueGrey', title: 'ブルーグレー', light: '#546E7A', dark: '#90A4AE' },
    ];

    /**
     * 指定された値が定義済みのテーマカラーか判定し、未定義なら既定値を返す
     * localStorage には古い設定値が残りうるため、読み出し側は必ずここを通す
     * @param value: any
     * @return ThemeColorType
     */
    export const normalize = (value: any): ThemeColorType => {
        return COLORS.some(c => c.value === value) === true ? (value as ThemeColorType) : DEFAULT_COLOR;
    };

    /**
     * テーマカラーの定義を取得する
     * @param value: ThemeColorType
     * @return ThemeColorDefinition
     */
    export const getDefinition = (value: ThemeColorType): ThemeColorDefinition => {
        const normalized = normalize(value);

        return COLORS.find(c => c.value === normalized)!;
    };

    /**
     * apply() が必要とする最小限の形
     * コンポーネントから渡ってくる `$vuetify.theme` は UnwrapNestedRefs<ThemeInstance> で
     * `themes` の ref が剥がれているため、Vuetify の型をそのまま受けると噛み合わない
     */
    export interface ThemeColorTarget {
        themes: { [name: string]: { colors: { [key: string]: any } } | undefined };
    }

    /**
     * ライト / ダーク両テーマの `appTheme` を指定された色で塗り替える
     *
     * `theme.themes` はリアクティブなため、色を書き換えると Vuetify 側で
     * `computedThemes` → `styles` が再計算され、CSS 変数が即座に更新される。
     * 表示中のテーマだけでなく両方を更新するのは、ダーク / ライトを
     * 切り替えたときに古い色が残らないようにするため
     * @param theme: ThemeColorTarget ($vuetify.theme)
     * @param value: ThemeColorType
     */
    export const apply = (theme: ThemeColorTarget, value: ThemeColorType): void => {
        const definition = getDefinition(value);

        const lightColors = theme.themes.light?.colors;
        if (typeof lightColors !== 'undefined') {
            lightColors[COLOR_NAME] = definition.light;
        }

        const darkColors = theme.themes.dark?.colors;
        if (typeof darkColors !== 'undefined') {
            darkColors[COLOR_NAME] = definition.dark;
        }
    };
}

export default ThemeColorUtil;
