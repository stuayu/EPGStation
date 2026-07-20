<template>
    <div>
        <v-btn v-if="recordedItem.isRecording === false && serverConfig.isEnableEncode() === true" color="teal" v-on:click="openEncodeDialog" class="ma-1">
            <v-icon start>mdi-plus-circle-outline</v-icon>
            encode
        </v-btn>
        <AddEncodeDialog v-model:isOpen="isOpenEncodeDialog" :recordedItem="recordedItem"></AddEncodeDialog>
    </div>
</template>

<script lang="ts">
import AddEncodeDialog from '@/components/encode/AddEncodeDialog.vue';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { Component, Prop, Vue } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

@Component({
    components: {
        AddEncodeDialog,
    },
})
export default class RecordedDetailEncodeButton extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    @Prop({ required: true })
    public videoFiles!: apid.VideoFile[];

    public serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    public isOpenEncodeDialog: boolean = false;

    public openEncodeDialog(): void {
        this.isOpenEncodeDialog = true;
    }
}
</script>
