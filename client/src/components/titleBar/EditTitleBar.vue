<template>
    <v-app-bar :color="appBarColor">
        <v-btn icon variant="text" v-on:click="onClose">
            <v-icon>mdi-close</v-icon>
        </v-btn>
        <v-toolbar-title>{{ title }}</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-btn icon variant="text" v-on:click="onSelectAll">
            <v-icon>mdi-select-all</v-icon>
        </v-btn>
        <v-btn v-if="showEncode === true" icon variant="text" title="エンコード" v-on:click="onEncode">
            <v-icon>mdi-cog-play</v-icon>
        </v-btn>
        <v-btn icon variant="text" v-on:click="onDelete">
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

    /**
     * エンコードボタンを表示するか (録画済み画面のみ true)
     */
    @Prop({ required: false, default: false })
    public showEncode!: boolean;

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
    get appBarColor(): string | undefined {
        return this.$vuetify.theme.global.current.dark === true ? undefined : 'white';
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
     * エンコード
     */
    public onEncode(): void {
        this.$emit('encode');
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
