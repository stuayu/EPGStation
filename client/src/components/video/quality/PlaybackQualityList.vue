<template>
    <v-list role="listbox" class="playback-quality-list" lines="three">
        <PlaybackQualityItem
            v-for="profile in primaryProfiles"
            :key="profile.id"
            :profile="profile"
            :selected="profile.id === selectedId"
            :show-detail="showDetail"
            @select="select"
        ></PlaybackQualityItem>
        <v-list-item v-if="otherProfiles.length > 0" min-height="44" @click="showOther = !showOther">
            <v-list-item-title>その他の画質</v-list-item-title>
            <template #append>{{ showOther ? '▲' : '▼' }}</template>
        </v-list-item>
        <PlaybackQualityItem
            v-for="profile in (showOther ? otherProfiles : [])"
            :key="profile.id"
            :profile="profile"
            :selected="profile.id === selectedId"
            :show-detail="showDetail"
            @select="select"
        ></PlaybackQualityItem>
        <v-list-item v-if="visibleProfiles.length === 0" min-height="44">利用可能な画質がありません</v-list-item>
    </v-list>
</template>

<script lang="ts">
import * as apid from '../../../../../api';
import { Component, Emit, Prop, Vue, toNative } from 'vue-facing-decorator';
import PlaybackQualityItem from './PlaybackQualityItem.vue';

@Component({ components: { PlaybackQualityItem } })
class PlaybackQualityList extends Vue {
    @Prop({ required: true }) public profiles!: apid.PlaybackProfile[];
    @Prop({ default: 'auto' }) public selectedId!: string;
    @Prop({ default: false }) public showDetail!: boolean;
    public showOther = false;

    get visibleProfiles(): apid.PlaybackProfile[] {
        return this.profiles.filter(profile => profile.available === true);
    }
    get primaryProfiles(): apid.PlaybackProfile[] {
        return this.visibleProfiles.filter(profile => profile.builtin === true);
    }
    get otherProfiles(): apid.PlaybackProfile[] {
        return this.visibleProfiles.filter(profile => profile.builtin !== true);
    }

    @Emit('select')
    public select(id: string): string {
        return id;
    }
}

export default toNative(PlaybackQualityList);
</script>

<style scoped>
.playback-quality-list { padding: 0; }
</style>
