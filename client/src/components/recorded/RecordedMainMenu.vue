<template>
    <div class="recorded-main-menu">
        <v-menu class="menu" v-model="isOpened" location="bottom start">
            <template v-slot:activator="{ props }">
                <v-btn icon size="small" class="menu-button" v-bind="props">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="edit" slim>
                    <template #prepend>
                        <v-icon>mdi-pencil</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>編集</v-list-item-title>
                    </div>
                </v-list-item>

                <v-list-item v-on:click="cleanup" slim>
                    <template #prepend>
                        <v-icon>mdi-delete</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>クリーンアップ</v-list-item-title>
                    </div>
                </v-list-item>

                <v-list-item v-on:click="upload" slim>
                    <template #prepend>
                        <v-icon>mdi-upload</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>アップロード</v-list-item-title>
                    </div>
                </v-list-item>
            </v-list>
        </v-menu>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import Util from '@/util/Util';
import { Component, Vue, toNative } from 'vue-facing-decorator';

@Component({})
class RecordedMainMenu extends Vue {
    public isOpened: boolean = false;

    public edit(): void {
        this.$emit('edit');
    }

    public cleanup(): void {
        this.$emit('cleanup');
    }

    public async upload(): Promise<void> {
        await Util.sleep(200);
        await Util.move(this.$router, {
            path: '/recorded/upload',
        });
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }
}

export default toNative(RecordedMainMenu);
</script>
