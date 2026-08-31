<template>
    <v-list-item class="playback-quality-item" role="option" :aria-selected="selected" @click="select">
        <template #prepend>
            <v-radio :model-value="selected" :value="true" tabindex="-1" aria-label="選択中"></v-radio>
        </template>
        <v-list-item-title>{{ label.name }}</v-list-item-title>
        <v-list-item-subtitle>{{ label.summary }}</v-list-item-subtitle>
        <v-list-item-subtitle v-if="showDetail === true || (profile.id === 'auto' && selected === true)" class="detail">{{ label.detail }}</v-list-item-subtitle>
        <template #append>
            <div class="badges">
                <v-chip v-for="badge in label.badges" :key="badge" size="x-small" color="primary" variant="tonal">{{ badge }}</v-chip>
            </div>
        </template>
    </v-list-item>
</template>

<script lang="ts">
import * as apid from '../../../../../api';
import { getPlaybackLabel, PlaybackLabel } from '@/util/PlaybackLabelUtil';
import { Component, Emit, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({})
class PlaybackQualityItem extends Vue {
    @Prop({ required: true }) public profile!: apid.PlaybackProfile;
    @Prop({ required: true }) public selected!: boolean;
    @Prop({ default: false }) public showDetail!: boolean;

    get label(): PlaybackLabel {
        return getPlaybackLabel(this.profile);
    }

    @Emit('select')
    public select(): string {
        return this.profile.id;
    }
}

export default toNative(PlaybackQualityItem);
</script>

<style scoped>
.playback-quality-item { min-height: 44px; }
.badges { display: flex; gap: 4px; max-width: 120px; }
.detail { white-space: normal; }
</style>
