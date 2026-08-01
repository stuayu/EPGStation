import { createRouter, createWebHashHistory } from 'vue-router';
import type { RouterScrollBehavior } from 'vue-router';
import container from './model/ModelContainer';
import IScrollPositionState from './model/state/IScrollPositionState';
import Affiliations from './views/Affiliations.vue';
import Dashboard from './views/Dashboard.vue';
import Encode from './views/Encode.vue';
import Guide from './views/Guide.vue';
import GuideSizeSetting from './views/GuideSizeSetting.vue';
import ManualReserve from './views/ManualReserve.vue';
import OnAir from './views/OnAir.vue';
import Recorded from './views/Recorded.vue';
import RecordedDetail from './views/RecordedDetail.vue';
import RecordedUpload from './views/RecordedUpload.vue';
import Recording from './views/Recording.vue';
import Reserves from './views/Reserves.vue';
import Rule from './views/Rule.vue';
import Search from './views/Search.vue';
import Settings from './views/Settings.vue';
import SystemSetting from './views/SystemSetting.vue';
import Series from './views/Series.vue';
import SeriesDetail from './views/SeriesDetail.vue';
import SeriesMapping from './views/SeriesMapping.vue';
import SeriesPending from './views/SeriesPending.vue';
import Logs from './views/Logs.vue';
import Storages from './views/Storages.vue';
import WatchHistory from './views/WatchHistory.vue';
import WatchOnAir from './views/WatchOnAir.vue';
import WatchRecorded from './views/WatchRecorded.vue';
import WatchRecordedStreaming from './views/WatchRecordedStreaming.vue';
const scrollBehavior: RouterScrollBehavior = async (_to, _from, savedPosition) => {
    await container.get<IScrollPositionState>('IScrollPositionState').onDoneGetData();
    return savedPosition ?? { left: 0, top: 0 };
};
export default createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: '/', name: 'dashboard', component: Dashboard },
        { path: '/onair', name: 'onair', component: OnAir },
        { path: '/onair/watch', name: 'watch-onair', component: WatchOnAir },
        { path: '/guide', name: 'guide', component: Guide },
        { path: '/guide/setting', name: 'guide-setting', component: GuideSizeSetting },
        { path: '/affiliations', name: 'affiliations', component: Affiliations },
        { path: '/reserves', name: 'reserves', component: Reserves },
        { path: '/reserves/manual', name: 'manual-reserve', component: ManualReserve },
        { path: '/recording', name: 'recording', component: Recording },
        { path: '/recorded', name: 'recorded', component: Recorded },
        { path: '/series', name: 'series', component: Series },
        { path: '/series/pending', name: 'series-pending', component: SeriesPending },
        { path: '/series/:id', name: 'series-detail', component: SeriesDetail },
        { path: '/recorded/:id/series-mapping', name: 'series-mapping', component: SeriesMapping },
        { path: '/recorded/upload', name: 'recorded-upload', component: RecordedUpload },
        { path: '/recorded/watch', name: 'recorded-watch', component: WatchRecorded },
        { path: '/recorded/detail/:id', name: 'recorded-detail', component: RecordedDetail },
        { path: '/recorded/streaming/:id', name: 'recorded-streaming', component: WatchRecordedStreaming },
        { path: '/watch-history', name: 'watch-history', component: WatchHistory },
        { path: '/encode', name: 'encode', component: Encode },
        { path: '/search', name: 'search', component: Search },
        { path: '/rule', name: 'rule', component: Rule },
        { path: '/settings', name: 'settings', component: Settings },
        { path: '/settings/system', name: 'system-settings', component: SystemSetting },
        { path: '/storages', name: 'storages', component: Storages },
        { path: '/logs', name: 'logs', component: Logs },
    ],
    scrollBehavior,
});
