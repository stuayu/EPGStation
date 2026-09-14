<template>
    <v-app-bar :color="appBarColor">
        <v-app-bar-nav-icon @click.stop="toggle"></v-app-bar-nav-icon>
        <v-toolbar-title
            class="title-content app-bar-title"
            v-bind:class="{ clickable: !!needsTitleClickEvent === true }"
            v-on:click="onTitle"
        >
            {{ title }}
        </v-toolbar-title>
        <v-chip v-if="isOffline" class="offline-chip mx-1" size="small" color="warning" variant="tonal">オフライン</v-chip>
        <v-spacer></v-spacer>
        <slot name="menu"></slot>
        <template v-if="$slots.extension" v-slot:extension>
            <slot name="extension"></slot>
        </template>
    </v-app-bar>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import INavigationState from '../../model/state/navigation/INavigationState';
import ThemeColorUtil from '@/util/ThemeColorUtil';
import { isOfflineStartup } from '@/util/OfflineStartup';
import { shouldShowOfflineIndicator } from '../../../../src/util/OfflineUxUtil';

@Component({})
class TitleBar extends Vue {
    @Prop({ required: true })
    public title!: string;

    @Prop({ required: false })
    public needsTitleClickEvent: boolean | undefined;

    public navigationState: INavigationState = container.get<INavigationState>('INavigationState');
    public isOffline = shouldShowOfflineIndicator(navigator.onLine, isOfflineStartup());

    /**
     * title bar の色を返す
     * ダークテーマでは従来どおり既定の暗い背景のままにする (色を敷くと暗所での眩しさが増すため)
     */
    get appBarColor(): string | undefined {
        return this.$vuetify.theme.global.current.dark === true ? undefined : ThemeColorUtil.COLOR_NAME;
    }

    public onTitle(): void {
        this.$emit('click');
    }

    public toggle(): void {
        this.navigationState.toggle();
    }

    public created(): void {
        window.addEventListener('offline', this.onOffline);
        window.addEventListener('online', this.onOnline);
    }

    public beforeUnmount(): void {
        window.removeEventListener('offline', this.onOffline);
        window.removeEventListener('online', this.onOnline);
    }

    public onOffline(): void { this.isOffline = true; }
    public onOnline(): void { this.isOffline = false; }

    @Watch('title', { immediate: true })
    private onTitleChanged(newTitle: string, old: string): void {
        document.title = newTitle;
    }
}

export default toNative(TitleBar);
</script>

<style lang="sass">
.title-content
    cursor: default
    user-select: none

    &.clickable
        cursor: pointer

.offline-chip
    flex: 0 0 auto
</style>
