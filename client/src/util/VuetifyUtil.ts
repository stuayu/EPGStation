import type { ComponentPublicInstance } from 'vue';
import Util from './Util';

namespace VuetifyUtil {
    /**
     * v-text-field にフォーカスさせる
     * @param vueComponent: Vue
     * @return Promise<void>
     */
    export const focusTextFiled = async (vueComponent: ComponentPublicInstance): Promise<void> => {
        const inputs = vueComponent.$el.getElementsByTagName('input');
        if (typeof inputs[0] === 'undefined') {
            throw new Error('InputElementIsNotFound');
        }

        await Util.sleep(100);
        inputs[0].focus();
    };
}

export default VuetifyUtil;
