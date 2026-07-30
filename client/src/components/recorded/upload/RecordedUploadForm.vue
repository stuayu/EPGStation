<template>
    <v-card class="mx-auto" max-width="800">
        <RecordedUploadFields></RecordedUploadFields>
        <RecordedImportFields
            v-on:scanImport="scanImport"
            v-on:startImportRegistration="startImportRegistration"
            v-on:retryFailedImports="retryFailedImports"
        ></RecordedImportFields>
        <v-divider></v-divider>
        <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn v-on:click="reset" variant="text" color="error">リセット</v-btn>
            <v-btn v-on:click="upload" variant="text" color="primary">アップロード</v-btn>
        </v-card-actions>
    </v-card>
</template>

<script lang="ts">
import RecordedImportFields from '@/components/recorded/upload/RecordedImportFields.vue';
import RecordedUploadFields from '@/components/recorded/upload/RecordedUploadFields.vue';
import { Component, Vue, toNative } from 'vue-facing-decorator';

/**
 * アップロード画面のフォーム
 * 入力欄そのものは録画済み画面の取り込みダイアログと共通のコンポーネントを使う
 */
@Component({
    components: {
        RecordedUploadFields,
        RecordedImportFields,
    },
})
class RecordedUploadForm extends Vue {
    public reset(): void {
        this.$emit('reset');
    }

    public upload(): void {
        this.$emit('upload');
    }

    public scanImport(): void {
        this.$emit('scanImport');
    }

    public startImportRegistration(): void {
        this.$emit('startImportRegistration');
    }

    public retryFailedImports(): void {
        this.$emit('retryFailedImports');
    }
}

export default toNative(RecordedUploadForm);
</script>
