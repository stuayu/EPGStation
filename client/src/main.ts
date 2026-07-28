import 'reflect-metadata';
import smoothscroll from 'smoothscroll-polyfill';
import { createApp } from 'vue';
import App from './App.vue';
import DateTimePicker from './components/compat/DateTimePicker.vue';
import IChannelModel from './model/channels/IChannelModel';
import container from './model/ModelContainer';
import setter from './model/ModelContainerSetter';
import IPWAConfigModel from './model/pwa/IPWAConfigModel';
import IServerConfigModel from './model/serverConfig/IServerConfigModel';
import IAuthApiModel from './model/api/auth/IAuthApiModel';
import Login from './views/Login.vue';
import vuetify from './plugins/vuetify';
import router from './router';
setter(container);
smoothscroll.polyfill();
(async (): Promise<void> => {
    // 認証が有効で未ログインの場合は、他の API を叩かずログイン画面だけを表示する
    // (config / channels の取得は認証必須のため、先に 401 で失敗してしまう)
    const authStatus = await container
        .get<IAuthApiModel>('IAuthApiModel')
        .getStatus()
        .catch(() => ({ enabled: false, initialized: true, user: null }));
    if (authStatus.enabled === true && authStatus.user === null) {
        createApp(Login).use(vuetify).mount('#app');

        return;
    }

    const serverConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    await serverConfigModel.fetchConfig().catch(err => console.error('get server config error', err));
    container.get<IPWAConfigModel>('IPWAConfigModel').setting();
    await container.get<IChannelModel>('IChannelModel').fetchChannels().catch(err => console.error('get channels error', err));
    const app = createApp(App);
    app.component('v-datetime-picker', DateTimePicker);
    app.use(router).use(vuetify).mount('#app');
})();
