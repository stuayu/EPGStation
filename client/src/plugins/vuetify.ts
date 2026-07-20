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
// 既存の選択肢データは Vuetify 2 の { text, value } 形式のため、
// Vuetify 3 デフォルトの item-title ('title') を 'text' に差し替える。
export default createVuetify({
    components,
    directives,
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
    defaults: {
        VSelect: { itemTitle: 'text' },
        VAutocomplete: { itemTitle: 'text' },
        VCombobox: { itemTitle: 'text' },
    },
});
