<template>
    <div class="channels d-flex" v-bind:class="{ isDark: $vuetify.theme.global.current.dark === true }">
        <div class="item dummy">dummy</div>
        <div class="text-white item" v-for="channel in channelItems" v-bind:key="channel.index" v-on:click="onClick(channel.item)">
            <img
                v-if="typeof channel.logoSrc !== 'undefined'"
                :src="channel.logoSrc"
                loading="lazy"
                class="channel-logo"
                v-on:error="onLogoError(channel)"
            />
            <span class="channel-name">{{ channel.name }}</span>
        </div>
        <div class="item scrollbar">dummy</div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IGuideState from '@/model/state/guide/IGuideState';
import IOnAirSelectStreamState from '@/model/state/onair/IOnAirSelectStreamState';
import DateUtil from '@/util/DateUtil';
import Util from '@/util/Util';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

interface DisplayChannelItem {
    name: string;
    id: apid.ChannelId;
    index: number | string;
    item: apid.ScheduleChannleItem;
    // 放送局が現在ロゴを保持している場合のみ設定 (単局表示時の日付見出しでは表示しない)
    logoSrc?: string;
}

@Component({})
class Channel extends Vue {
    public guideState: IGuideState = container.get<IGuideState>('IGuideState');

    private streamSelectDialog: IOnAirSelectStreamState = container.get<IOnAirSelectStreamState>('IOnAirSelectStreamState');

    // ロゴ画像の取得に失敗した放送局 id (取得済み結果は channelItems の再計算で失われるため component 側で保持する)
    private failedLogoIds = new Set<apid.ChannelId>();

    get channelItems(): DisplayChannelItem[] {
        if (typeof this.$route.query.channelId === 'undefined') {
            return this.guideState.getChannels().map(c => {
                return {
                    name: c.name,
                    id: c.id,
                    index: c.id,
                    item: c,
                    logoSrc: c.hasLogoData === true && this.failedLogoIds.has(c.id) === false ? `./api/channels/${c.id.toString(10)}/logo` : undefined,
                };
            });
        } else {
            let baseTime = this.guideState.getStartAt();

            return this.guideState.getChannels().map(c => {
                const name = DateUtil.format(DateUtil.getJaDate(new Date(baseTime)), 'MM/dd(w)');
                baseTime += 60 * 60 * 24 * 1000;

                return {
                    name: name,
                    id: c.id,
                    index: name,
                    item: c,
                };
            });
        }
    }

    // ロゴ画像の取得に失敗した場合は局名だけの表示にフォールバックする
    public onLogoError(channel: DisplayChannelItem): void {
        this.failedLogoIds.add(channel.id);
        channel.logoSrc = undefined;
    }

    public async onClick(item: apid.ScheduleChannleItem): Promise<void> {
        // 単局表示の場合は何もしない
        if (typeof this.$route.query.channelId !== 'undefined') {
            return;
        }

        this.streamSelectDialog.open(item);
    }
}

export default toNative(Channel);
</script>

<style lang="sass" scoped>
$board-line: 1px solid #ccc
$board-line-dark: 1px solid #888888

.channels
    .item
        min-width: var(--channel-width)
        max-width: var(--channel-width)
        width: var(--channel-width)
        min-height: var(--channel-height)
        max-height: var(--channel-height)
        height: var(--channel-height)
        font-size: var(--channel-fontsize)
        font-weight: bold
        cursor: pointer
        overflow: hidden
        white-space: nowrap
        display: flex
        flex-direction: row
        justify-content: center
        align-items: center
        background: #999
        box-sizing: border-box
        border-left: $board-line
        border-right: $board-line
        gap: 3px
        padding: 2px 3px
        line-height: 1.2

        // ロゴと局名を横 1 行に並べる。ロゴは行の高さに収まるサイズまで縮める
        .channel-logo
            flex: 0 0 auto
            min-width: 0
            max-width: 40%
            max-height: calc(var(--channel-height) - 6px)
            object-fit: contain
            border-radius: 2px

        // 局名は残り幅を使い、溢れる場合は末尾を省略する
        .channel-name
            flex: 1 1 auto
            min-width: 0
            text-align: center
            line-height: 1.2
            overflow: hidden
            text-overflow: ellipsis
            white-space: nowrap

    .item.dummy
        min-width: var(--timescale-width)
        max-width: var(--timescale-width)
        width: var(--timescale-width)
        visibility: hidden

    .item.scrollbar
        visibility: hidden

    &.isDark
        .item
            background: #393e46
            border-left: $board-line-dark
            border-right: $board-line-dark
</style>
