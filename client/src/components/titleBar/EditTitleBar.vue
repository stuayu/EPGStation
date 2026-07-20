<template>
    <v-app-bar :color="appBarColor">
        <v-btn icon v-on:click="onClose">
            <v-icon>mdi-close</v-icon>
        </v-btn>
        <v-toolbar-title>{{ title }}</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-btn icon v-on:click="onSelectAll">
            <v-icon>mdi-select-all</v-icon>
        </v-btn>
        <v-btn icon v-on:click="onDelete">
            <v-icon>mdi-delete</v-icon>
        </v-btn>
    </v-app-bar>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { Component, Prop, Vue, Watch, toNative } from 'vue-facing-decorator';
import INavigationState from '../../model/state/navigation/INavigationState';

@Component({})
class EditTitleBar extends Vue {
    @Prop({ required: true })
    public title!: string;

    @Prop({ required: true })
    public isEditMode!: boolean;

    public navigationState: INavigationState = container.get<INavigationState>('INavigationState');

    /**
     * Prop で受け取った isEditMode は直接書き換えられないので
     * getter, setter を用意する
     */
    get editMode(): boolean {
        return this.isEditMode;
    }
    set editMode(value: boolean) {
        this.$emit('update:isEditMode', value);
    }

    /**
     * title bar の色を返す
     */
    get appBarColor(): string | null {
        return this.$vuetify.theme.global.current.dark === true ? null : 'white';
    }

    /**
     * 編集モード終了
     */
    public onClose(): void {
        this.$emit('exit');
        this.editMode = false;
    }

    /**
     * 全て選択
     */
    public onSelectAll(): void {
        this.$emit('selectall');
    }

    /**
     * 削除
     */
    public onDelete(): void {
        this.$emit('delete');
    }
}

export default toNative(EditTitleBar);
</script>
