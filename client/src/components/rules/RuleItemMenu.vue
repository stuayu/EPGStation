<template>
    <div>
        <v-menu location="bottom start">
            <template v-slot:activator="{ props }">
                <v-btn icon variant="text" size="small" class="menu-button" v-bind="props">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list class="menu-card">
                <v-list-item v-on:click="onRecorded" slim>
                    <template #prepend>
                        <v-icon>mdi-filmstrip-box-multiple</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>recorded</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="onEdit" slim>
                    <template #prepend>
                        <v-icon>mdi-pencil</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>edit</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="onDuplicate" slim>
                    <template #prepend><v-icon>mdi-content-duplicate</v-icon></template>
                    <v-list-item-title>複製</v-list-item-title>
                </v-list-item>
                <v-list-item v-on:click="openDeleteDialog" slim>
                    <template #prepend>
                        <v-icon>mdi-delete</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>delete</v-list-item-title>
                    </div>
                </v-list-item>
            </v-list>
        </v-menu>
        <RuleDeleteDialog v-model:isOpen="isOpenDeleteDialog" :ruleItem="ruleItem"></RuleDeleteDialog>
    </div>
</template>

<script lang="ts">
import RuleDeleteDialog from '@/components/rules/RuleDeleteDialog.vue';
import { RuleStateData } from '@/model/state/rule/IRuleState';
import Util from '@/util/Util';
import container from '@/model/ModelContainer';
import IRuleApiModel from '@/model/api/rule/IRuleApiModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';

@Component({
    components: {
        RuleDeleteDialog,
    },
})
class RuleItemMenu extends Vue {
    private ruleApi: IRuleApiModel = container.get<IRuleApiModel>('IRuleApiModel');
    private snackbar: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    @Prop({ required: true })
    public ruleItem!: RuleStateData;

    public isOpenDeleteDialog: boolean = false;

    public onRecorded(): void {
        Util.move(this.$router, {
            path: '/recorded',
            query: {
                ruleId: this.ruleItem.display.id.toString(10),
            },
        });
    }

    public onEdit(): void {
        Util.move(this.$router, {
            path: '/search',
            query: {
                rule: this.ruleItem.display.id.toString(10),
            },
        });
    }

    public async onDuplicate(): Promise<void> {
        try {
            const source = await this.ruleApi.get(this.ruleItem.display.id);
            const duplicate = {
                isTimeSpecification: source.isTimeSpecification,
                searchOption: source.searchOption,
                reserveOption: { ...source.reserveOption, enable: false },
                ...(source.saveOption !== undefined ? { saveOption: source.saveOption } : {}),
                ...(source.encodeOption !== undefined ? { encodeOption: source.encodeOption } : {}),
            };
            const id = await this.ruleApi.add(duplicate);
            Util.move(this.$router, { path: '/search', query: { rule: id.toString(10) } });
        } catch (err) {
            this.snackbar.open({ color: 'error', text: 'ルールの複製に失敗しました' });
            console.error(err);
        }
    }

    public async openDeleteDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenDeleteDialog = true;
    }
}

export default toNative(RuleItemMenu);
</script>
