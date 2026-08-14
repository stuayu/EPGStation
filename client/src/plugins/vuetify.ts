import '@mdi/font/css/materialdesignicons.css';
import 'material-design-icons-iconfont/dist/material-design-icons.css';
import 'typeface-roboto/index.css';
import 'vuetify/styles';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import { createVuetify } from 'vuetify';
import ThemeColorUtil from '@/util/ThemeColorUtil';

// components / directives を明示的に登録しないと <v-app> 等が
// 未解決のカスタム要素として素通しされ、UI がほぼ真っ白になる。
// 選択肢データは Vuetify 3 以降の標準形式 { title, value } に統一済みなので
// item-title は既定値 ('title') のまま使う。ここで 'text' に差し替えると
// title を持つ選択肢の表示が [object Object] になる。
//
// theme: ユーザーが設定画面から選べるテーマカラーを `appTheme` として登録する。
// ここで初期値を持たせておかないと Vuetify が `bg-appTheme` / `text-appTheme` の
// ユーティリティクラスを生成しないため、必ず両テーマに定義を置く。
// 実際の色は起動時と設定変更時に ThemeColorUtil.apply() が上書きする。
//
// defaults: Vuetify 3 以降の v-switch / v-progress-linear は color 未指定だと
// currentColor (ほぼ黒) で描画され、スイッチはオン/オフの区別が付かず
// プログレスバーも白黒になる。上流 (Vuetify 2) と同じ色付きの見た目にするため
// 既定色をテーマカラーに寄せる。個別に color を指定している箇所はそちらが優先される。
const defaultColor = ThemeColorUtil.getDefinition(ThemeColorUtil.DEFAULT_COLOR);

export default createVuetify({
    components,
    directives,
    theme: {
        themes: {
            light: {
                colors: {
                    [ThemeColorUtil.COLOR_NAME]: defaultColor.light,
                },
            },
            dark: {
                colors: {
                    [ThemeColorUtil.COLOR_NAME]: defaultColor.dark,
                },
            },
        },
    },
    defaults: {
        VSwitch: {
            color: ThemeColorUtil.COLOR_NAME,
        },
        VProgressLinear: {
            color: ThemeColorUtil.COLOR_NAME,
        },
    },
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
});
