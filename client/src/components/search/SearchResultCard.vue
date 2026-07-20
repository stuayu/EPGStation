<template>
    <v-card class="my-2" :class="program.display.reserveType" v-on:click="openDetail">
        <v-list-item three-line>
            <div class="v-list-item-content">
                <div class="subtitle-1 font-weight-black">{{ program.display.name }}</div>
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
</style>
