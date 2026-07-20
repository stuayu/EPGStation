<template>
    <div>
        <v-menu bottom left>
            <template v-slot:activator="{ props }">
                <v-btn icon class="menu-button" v-bind="props">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="onRecorded">
                    <template #prepend class="mr-3">
                        <v-icon>mdi-filmstrip-box-multiple</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>recorded</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="onEdit">
                    <template #prepend class="mr-3">
                        <v-icon>mdi-pencil</v-icon>
                    </template>
                    <div class="v-list-item-content">
                        <v-list-item-title>edit</v-list-item-title>
                    </div>
                </v-list-item>
                <v-list-item v-on:click="openDeleteDialog">
                    <template #prepend class="mr-3">
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
import { Component, Prop, Vue } from 'vue-facing-decorator';

@Component({
    components: {
        RuleDeleteDialog,
    },
})
export default class RuleItemMenu extends Vue {
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

    public async openDeleteDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenDeleteDialog = true;
    }
}
</script>
