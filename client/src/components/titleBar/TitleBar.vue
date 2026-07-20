<template>
    <v-app-bar :color="appBarColor">
        <v-app-bar-nav-icon @click.stop="toggle"></v-app-bar-nav-icon>
        <v-toolbar-title class="title-content" v-bind:class="{ clickable: !!needsTitleClickEvent === true }" v-on:click="onTitle">
            {{ title }}
        </v-toolbar-title>
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

@Component({})
class TitleBar extends Vue {
    @Prop({ required: true })
    public title!: string;

    @Prop({ required: false })
    public needsTitleClickEvent: boolean | undefined;

    public navigationState: INavigationState = container.get<INavigationState>('INavigationState');

    /**
     * title bar の色を返す
     */
    get appBarColor(): string | undefined {
        return this.$vuetify.theme.global.current.dark === true ? undefined : 'indigo';
    }

    public onTitle(): void {
        this.$emit('click');
    }

    public toggle(): void {
        this.navigationState.toggle();
    }

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
</style>
