<template>
    <v-card class="mb-4">
        <v-card-title>録画プリセット</v-card-title>
        <v-card-text>
            <div v-for="item in items" :key="item.id" class="d-flex flex-wrap align-center ga-2 mb-2">
                <span class="text-body-1">{{ item.name }}</span>
                <v-chip v-if="item.isDefault" size="small" color="primary">既定</v-chip>
                <v-spacer></v-spacer>
                <v-btn size="small" variant="outlined" @click="edit(item)">編集</v-btn>
                <v-btn size="small" variant="outlined" color="error" @click="remove(item.id)">削除</v-btn>
            </div>
            <v-btn color="primary" variant="outlined" @click="startAdd">追加</v-btn>
        </v-card-text>
        <v-dialog v-model="isOpen" :fullscreen="$vuetify.display.smAndDown" max-width="760">
            <v-card>
                <v-card-title>{{ editingId === null ? '録画プリセットを追加' : '録画プリセットを編集' }}</v-card-title>
                <v-card-text class="preset-dialog-body">
                    <v-text-field v-model="name" label="名前"></v-text-field>
                    <v-checkbox v-model="isDefault" label="既定のプリセット"></v-checkbox>
                    <div class="d-flex flex-wrap ga-2">
                        <v-text-field v-model="settings.parentDirectoryName" label="録画先" clearable></v-text-field>
                        <v-text-field v-model="settings.directory" label="サブディレクトリ" clearable></v-text-field>
                        <v-text-field v-model="settings.recordedFormat" label="ファイル名形式" clearable></v-text-field>
                    </div>
                    <div v-for="index in [1, 2, 3]" :key="index" class="d-flex flex-wrap ga-2">
                        <v-text-field :model-value="getMode(index)" :label="`エンコード ${index}`" clearable @update:model-value="setMode(index, $event)"></v-text-field>
                        <v-text-field
                            :model-value="getEncodeDirectory(index)"
                            :label="`エンコード保存先 ${index}`"
                            clearable
                            @update:model-value="setEncodeDirectory(index, $event)"
                        ></v-text-field>
                        <v-text-field v-model="settings[encodeSubDirectoryKey(index)]" :label="`エンコードサブディレクトリ ${index}`" clearable></v-text-field>
                    </div>
                    <v-checkbox v-model="settings.isDeleteOriginalAfterEncode" label="エンコード後に元ファイルを削除"></v-checkbox>
                    <div class="d-flex flex-wrap ga-2">
                        <v-select v-model.number="settings.priority" :items="priorityItems" label="優先度"></v-select>
                        <v-select v-model="settings.conflictPolicy" :items="conflictItems" label="競合時の扱い"></v-select>
                        <v-text-field v-model.number="settings.startMarginSec" label="開始マージン (秒)" type="number" clearable></v-text-field>
                        <v-text-field v-model.number="settings.endMarginSec" label="終了マージン (秒)" type="number" clearable></v-text-field>
                    </div>
                    <v-checkbox v-model="settings.allowEndLack" label="末尾欠けを許可"></v-checkbox>
                    <v-text-field v-model="tagIds" label="タグ ID (カンマ区切り)" hint="録画完了後に付与するタグの ID" persistent-hint></v-text-field>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" @click="isOpen = false">キャンセル</v-btn>
                    <v-btn color="primary" :disabled="name.trim() === ''" @click="save">保存</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-card>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { RecordingPresetItem, RecordingPresetSettings } from '@/model/api/recordingPreset/IRecordingPresetApiModel';
import IRecordingPresetState, { createEmptyRecordingPresetSettings } from '@/model/state/recordingPreset/IRecordingPresetState';
import { Component, Vue, toNative } from 'vue-facing-decorator';

@Component
class RecordingPresetManager extends Vue {
    private state: IRecordingPresetState = container.get<IRecordingPresetState>('IRecordingPresetState');
    public items: RecordingPresetItem[] = [];
    public isOpen = false;
    public editingId: number | null = null;
    public name = '';
    public isDefault = false;
    public settings: RecordingPresetSettings = createEmptyRecordingPresetSettings();
    public tagIds = '';
    public priorityItems = [1, 2, 3, 4, 5].map(value => ({ title: String(value), value }));
    public conflictItems = ['STRICT', 'ALLOW_END_LACK', 'ALLOW_HEAD_LACK', 'ALLOW_PARTIAL', 'PREEMPT_LOWER_PRIORITY'];

    public async created(): Promise<void> {
        await this.refresh();
    }
    private async refresh(): Promise<void> {
        await this.state.fetch();
        this.items = this.state.getItems();
    }
    public startAdd(): void {
        this.editingId = null;
        this.name = '';
        this.isDefault = false;
        this.settings = createEmptyRecordingPresetSettings();
        this.tagIds = '';
        this.isOpen = true;
    }
    public edit(item: RecordingPresetItem): void {
        this.editingId = item.id;
        this.name = item.name;
        this.isDefault = item.isDefault;
        this.settings = { ...createEmptyRecordingPresetSettings(), ...item.settings };
        this.tagIds = this.settings.tags.join(',');
        this.isOpen = true;
    }
    public modeKey(index: number): keyof RecordingPresetSettings {
        return `mode${index}` as keyof RecordingPresetSettings;
    }
    public getMode(index: number): string | null {
        return this.settings[this.modeKey(index)] as string | null;
    }
    public setMode(index: number, value: string | null): void {
        (this.settings as any)[this.modeKey(index)] = value;
    }
    public encodeDirectoryKey(index: number): keyof RecordingPresetSettings {
        return `encodeParentDirectoryName${index}` as keyof RecordingPresetSettings;
    }
    public getEncodeDirectory(index: number): string | null {
        return this.settings[this.encodeDirectoryKey(index)] as string | null;
    }
    public setEncodeDirectory(index: number, value: string | null): void {
        (this.settings as any)[this.encodeDirectoryKey(index)] = value;
    }
    public encodeSubDirectoryKey(index: number): keyof RecordingPresetSettings {
        return `directory${index}` as keyof RecordingPresetSettings;
    }
    public async save(): Promise<void> {
        this.settings.tags = this.tagIds
            .split(',')
            .map(tag => Number(tag.trim()))
            .filter(tag => Number.isInteger(tag) && tag > 0);
        const input = { name: this.name.trim(), isDefault: this.isDefault, settings: this.settings };
        if (this.editingId === null) await this.state.add(input);
        else await this.state.update(this.editingId, input);
        this.items = this.state.getItems();
        this.isOpen = false;
    }
    public async remove(id: number): Promise<void> {
        await this.state.delete(id);
        this.items = this.state.getItems();
    }
}

export default toNative(RecordingPresetManager);
</script>

<style lang="sass" scoped>
.preset-dialog-body
    max-height: 70vh
    overflow-y: auto
</style>
