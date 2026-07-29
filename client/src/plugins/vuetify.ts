import '@mdi/font/css/materialdesignicons.css';
import 'material-design-icons-iconfont/dist/material-design-icons.css';
import 'typeface-roboto/index.css';
import 'vuetify/styles';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import { createVuetify } from 'vuetify';

// components / directives を明示的に登録しないと <v-app> 等が
// 未解決のカスタム要素として素通しされ、UI がほぼ真っ白になる。
// 選択肢データは Vuetify 3 以降の標準形式 { title, value } に統一済みなので
// item-title は既定値 ('title') のまま使う。ここで 'text' に差し替えると
// title を持つ選択肢の表示が [object Object] になる。
export default createVuetify({
    components,
    directives,
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
});
