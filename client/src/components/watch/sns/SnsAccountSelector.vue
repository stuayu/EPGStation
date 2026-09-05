<template>
    <div class="sns-account-selector" v-bind:class="{ 'is-compact': compact === true }">
        <v-chip
            v-for="a in accounts"
            v-bind:key="a.id"
            size="small"
        v-bind:variant="isSelected(a.id) === true ? 'flat' : 'outlined'"
        v-bind:color="isSelected(a.id) === true ? 'primary' : undefined"
        v-bind:title="a.displayName"
        v-bind:aria-label="a.displayName"
        v-on:click="toggle(a.id)"
    >
            <v-avatar start size="18">
                <v-img v-if="a.avatarUrl !== null" v-bind:src="a.avatarUrl" referrerpolicy="no-referrer"></v-img>
                <v-icon v-else size="14">{{ a.provider === 'bluesky' ? 'mdi-butterfly-outline' : 'mdi-account-circle' }}</v-icon>
            </v-avatar>
            <span v-if="compact === false" class="chip-label">{{ a.displayName }}</span>
            <v-icon
                v-if="a.needsReauth === true"
                size="12"
                color="error"
                class="ml-1"
                v-bind:title="a.needsReauthReason === 'permission' ? '権限が不足しています。設定 > SNS 連携から再連携してください' : '再連携が必要です'"
            >mdi-alert-circle</v-icon>
        </v-chip>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue, toNative } from 'vue-facing-decorator';
import * as apid from '../../../../../api';

/**
 * SNS 投稿パネルの投稿先アカウント選択 (複数選択可)
 */
@Component({})
class SnsAccountSelector extends Vue {
    @Prop({ required: true })
    public accounts!: apid.SnsAccountItem[];

    @Prop({ required: true })
    public modelValue!: apid.SnsAccountId[];

    @Prop({ required: false, default: false })
    public compact!: boolean;

    public isSelected(accountId: apid.SnsAccountId): boolean {
        return this.modelValue.includes(accountId);
    }

    public toggle(accountId: apid.SnsAccountId): void {
        if (this.isSelected(accountId) === true) {
            this.$emit(
                'update:modelValue',
                this.modelValue.filter(id => id !== accountId),
            );
        } else {
            this.$emit('update:modelValue', [...this.modelValue, accountId]);
        }
    }
}

export default toNative(SnsAccountSelector);
</script>

<style lang="sass" scoped>
.sns-account-selector
    display: flex
    flex-wrap: wrap
    gap: 6px

    &.is-compact
        flex-wrap: nowrap

        .v-chip
            padding-inline: 4px

    .chip-label
        max-width: 140px
        overflow: hidden
        text-overflow: ellipsis
        white-space: nowrap
</style>
