<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="600" scrollable>
        <v-card class="watch-pinned-channels-dialog">
            <v-card-title class="text-subtitle-1">ピン留めする放送局</v-card-title>
            <v-card-text class="pa-0">
                <div class="section-title">ピン留め済み ({{ pinnedItems.length }})</div>
                <div v-if="pinnedItems.length === 0" class="empty text-body-2">下の一覧から放送局を選んでください</div>
                <v-list v-else density="compact" class="pinned-list">
                    <v-list-item v-for="(item, index) in pinnedItems" :key="item.id">
                        <template #prepend>
                            <img v-if="item.hasLogoData === true" :src="getLogoSrc(item.id)" class="logo" />
                        </template>
                        <v-list-item-title>{{ item.name }}</v-list-item-title>
                        <template #append>
                            <v-btn icon variant="text" size="x-small" title="上へ" :disabled="index === 0" v-on:click="move(index, -1)">
                                <v-icon>mdi-arrow-up</v-icon>
                            </v-btn>
                            <v-btn icon variant="text" size="x-small" title="下へ" :disabled="index === pinnedItems.length - 1" v-on:click="move(index, 1)">
                                <v-icon>mdi-arrow-down</v-icon>
                            </v-btn>
                            <v-btn icon variant="text" size="x-small" title="ピン留めを解除" v-on:click="unpin(item.id)">
                                <v-icon>mdi-close</v-icon>
                            </v-btn>
                        </template>
                    </v-list-item>
                </v-list>

                <v-divider class="my-2"></v-divider>

                <div class="px-4">
                    <v-text-field v-model="keyword" label="放送局を検索" clearable density="compact" prepend-inner-icon="mdi-magnify" hide-details></v-text-field>
                </div>
                <div class="channel-list">
                    <template v-for="group in groups" :key="group.name">
                        <div class="section-title">{{ group.name }}</div>
                        <v-list density="compact">
                            <v-list-item v-for="channel in group.channels" :key="channel.id" v-on:click="togglePin(channel.id)">
                                <template #prepend>
                                    <v-checkbox-btn :model-value="isPinned(channel.id)" density="compact" hide-details></v-checkbox-btn>
                                </template>
                                <v-list-item-title>{{ channel.name }}</v-list-item-title>
                            </v-list-item>
                        </v-list>
                    </template>
                    <div v-if="groups.length === 0" class="empty text-body-2">該当する放送局がありません</div>
                </div>
            </v-card-text>
            <v-card-actions>
                <v-btn variant="text" size="small" :disabled="pinnedItems.length === 0" v-on:click="clearAll">すべて解除</v-btn>
                <v-spacer></v-spacer>
                <v-btn variant="text" color="primary" v-on:click="close">閉じる</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IChannelModel, { Channel } from '@/model/channels/IChannelModel';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

interface ChannelGroup {
    name: string;
    channels: Channel[];
}

/**
 * 視聴画面のチャンネル一覧でピン留めする放送局をまとめて設定するダイアログ
 * 一覧の各行にあるピンアイコンと同じ設定 (pinnedChannelIds) を編集する
 */
@Component({})
class WatchPinnedChannelsDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;
    public keyword: string = '';

    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    /**
     * Prop で受け取った isOpen を直接は書き換えられないので
     * getter, setter を用意する
     */
    get dialogModel(): boolean {
        return this.isOpen;
    }
    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    /**
     * ピン留めした放送局
     * 保存値 (getSavedValue) は localStorage の直読みで再描画の対象にならないため、リアクティブな tmp を参照する
     */
    get pinnedChannelIds(): apid.ChannelId[] {
        return this.setting.tmp.pinnedChannelIds ?? [];
    }

    /**
     * ピン留め済みの放送局 (ピン留めした順)
     * 放送局情報が引けなくなったもの (削除された放送局) は表示しない
     */
    get pinnedItems(): Channel[] {
        return this.pinnedChannelIds
            .map(channelId => {
                return this.channelModel.findChannel(channelId, true);
            })
            .filter((channel): channel is Channel => {
                return channel !== null;
            });
    }

    /**
     * 放送波種別ごとにまとめた放送局一覧 (キーワードで絞り込む)
     */
    get groups(): ChannelGroup[] {
        const keyword = this.keyword === null ? '' : this.keyword.trim();
        const groups: ChannelGroup[] = [];
        const groupIndex: { [name: string]: ChannelGroup } = {};

        for (const channel of this.channelModel.getChannels(true)) {
            if (keyword.length > 0 && channel.name.includes(keyword) === false) {
                continue;
            }

            // 地上波系 (GR / NWxx) は地域名でまとめ、BS / CS / SKY は放送波種別でまとめる
            const name = channel.region?.name ?? channel.channelType;
            if (typeof groupIndex[name] === 'undefined') {
                groupIndex[name] = {
                    name: name,
                    channels: [],
                };
                groups.push(groupIndex[name]);
            }
            groupIndex[name].channels.push(channel);
        }

        return groups;
    }

    public getLogoSrc(channelId: apid.ChannelId): string {
        return `./api/channels/${channelId.toString(10)}/logo`;
    }

    public isPinned(channelId: apid.ChannelId): boolean {
        return this.pinnedChannelIds.includes(channelId);
    }

    /**
     * ピン留めの追加・解除
     * @param channelId: apid.ChannelId
     */
    public togglePin(channelId: apid.ChannelId): void {
        const pinnedIds = [...this.pinnedChannelIds];
        const index = pinnedIds.indexOf(channelId);
        if (index === -1) {
            pinnedIds.push(channelId);
        } else {
            pinnedIds.splice(index, 1);
        }

        this.save(pinnedIds);
    }

    public unpin(channelId: apid.ChannelId): void {
        this.save(
            this.pinnedChannelIds.filter(id => {
                return id !== channelId;
            }),
        );
    }

    /**
     * ピン留めの並び順を入れ替える
     * @param index: number 対象の位置
     * @param direction: number -1: 上へ, 1: 下へ
     */
    public move(index: number, direction: number): void {
        const pinnedIds = [...this.pinnedChannelIds];
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= pinnedIds.length) {
            return;
        }

        [pinnedIds[index], pinnedIds[newIndex]] = [pinnedIds[newIndex], pinnedIds[index]];
        this.save(pinnedIds);
    }

    public clearAll(): void {
        this.save([]);
    }

    public close(): void {
        this.dialogModel = false;
    }

    private save(pinnedChannelIds: apid.ChannelId[]): void {
        this.setting.tmp.pinnedChannelIds = pinnedChannelIds;
        this.setting.save();

        this.$emit('changed');
    }

    @Watch('isOpen', { immediate: true })
    public async onChangeState(newState: boolean, oldState: boolean): Promise<void> {
        if (newState === true && !!oldState === false) {
            // open
            this.keyword = '';

            // 放送局情報が未取得なら取得しておく
            if (this.channelModel.getChannels(true).length === 0) {
                await this.channelModel.fetchChannels().catch(err => {
                    console.error(err);
                });
            }
        } else if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                // dialog close アニメーションが終わったら要素を削除する
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                });
            });
        }
    }
}

export default toNative(WatchPinnedChannelsDialog);
</script>

<style lang="sass" scoped>
.watch-pinned-channels-dialog
    .section-title
        padding: 8px 16px 4px
        font-size: 0.75rem
        font-weight: bold
        opacity: 0.7

    .empty
        padding: 4px 16px 8px
        opacity: 0.6

    .logo
        height: 18px
        max-width: 40px
        margin-right: 8px
        object-fit: contain

    .pinned-list
        max-height: 220px
        overflow-y: auto

    .channel-list
        max-height: 320px
        overflow-y: auto
</style>
