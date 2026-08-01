<template>
    <v-main>
        <TitleBar title="系列局"></TitleBar>
        <v-container>
            <div class="text-caption text-grey mb-3">
                系列を選ぶとその系列の放送局だけを並べた番組表へ移動します。系列は放送波の BIT (系列識別) と同梱データから判定しています。
            </div>

            <v-alert v-if="groups.length === 0" type="info">放送局情報がまだ取得できていません</v-alert>

            <v-row v-else>
                <v-col v-for="group in groups" :key="group.id" cols="12" md="6">
                    <v-card variant="outlined" class="affiliation-card" @click="gotoGuide(group)">
                        <v-card-title class="d-flex align-center text-subtitle-1">
                            <span>{{ group.name }}</span>
                            <v-chip class="ml-2" size="x-small" variant="tonal">{{ group.channels.length }} 局</v-chip>
                            <v-spacer></v-spacer>
                            <v-icon size="small">mdi-chevron-right</v-icon>
                        </v-card-title>
                        <v-card-text>
                            <div class="d-flex flex-wrap ga-1">
                                <v-chip
                                    v-for="channel in group.channels"
                                    :key="channel.id"
                                    size="small"
                                    variant="outlined"
                                    @click.stop="gotoChannelGuide(channel)"
                                >
                                    {{ channel.name }}
                                </v-chip>
                            </div>
                        </v-card-text>
                    </v-card>
                </v-col>
            </v-row>
        </v-container>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IChannelModel, { Channel } from '@/model/channels/IChannelModel';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Vue, toNative } from 'vue-facing-decorator';

/**
 * 系列 (日テレ系・TBS 系・独立系…) の一覧画面。
 * 系列を選ぶとその系列だけの番組表 (`/guide?affiliation=`) へ遷移する。
 * 系列の判定はサーバ側 (`BroadcastAffiliation`) が付けた `channel.affiliation` をそのまま使う
 */
interface AffiliationGroup {
    id: string;
    name: string;
    order: number;
    channels: Channel[];
}

@Component({ components: { TitleBar } })
class AffiliationsView extends Vue {
    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');
    private settingStorageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    public groups: AffiliationGroup[] = [];

    public async mounted(): Promise<void> {
        await this.channelModel.fetchChannels().catch(err => console.error(err));
        this.build();
    }

    /**
     * 放送局を系列ごとにまとめる。系列を持たない放送波 (BS / CS / SKY) は対象外
     */
    private build(): void {
        const isHalfWidth = this.settingStorageModel.getSavedValue().isHalfWidthDisplayed;
        const index = new Map<string, AffiliationGroup>();

        for (const channel of this.channelModel.getChannels(isHalfWidth)) {
            const affiliation = channel.affiliation;
            if (typeof affiliation === 'undefined') {
                continue;
            }

            const group = index.get(affiliation.id);
            if (typeof group === 'undefined') {
                index.set(affiliation.id, {
                    id: affiliation.id,
                    name: affiliation.name,
                    order: affiliation.order,
                    channels: [channel],
                });
            } else {
                group.channels.push(channel);
            }
        }

        this.groups = [...index.values()].sort((a, b) => a.order - b.order);
    }

    /**
     * 系列別の番組表へ移動する
     */
    public gotoGuide(group: AffiliationGroup): void {
        void this.$router.push({ path: '/guide', query: { affiliation: group.id } });
    }

    /**
     * 単局の番組表へ移動する
     */
    public gotoChannelGuide(channel: Channel): void {
        void this.$router.push({ path: '/guide', query: { channelId: String(channel.id) } });
    }
}

export default toNative(AffiliationsView);
</script>

<style lang="sass" scoped>
.affiliation-card
    cursor: pointer
</style>
