<template>
    <v-card class="my-2" :class="[program.display.reserveType, { 'is-dark': isDark }]" v-on:click="openDetail">
        <v-list-item three-line>
            <div class="v-list-item-content">
                <div class="text-subtitle-1 font-weight-black">{{ program.display.name }}</div>
                <div class="text-subtitle-2 font-weight-light">{{ program.display.channelName }}</div>
                <div class="text-caption font-weight-light mb-2">
                    {{ program.display.day }}({{ program.display.dow }}) {{ program.display.startTime }} ~ {{ program.display.endTime }} ({{ program.display.duration }}分)
                </div>
                <div class="text-body-2 text-grey-darken-2">{{ program.display.description }}</div>
            </div>
        </v-list-item>
    </v-card>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IGuideProgramDialogState from '@/model/state/guide/IGuideProgramDialogState';
import { SearchResultItem } from '@/model/state/search/ISearchState';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({})
class SearchResultCard extends Vue {
    // 番組表 (Guide.vue) と同じ衝突・スキップ色をダークモードでも使うための判定
    get isDark(): boolean {
        return this.$vuetify.theme.global.current.dark;
    }

    @Prop({ required: true })
    public program!: SearchResultItem;

    private dialogState: IGuideProgramDialogState = container.get<IGuideProgramDialogState>('IGuideProgramDialogState');

    public openDetail(): void {
        this.dialogState.open({
            channel: this.program.channel,
            program: this.program.program,
            reserve: this.program.reserve,
        });
    }
}

export default toNative(SearchResultCard);
</script>

<style lang="sass" scoped>

.reserve
    border: 4px solid red
.conflict
    background-color: #fffd6b
    border: 4px solid red
    border-style: dashed
.skip
    background-color: #aaa
.overlap
    text-decoration: line-through
    background-color: #aaa
    color: black

// 番組表 (Guide.vue) と同じダークモード配色
&.is-dark
    &.conflict
        background-color: #f6c90e
    &.skip
        background-color: #717171
    &.overlap
        background-color: #717171
</style>
