<script lang="ts" setup>
import { Reactive } from 'vue';
import { ControllerPageState } from '../../pages/Controller.vue';
import CoyoteLocalConnectPanel from '../../components/partials/CoyoteLocalConnectPanel.vue';

defineOptions({
  name: 'StrengthSettings',
});

const props = defineProps<{
  state: any;
}>();

let parentState: Reactive<ControllerPageState>;
watch(() => props.state, (value) => {
  parentState = value;
}, { immediate: true });

const channelEntries = computed(() => ([
  { id: 'a', title: 'A通道', accent: 'text-red-500', description: '主通道，默认启用。' },
  { id: 'b', title: 'B通道', accent: 'text-sky-500', description: '可独立设置强度、随机逻辑和开火限制。' },
]) as const);
</script>

<template>
  <div class="w-full flex flex-col gap-6">
    <div v-for="channel in channelEntries" :key="channel.id" class="channel-section">
      <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4">
        <div>
          <div class="flex items-center gap-3">
            <h2 class="text-xl font-bold" :class="channel.accent">{{ channel.title }}</h2>
            <Tag v-if="channel.id === 'a'" severity="secondary" value="固定启用" />
          </div>
          <p class="opacity-70 text-sm mt-1">{{ channel.description }}</p>
        </div>
        <ToggleButton
          v-if="channel.id === 'b'"
          v-model="parentState.channels.b.enabled"
          onIcon="pi pi-circle-on"
          onLabel="B通道已启用"
          offIcon="pi pi-circle-off"
          offLabel="B通道已禁用"
        />
      </div>

      <div class="channel-grid" :class="{ 'channel-disabled': channel.id === 'b' && !parentState.channels.b.enabled }">
        <div class="field-block field-wide">
          <label class="font-semibold">强度变化频率</label>
          <div class="flex flex-col gap-3">
            <Slider class="w-full" v-model="parentState.channels[channel.id].randomFreq" range :min="1" :max="60" />
            <InputGroup class="input-small">
              <InputNumber class="input-text-center" v-model="parentState.channels[channel.id].randomFreq[0]" :min="1" :max="60" />
              <InputGroupAddon>-</InputGroupAddon>
              <InputNumber class="input-text-center" v-model="parentState.channels[channel.id].randomFreq[1]" :min="1" :max="60" />
              <InputGroupAddon>秒</InputGroupAddon>
            </InputGroup>
          </div>
        </div>

        <div class="field-block">
          <label class="font-semibold">基础强度</label>
          <InputNumber class="input-small" v-model="parentState.channels[channel.id].strengthVal" />
        </div>

        <div class="field-block">
          <label class="font-semibold">随机强度</label>
          <InputNumber class="input-small" v-model="parentState.channels[channel.id].randomStrengthVal" />
        </div>

        <div class="field-block">
          <label class="font-semibold">一键开火强度限制</label>
          <InputNumber class="input-small" v-model="parentState.channels[channel.id].fireStrengthLimit" />
        </div>
      </div>

      <div class="channel-meta">
        <span>强度范围：{{ parentState.channels[channel.id].strengthVal }} - {{ parentState.channels[channel.id].strengthVal + parentState.channels[channel.id].randomStrengthVal }}</span>
        <span>当前强度：{{ parentState.channels[channel.id].actualStrength }}/{{ parentState.channels[channel.id].strengthLimit }}</span>
        <span>临时附加：+{{ parentState.channels[channel.id].tempStrength }}</span>
      </div>
    </div>

    <CoyoteLocalConnectPanel />
  </div>
</template>

<style scoped lang="scss">
.channel-section {
  border: 1px solid var(--p-content-border-color);
  border-radius: 1rem;
  padding: 1.25rem;
  background: color-mix(in srgb, var(--p-surface-0) 92%, transparent);
}

.channel-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 1rem;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-wide {
  grid-column: 1 / -1;
}

.channel-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 1rem;
  opacity: 0.7;
  font-size: 0.9rem;
}

.channel-disabled {
  opacity: 0.55;
}

@media (min-width: 768px) {
  .channel-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
