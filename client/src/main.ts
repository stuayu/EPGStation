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
import { setMediaToken } from './util/MediaToken';
import vuetify from './plugins/vuetify';
import router from './router';
import OfflineVideoStorage from './services/OfflineVideoStorage';
import { setOfflineStartup } from './util/OfflineStartup';
setter(container);
smoothscroll.polyfill();
(async (): Promise<void> => {
    // 認証が有効で未ログインの場合は、他の API を叩かずログイン画面だけを表示する
    // (config / channels の取得は認証必須のため、先に 401 で失敗してしまう)。
    // ただし匿名利用が許可されている場合は通常画面を出し、
    // ログインが要る操作をしたとき (?login=1) だけログイン画面へ切り替える
    const authStatus = await container
        .get<IAuthApiModel>('IAuthApiModel')
        .getStatus()
        .catch(() => ({ enabled: false, initialized: true, user: null, allowAnonymous: false }));
    const isLoginRequested = new URLSearchParams(window.location.search).has('login');
    const needsLogin =
        authStatus.enabled === true &&
        authStatus.user === null &&
        (authStatus.allowAnonymous !== true || isLoginRequested === true);
    if (needsLogin === true) {
        createApp(Login).use(vuetify).mount('#app');

        return;
    }

    // 外部プレイヤー・IPTV 用のアクセストークンを取っておく (認証無効なら null)
    await container
        .get<IAuthApiModel>('IAuthApiModel')
        .getMediaToken()
        .then(setMediaToken)
        .catch(err => console.error('get media token error', err));

    const serverConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    let configFetchFailed = false;
    await serverConfigModel.fetchConfig().catch(err => {
        configFetchFailed = true;
        if (navigator.onLine !== false) console.error('get server config error', err);
    });
    container.get<IPWAConfigModel>('IPWAConfigModel').setting();
    if (navigator.onLine !== false) {
        await container.get<IChannelModel>('IChannelModel').fetchChannels().catch(err => console.error('get channels error', err));
    }
    const hasOfflineVideos = configFetchFailed ? (await OfflineVideoStorage.getAll().catch(() => [])).length > 0 : false;
    const shouldOpenOfflineVideos = navigator.onLine === false || (configFetchFailed && hasOfflineVideos);
    setOfflineStartup(shouldOpenOfflineVideos);
    const app = createApp(App);
    app.component('v-datetime-picker', DateTimePicker);
    if (shouldOpenOfflineVideos === true && router.currentRoute.value.path !== '/offline-videos') {
        // mount 前の router.replace() は scrollBehavior の完了通知を待つため、
        // オフライン時に不要なタイムアウトを起こす。hash を先に書き換え、初期遷移で解決する。
        window.history.replaceState(window.history.state, '', router.resolve('/offline-videos').href);
    }
    app.use(router).use(vuetify).mount('#app');
})();
