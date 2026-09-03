<template>
    <v-list role="listbox" class="playback-quality-list" lines="three">
        <v-list-item class="header-row pr-2" min-height="36">
            <div class="d-flex align-center justify-space-between w-100">
                <span class="text-caption">画質</span>
                <!-- v-switch は狭い端末でつまみがカード右端をはみ出すため、トグルボタンにしている -->
                <v-btn
                    class="detail-toggle"
                    variant="text"
                    size="small"
                    density="comfortable"
                    :color="showDetail === true ? 'primary' : undefined"
                    :prepend-icon="showDetail === true ? 'mdi-eye' : 'mdi-eye-outline'"
                    @click="onToggleDetail(showDetail === false)"
                    >詳しく表示</v-btn
                >
            </div>
        </v-list-item>
        <PlaybackQualityItem
            v-for="profile in primaryProfiles"
            :key="profile.id"
            :profile="profile"
            :selected="profile.id === selectedId"
            :show-detail="showDetail"
            :source="source"
            :recommended="recommended"
            :container="streamContainer"
            @select="select"
        ></PlaybackQualityItem>
        <v-list-item v-if="otherProfiles.length > 0" min-height="44" @click="showOther = !showOther">
            <v-list-item-title>このサーバー独自の設定 ({{ otherProfiles.length }})</v-list-item-title>
            <template #append>{{ showOther ? '▲' : '▼' }}</template>
        </v-list-item>
        <PlaybackQualityItem
            v-for="profile in (showOther ? otherProfiles : [])"
            :key="profile.id"
            :profile="profile"
            :selected="profile.id === selectedId"
            :show-detail="showDetail"
            :source="source"
            :recommended="recommended"
            :container="streamContainer"
            @select="select"
        ></PlaybackQualityItem>
        <v-list-item v-if="visibleProfiles.length === 0" min-height="44">この配信方式で使える画質がありません。配信方式を変えてください</v-list-item>
    </v-list>
</template>

<script lang="ts">
import * as apid from '../../../../../api';
import container from '@/model/ModelContainer';
import { Component, Emit, Prop, Vue, toNative } from 'vue-facing-decorator';
import PlaybackQualityItem from './PlaybackQualityItem.vue';
import IPlaybackOptionsState from '@/model/state/video/IPlaybackOptionsState';

@Component({ components: { PlaybackQualityItem } })
class PlaybackQualityList extends Vue {
    @Prop({ required: true }) public profiles!: apid.PlaybackProfile[];
    @Prop({ default: 'auto' }) public selectedId!: string;
    @Prop({ required: false }) public source: apid.SourceCapabilities | undefined;
    @Prop({ required: false }) public recommended: apid.PlaybackOptions['recommended'] | undefined;
    // 選択中の配信方式のコンテナ。config.yml の stream mode 番号表示に使う
    @Prop({ required: false }) public streamContainer: Exclude<apid.PlaybackContainer, 'normal'> | undefined;
    public showOther = false;

    private playbackState: IPlaybackOptionsState = container.get<IPlaybackOptionsState>('IPlaybackOptionsState');

    get showDetail(): boolean {
        return this.playbackState.preference.showQualityDetail;
    }

    get visibleProfiles(): apid.PlaybackProfile[] {
        return this.profiles.filter(profile => profile.available === true);
    }
    get primaryProfiles(): apid.PlaybackProfile[] {
        const primary = this.visibleProfiles.filter(profile => profile.builtin === true);
        // auto は必ず先頭に来るようにする (サーバの並び順が変わっても表示側で保証する)
        const isAuto = (profile: apid.PlaybackProfile): boolean => (profile.role ?? profile.id) === 'auto';
        return [...primary].sort((a, b) => (isAuto(a) ? -1 : isAuto(b) ? 1 : 0));
    }
    get otherProfiles(): apid.PlaybackProfile[] {
        return this.visibleProfiles.filter(profile => profile.builtin !== true);
    }

    /**
     * 「詳しく表示」が切り替えられたときに呼ばれる。全画面共通の設定として永続化する
     * @param value: boolean | null 切り替え後の値
     */
    public onToggleDetail(value: boolean | null): void {
        this.playbackState.savePreference({ showQualityDetail: value === true });
    }

    @Emit('select')
    public select(id: string): string {
        return id;
    }
}

export default toNative(PlaybackQualityList);
</script>

<style scoped>
.playback-quality-list { padding: 0; }
.header-row { border-bottom: 1px solid rgba(128, 128, 128, 0.2); }
.detail-toggle { flex: 0 0 auto; }
</style>
