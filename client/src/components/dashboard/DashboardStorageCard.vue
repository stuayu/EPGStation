<template>
    <DashboardItem title="ストレージ使用状況">
        <template v-slot:items>
            <div class="px-2 pb-2 dashboard-storage-card">
                <v-progress-circular v-if="isLoading === true" indeterminate size="24" class="ma-2"></v-progress-circular>
                <div v-else-if="items.length === 0" class="pa-2 text-caption">情報を取得できません</div>
                <div v-for="item in items" :key="item.name" class="py-2">
                    <div class="d-flex justify-space-between text-caption">
                        <span>{{ item.name }}</span>
                        <span>{{ usedPercent(item) }}%</span>
                    </div>
                    <v-progress-linear :model-value="usedPercent(item)" height="6" :color="usedColor(item)" rounded></v-progress-linear>
                    <div class="text-caption text-right text-medium-emphasis">{{ formatSize(item.used) }} / {{ formatSize(item.total) }}</div>
                </div>
            </div>
        </template>
    </DashboardItem>
</template>

<script lang="ts">
import DashboardItem from '@/components/dashboard/DashboardItem.vue';
import container from '@/model/ModelContainer';
import IStorageApiModel from '@/model/api/storage/IStorageApiModel';
import Util from '@/util/Util';
import { Component, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        DashboardItem,
    },
})
class DashboardStorageCard extends Vue {
    public items: apid.StorageItem[] = [];
    public isLoading: boolean = true;

    private storageApiModel: IStorageApiModel = container.get<IStorageApiModel>('IStorageApiModel');

    public async created(): Promise<void> {
        await this.fetchData();
    }

    /**
     * ストレージ使用状況を取得する
     */
    public async fetchData(): Promise<void> {
        this.isLoading = true;
        try {
            const info = await this.storageApiModel.getInfo();
            this.items = info.items;
        } catch (err) {
            console.error(err);
            this.items = [];
        } finally {
            this.isLoading = false;
        }
    }

    public usedPercent(item: apid.StorageItem): number {
        if (item.total <= 0) return 0;

        return Math.min(100, Math.round((item.used / item.total) * 100));
    }

    public usedColor(item: apid.StorageItem): string {
        const percent = this.usedPercent(item);
        if (percent >= 90) return 'error';
        if (percent >= 75) return 'warning';

        return 'primary';
    }

    public formatSize(size: number): string {
        return Util.getFileSizeStr(size);
    }
}

export default toNative(DashboardStorageCard);
</script>

<style lang="sass" scoped>
.dashboard-storage-card
    width: 100%
</style>
