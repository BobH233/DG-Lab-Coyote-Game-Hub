<script lang="ts" setup>
import Popover from 'primevue/popover';
import { Reactive } from 'vue';
import { ToastServiceMethods } from 'primevue/toastservice';
import { ConfirmationOptions } from 'primevue/confirmationoptions';

import { GameChannelId } from '../../apis/socketApi';
import { PulseItemInfo } from '../../type/pulse';
import { ControllerPageState } from '../../pages/Controller.vue';

defineOptions({
  name: 'PulseSettings',
});

const props = defineProps<{
  state: any;
}>();

let parentState: Reactive<ControllerPageState>;
watch(() => props.state, (value) => {
  parentState = value;
}, { immediate: true });

const customPulseList = computed(() => {
  return parentState.customPulseList.map((item) => ({
    ...item,
    isCustom: true,
  }));
});

const fullPulseList = computed(() => {
  return parentState.pulseList ? [...customPulseList.value, ...parentState.pulseList] : customPulseList.value;
});

const state = reactive({
  willRenamePulseName: '',
  showImportPulseDialog: false,
  showSortPulseDialog: false,
  showRenamePulseDialog: false,
  sortChannelId: 'a' as GameChannelId,
  pulseTimeChannelId: 'a' as GameChannelId,
});

const channelEntries = computed(() => ([
  { id: 'a', title: 'A通道', accent: 'text-red-500' },
  { id: 'b', title: 'B通道', accent: 'text-sky-500' },
]) as const);

const selectedSortPulseIds = computed({
  get: () => parentState.channels[state.sortChannelId].selectPulseIds,
  set: (value: string[]) => {
    parentState.channels[state.sortChannelId].selectPulseIds = value;
  },
});

const postCustomPulseConfig = inject<() => void>('postCustomPulseConfig');
const toast = inject<ToastServiceMethods>('parentToast');
const confirm = inject<{
  require: (option: ConfirmationOptions) => void;
  close: () => void;
}>('parentConfirm');

const pulseTimePopoverRef = ref<InstanceType<typeof Popover> | null>(null);

const pulseModeOptions = [
  { label: '单个', value: 'single' },
  { label: '顺序', value: 'sequence' },
  { label: '随机', value: 'random' },
];

const presetPulseTimeOptions = [
  { label: '10', value: 10 },
  { label: '30', value: 30 },
  { label: '60', value: 60 },
  { label: '120', value: 120 },
];

const handlePulseImported = async (pulseInfo: PulseItemInfo) => {
  const duplicate = parentState.customPulseList.find((item) => item.id === pulseInfo.id);
  if (duplicate) {
    toast?.add({ severity: 'warn', summary: '导入失败', detail: '相同波形已存在', life: 3000 });
    return;
  }

  parentState.customPulseList.push(pulseInfo);
  toast?.add({ severity: 'success', summary: '导入成功', detail: '波形已导入', life: 3000 });
  postCustomPulseConfig?.();
};

const togglePulse = (channelId: GameChannelId, pulseId: string) => {
  const channelState = parentState.channels[channelId];
  if (channelState.pulseMode === 'single') {
    channelState.selectPulseIds = [pulseId];
    return;
  }

  if (channelState.selectPulseIds.includes(pulseId)) {
    channelState.selectPulseIds = channelState.selectPulseIds.filter((id) => id !== pulseId);
  } else {
    channelState.selectPulseIds.push(pulseId);
  }
};

const setFirePulse = (channelId: GameChannelId, pulseId: string) => {
  parentState.channels[channelId].firePulseId = pulseId;
};

const showPulseTimePopover = (channelId: GameChannelId, event: MouseEvent) => {
  state.pulseTimeChannelId = channelId;
  pulseTimePopoverRef.value?.show(event);
};

const openSortDialog = (channelId: GameChannelId) => {
  state.sortChannelId = channelId;
  state.showSortPulseDialog = true;
};

let renamePulseId = '';
const handleRenamePulse = async (pulseId: string) => {
  renamePulseId = pulseId;
  state.willRenamePulseName = parentState.customPulseList.find((item) => item.id === pulseId)?.name ?? '';
  state.showRenamePulseDialog = true;
};

const handleRenamePulseConfirm = async (newName: string) => {
  const pulse = parentState.customPulseList.find((item) => item.id === renamePulseId);
  if (pulse) {
    pulse.name = newName;
    postCustomPulseConfig?.();
  }
};

const handleDeletePulse = async (pulseId: string) => {
  confirm?.require({
    header: '删除波形',
    message: '确定要删除此波形吗？',
    rejectProps: {
      label: '取消',
      severity: 'secondary',
      outlined: true
    },
    acceptProps: {
      label: '确定',
      severity: 'danger',
    },
    icon: 'pi pi-exclamation-triangle',
    accept: async () => {
      parentState.customPulseList = parentState.customPulseList.filter((item) => item.id !== pulseId);

      (['a', 'b'] as GameChannelId[]).forEach((channelId) => {
        const channelState = parentState.channels[channelId];
        channelState.selectPulseIds = channelState.selectPulseIds.filter((id) => id !== pulseId);
        if (channelState.firePulseId === pulseId) {
          channelState.firePulseId = '';
        }
        if (channelState.selectPulseIds.length === 0 && fullPulseList.value[0]) {
          channelState.selectPulseIds = [fullPulseList.value[0].id];
        }
      });

      postCustomPulseConfig?.();
    },
  });
};
</script>

<template>
  <div class="w-full flex flex-col gap-6">
    <div class="flex flex-col justify-between gap-2 items-start md:flex-row md:items-center">
      <div>
        <h2 class="font-bold text-xl">波形列表</h2>
        <p class="opacity-70 text-sm mt-1">A、B 通道的播放列表、一键开火波形和切换模式已经分离。</p>
      </div>
      <Button icon="pi pi-plus" label="导入波形" severity="secondary"
        @click="state.showImportPulseDialog = true"></Button>
    </div>

    <div v-for="channel in channelEntries" :key="channel.id" class="channel-section"
      :class="{ 'channel-disabled': channel.id === 'b' && !parentState.channels.b.enabled }">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
        <div>
          <div class="flex items-center gap-3">
            <h3 class="text-lg font-bold" :class="channel.accent">{{ channel.title }}</h3>
            <Tag v-if="channel.id === 'b' && !parentState.channels.b.enabled" severity="warn" value="当前禁用" />
          </div>
          <p class="opacity-70 text-sm mt-1">当前波形列表和一键开火波形均独立保存。</p>
        </div>
        <div class="flex gap-2 items-center flex-wrap">
          <Button icon="pi pi-sort-alpha-down" title="波形排序" severity="secondary"
            @click="openSortDialog(channel.id)" v-if="parentState.channels[channel.id].pulseMode === 'sequence'"></Button>
          <Button icon="pi pi-clock" title="波形切换间隔" severity="secondary"
            :label="parentState.channels[channel.id].pulseChangeInterval + 's'"
            @click="showPulseTimePopover(channel.id, $event)"></Button>
          <SelectButton v-model="parentState.channels[channel.id].pulseMode" :options="pulseModeOptions"
            optionLabel="label" optionValue="value" :allowEmpty="false" aria-labelledby="basic" />
        </div>
      </div>

      <div v-if="parentState.pulseList" class="grid justify-center grid-cols-1 md:grid-cols-2 gap-4 pb-2">
        <PulseCard v-for="pulse in fullPulseList" :key="channel.id + '-' + pulse.id" :pulse-info="pulse"
          :is-current-pulse="parentState.channels[channel.id].selectPulseIds.includes(pulse.id)"
          :is-fire-pulse="pulse.id === parentState.channels[channel.id].firePulseId"
          @set-current-pulse="togglePulse(channel.id, $event)"
          @set-fire-pulse="setFirePulse(channel.id, $event)"
          @delete-pulse="handleDeletePulse" @rename-pulse="handleRenamePulse" />
      </div>
      <div v-else class="flex justify-center py-4">
        <ProgressSpinner />
      </div>
    </div>

    <SortPulseDialog v-model:visible="state.showSortPulseDialog" :pulse-list="parentState.pulseList ?? []"
      v-model:modelValue="selectedSortPulseIds" />
    <ImportPulseDialog v-model:visible="state.showImportPulseDialog" @on-pulse-imported="handlePulseImported" />
    <PromptDialog v-model:visible="state.showRenamePulseDialog" @confirm="handleRenamePulseConfirm" title="重命名波形"
      input-label="波形名称" :default-value="state.willRenamePulseName" />

    <Popover class="popover-pulseTime" ref="pulseTimePopoverRef">
      <div class="flex flex-col gap-4 w-[25rem]">
        <div>
          <span class="font-medium block mb-2">{{ state.pulseTimeChannelId.toUpperCase() }}通道波形切换间隔</span>
          <div class="flex gap-2">
            <InputGroup>
              <InputNumber v-model="parentState.channels[state.pulseTimeChannelId].pulseChangeInterval" :min="5" :max="600" />
              <InputGroupAddon>秒</InputGroupAddon>
            </InputGroup>
            <SelectButton v-model="parentState.channels[state.pulseTimeChannelId].pulseChangeInterval"
              :options="presetPulseTimeOptions" optionLabel="label" optionValue="value" :allowEmpty="false"
              aria-labelledby="basic" />
          </div>
        </div>
      </div>
    </Popover>
  </div>
</template>

<style scoped lang="scss">
.channel-section {
  border: 1px solid var(--p-content-border-color);
  border-radius: 1rem;
  padding: 1.25rem;
  background: color-mix(in srgb, var(--p-surface-0) 92%, transparent);
}

.channel-disabled {
  opacity: 0.65;
}
</style>
