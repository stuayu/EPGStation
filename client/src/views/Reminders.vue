<template>
    <v-main>
        <TitleBar title="番組通知"></TitleBar>
        <v-container>
            <div class="d-flex align-center mb-3">
                <span class="text-caption text-grey">{{ reminders.length }} 件</span>
                <v-spacer></v-spacer>
                <v-btn icon variant="text" size="small" title="再読み込み" :loading="isLoading" @click="fetchData">
                    <v-icon>mdi-refresh</v-icon>
                </v-btn>
            </div>
            <v-alert v-if="isLoading === false && reminders.length === 0" type="info">番組通知はありません</v-alert>
            <v-list v-else lines="two">
                <v-list-item v-for="reminder in reminders" :key="reminder.id">
                    <v-list-item-title>{{ reminder.name }}</v-list-item-title>
                    <v-list-item-subtitle>{{ formatStartAt(reminder.startAt) }} ・ {{ reminder.minutesBefore }} 分前</v-list-item-subtitle>
                    <template #append>
                        <v-btn icon variant="text" size="small" title="通知を削除" :loading="deletingId === reminder.id" @click="remove(reminder)">
                            <v-icon>mdi-delete-outline</v-icon>
                        </v-btn>
                    </template>
                </v-list-item>
            </v-list>
        </v-container>
    </v-main>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IReminderApiModel, { ProgramReminder } from '@/model/api/reminder/IReminderApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import DateUtil from '@/util/DateUtil';
import { Component, Vue, toNative } from 'vue-facing-decorator';

@Component({ components: { TitleBar } })
class Reminders extends Vue {
    public reminders: ProgramReminder[] = [];
    public isLoading: boolean = false;
    public deletingId: number | null = null;

    private reminderApi: IReminderApiModel = container.get<IReminderApiModel>('IReminderApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public created(): void {
        void this.fetchData();
    }

    public async fetchData(): Promise<void> {
        this.isLoading = true;
        try {
            this.reminders = await this.reminderApi.getAll();
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: '番組通知の取得に失敗しました' });
            console.error(err);
        } finally {
            this.isLoading = false;
        }
    }

    public async remove(reminder: ProgramReminder): Promise<void> {
        this.deletingId = reminder.id;
        try {
            await this.reminderApi.remove(reminder.id);
            this.reminders = this.reminders.filter(item => item.id !== reminder.id);
            this.snackbarState.open({ text: `${reminder.name} の通知を削除しました` });
        } catch (err) {
            this.snackbarState.open({ color: 'error', text: '番組通知の削除に失敗しました' });
            console.error(err);
        } finally {
            this.deletingId = null;
        }
    }

    public formatStartAt(startAt: number): string {
        return DateUtil.format(DateUtil.getJaDate(new Date(startAt)), 'MM/dd hh:mm');
    }
}

export default toNative(Reminders);
</script>
