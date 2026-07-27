<template>
    <v-dialog v-model="dialogModel" max-width="600">
        <v-card>
            <v-card-title>タグ管理</v-card-title>
            <v-card-text>
                <div class="text-subtitle-2 mb-2">新規タグ</div>
                <v-row dense>
                    <v-col cols="5">
                        <v-text-field v-model="newName" label="タグ名" density="compact" hide-details></v-text-field>
                    </v-col>
                    <v-col cols="3">
                        <v-text-field v-model="newColor" label="色" density="compact" hide-details placeholder="#FF0000"></v-text-field>
                    </v-col>
                    <v-col cols="4">
                        <v-select v-model="newParentId" :items="parentSelectItems" item-title="title" label="親タグ" density="compact" clearable hide-details></v-select>
                    </v-col>
                </v-row>
                <v-btn class="mt-2" size="small" color="primary" variant="outlined" :disabled="newName.length === 0" :loading="adding" @click="addTag"
                    >追加</v-btn
                >

                <v-divider class="my-4"></v-divider>
                <div class="text-subtitle-2 mb-2">タグ一覧 (階層表示)</div>
                <v-alert v-if="treeItems.length === 0" type="info">タグはありません</v-alert>
                <v-list v-else density="compact">
                    <template v-for="item in treeItems" :key="item.tag.id">
                        <v-list-item v-if="editingId === item.tag.id">
                            <v-row dense align="center">
                                <v-col cols="4">
                                    <v-text-field v-model="editName" density="compact" hide-details></v-text-field>
                                </v-col>
                                <v-col cols="3">
                                    <v-text-field v-model="editColor" density="compact" hide-details></v-text-field>
                                </v-col>
                                <v-col cols="3">
                                    <v-select
                                        v-model="editParentId"
                                        :items="parentSelectItemsExcluding(item.tag.id)"
                                        item-title="title"
                                        density="compact"
                                        clearable
                                        hide-details
                                    ></v-select>
                                </v-col>
                                <v-col cols="2">
                                    <v-btn size="small" variant="text" color="primary" :loading="saving" @click="saveEdit(item.tag.id)">保存</v-btn>
                                    <v-btn size="small" variant="text" @click="cancelEdit">取消</v-btn>
                                </v-col>
                            </v-row>
                        </v-list-item>
                        <v-list-item v-else>
                            <v-list-item-title>
                                <span :style="{ paddingLeft: `${item.depth * 16}px` }">
                                    <span v-if="item.depth > 0">└ </span>
                                    <v-icon size="small" :color="item.tag.color || undefined">mdi-tag</v-icon>
                                    {{ item.tag.name }}
                                </span>
                            </v-list-item-title>
                            <template v-slot:append>
                                <v-btn size="small" variant="text" @click="startEdit(item.tag)">編集</v-btn>
                                <v-btn size="small" variant="text" color="error" @click="removeTag(item.tag.id)">削除</v-btn>
                            </template>
                        </v-list-item>
                    </template>
                </v-list>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn variant="text" @click="close">閉じる</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedTagApiModel from '@/model/api/recordedTag/IRecordedTagApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, Prop, Watch, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../api';

interface TreeItem {
    tag: apid.RecordedTag;
    depth: number;
}

@Component({})
class TagManageDialog extends Vue {
    @Prop({ required: true }) public isOpen!: boolean;

    private tagApiModel: IRecordedTagApiModel = container.get<IRecordedTagApiModel>('IRecordedTagApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public tags: apid.RecordedTag[] = [];
    public treeItems: TreeItem[] = [];

    public newName: string = '';
    public newColor: string = '';
    public newParentId: number | null = null;
    public adding: boolean = false;

    public editingId: number | null = null;
    public editName: string = '';
    public editColor: string = '';
    public editParentId: number | null = null;
    public saving: boolean = false;

    /**
     * Prop で受け取った isOpen を直接は書き換えられないので getter, setter を用意する
     */
    get dialogModel(): boolean {
        return this.isOpen;
    }
    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    @Watch('isOpen', { immediate: true })
    public onChangeIsOpen(newValue: boolean): void {
        if (newValue === true) {
            this.load().catch(err => {
                console.error(err);
            });
        }
    }

    public close(): void {
        this.dialogModel = false;
    }

    public get parentSelectItems(): { title: string; value: number }[] {
        return this.parentSelectItemsExcluding(null);
    }

    public parentSelectItemsExcluding(excludeId: number | null): { title: string; value: number }[] {
        // 自分自身とその子孫を親候補から除外し (循環参照防止)、サーバー側の RecordedTagCircularParent と重複してガードする
        const descendants = new Set<number>();
        if (excludeId !== null) {
            const collect = (id: number): void => {
                descendants.add(id);
                for (const t of this.tags) {
                    if (t.parentId === id) collect(t.id);
                }
            };
            collect(excludeId);
        }
        return this.treeItems
            .filter(i => !descendants.has(i.tag.id))
            .map(i => ({ title: `${'　'.repeat(i.depth)}${i.tag.name}`, value: i.tag.id }));
    }

    private async load(): Promise<void> {
        const result = await this.tagApiModel.gets();
        this.tags = result.tags;
        this.treeItems = this.buildTree(result.tags);
    }

    private buildTree(tags: apid.RecordedTag[]): TreeItem[] {
        const byParent = new Map<number | null, apid.RecordedTag[]>();
        for (const tag of tags) {
            const parentId = tag.parentId ?? null;
            const list = byParent.get(parentId) ?? [];
            list.push(tag);
            byParent.set(parentId, list);
        }
        const items: TreeItem[] = [];
        const append = (parentId: number | null, depth: number): void => {
            for (const tag of byParent.get(parentId) ?? []) {
                items.push({ tag, depth });
                append(tag.id, depth + 1);
            }
        };
        append(null, 0);
        return items;
    }

    public async addTag(): Promise<void> {
        this.adding = true;
        try {
            await this.tagApiModel.add(this.newName, this.newColor, this.newParentId);
            this.newName = '';
            this.newColor = '';
            this.newParentId = null;
            await this.load();
            this.snackbarState.open({ color: 'success', text: 'タグを追加しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'タグの追加に失敗しました' });
        } finally {
            this.adding = false;
        }
    }

    public startEdit(tag: apid.RecordedTag): void {
        this.editingId = tag.id;
        this.editName = tag.name;
        this.editColor = tag.color;
        this.editParentId = tag.parentId ?? null;
    }

    public cancelEdit(): void {
        this.editingId = null;
    }

    public async saveEdit(tagId: number): Promise<void> {
        this.saving = true;
        try {
            await this.tagApiModel.update(tagId, this.editName, this.editColor, this.editParentId);
            this.editingId = null;
            await this.load();
            this.snackbarState.open({ color: 'success', text: 'タグを更新しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'タグの更新に失敗しました (親子関係が循環していないかご確認ください)' });
        } finally {
            this.saving = false;
        }
    }

    public async removeTag(tagId: number): Promise<void> {
        try {
            await this.tagApiModel.delete(tagId);
            await this.load();
            this.snackbarState.open({ color: 'success', text: 'タグを削除しました' });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({ color: 'error', text: 'タグの削除に失敗しました' });
        }
    }
}
export default toNative(TagManageDialog);
</script>
