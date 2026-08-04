<template>
    <div class="watch-side-bar">
        <div class="items">
            <v-btn v-for="(item, index) in items" :key="index" icon variant="text" size="small" class="item" :title="item.title" v-on:click="route(item)">
                <v-icon>{{ item.icon }}</v-icon>
            </v-btn>
        </div>
        <v-spacer></v-spacer>
        <div class="items">
            <v-btn icon variant="text" size="small" class="item" title="設定" v-on:click="gotoSetting">
                <v-icon>mdi-cog</v-icon>
            </v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import INavigationState, { NavigationItem } from '@/model/state/navigation/INavigationState';
import Util from '@/util/Util';
import { Component, Vue, toNative } from 'vue-facing-decorator';

/**
 * 視聴画面の左端に置くアイコンだけのナビゲーション
 * 表示する項目はグローバルのナビゲーション (INavigationState) と共有する
 */
@Component({})
class WatchSideBar extends Vue {
    private navigationState: INavigationState = container.get<INavigationState>('INavigationState');

    /**
     * リンク先を持つ項目だけをアイコンとして並べる
     */
    get items(): NavigationItem[] {
        return this.navigationState.getItems().filter(item => {
            return item.herf !== null;
        });
    }

    public async route(item: NavigationItem): Promise<void> {
        if (item.herf === null) {
            return;
        }

        await Util.move(this.$router, item.herf);
    }

    public async gotoSetting(): Promise<void> {
        await Util.move(this.$router, { path: '/settings' });
    }
}

export default toNative(WatchSideBar);
</script>

<style lang="sass" scoped>
.watch-side-bar
    display: flex
    flex-direction: column
    align-items: center
    flex-shrink: 0
    width: 56px
    padding: 8px 0
    background: var(--watch-surface-subtle)

    .items
        display: flex
        flex-direction: column
        align-items: center
        gap: 4px

    .item
        color: var(--watch-fg-muted)

        &:hover
            color: var(--watch-fg-strong)

    // 画面が狭いときは上部の横並びツールバーとして出す
    @media screen and (max-width: 1024px)
        flex-direction: row
        width: 100%
        padding: 4px 8px
        overflow-x: auto

        .items
            flex-direction: row
</style>
