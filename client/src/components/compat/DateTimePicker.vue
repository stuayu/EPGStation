<template><v-text-field :model-value="inputValue" :label="label" :disabled="disabled" :style="{ width }" type="datetime-local" clearable @update:model-value="updateValue" @click:clear="clearValue" /></template>
<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(defineProps<{ modelValue: Date | null; label?: string; disabled?: boolean; width?: string }>(), { label: '', disabled: false, width: '290px' });
const emit = defineEmits<{ (event: 'update:modelValue', value: Date | null): void }>();
const inputValue = computed(() => props.modelValue === null ? '' : new Date(props.modelValue.getTime() - props.modelValue.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
const updateValue = (value: string | null): void => emit('update:modelValue', value ? new Date(value) : null);
const clearValue = (): void => emit('update:modelValue', null);
</script>
