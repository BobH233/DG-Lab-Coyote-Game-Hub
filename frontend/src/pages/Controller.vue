<script lang="ts" setup>
import { useToast } from 'primevue/usetoast';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import StatusChart from '../charts/Circle1.vue';
import SelectButton from 'primevue/selectbutton';

import {
  GameChannelId,
  GameConfigType,
  GameStrengthConfig,
  MainGameConfig,
  PulseItemResponse,
  PulsePlayMode,
  SocketApi
} from '../apis/socketApi';
import { ClientConnectUrlInfo, ServerInfoResData, webApi } from '../apis/webApi';
import { handleApiResponse } from '../utils/response';
import { simpleObjDiff } from '../utils/utils';
import { PulseItemInfo } from '../type/pulse';
import { useConfirm } from 'primevue/useconfirm';
import { ConnectorType, CoyoteDeviceVersion } from '../type/common';
import CoyoteLocalConnectService from '../components/partials/CoyoteLocalConnectService.vue';
import ClientInfoDialog from '../components/dialogs/ClientInfoDialog.vue';
import { useClientsStore } from '../stores/ClientsStore';
import ConnectToSavedClientsDialog from '../components/dialogs/ConnectToSavedClientsDialog.vue';
import { useRemoteNotificationStore } from '../stores/RemoteNotificationStore';

export interface ChannelControlState {
  enabled: boolean;
  strengthVal: number;
  randomStrengthVal: number;
  strengthLimit: number;
  tempStrength: number;
  actualStrength: number;
  randomFreq: number[];
  fireStrengthLimit: number;
  selectPulseIds: string[];
  firePulseId: string;
  pulseMode: PulsePlayMode;
  pulseChangeInterval: number;
}

export interface ControllerPageState {
  controllerPage: 'strength' | 'pulse' | 'game';
  channels: Record<GameChannelId, ChannelControlState>;
  pulseList: PulseItemInfo[] | null;
  customPulseList: PulseItemInfo[];
  newClientName: string;
  clientId: string;
  clientWsUrlList: ClientConnectUrlInfo[] | null;
  clientStatus: 'init' | 'waiting' | 'connected';
  apiBaseHttpUrl: string;
  connectorType: ConnectorType;
  gameStarted: boolean;
  showConnectionDialog: boolean;
  showClientInfoDialog: boolean;
  showLiveCompDialog: boolean;
  showConfigSavePrompt: boolean;
  showClientNameDialog: boolean;
  showConnectToSavedClientsDialog: boolean;
}

const createChannelState = (enabled: boolean): ChannelControlState => ({
  enabled,
  strengthVal: 5,
  randomStrengthVal: 5,
  strengthLimit: 20,
  tempStrength: 0,
  actualStrength: 0,
  randomFreq: [15, 30],
  fireStrengthLimit: 30,
  selectPulseIds: [''],
  firePulseId: '',
  pulseMode: 'single',
  pulseChangeInterval: 60,
});

const state = reactive<ControllerPageState>({
  controllerPage: 'strength',
  channels: {
    a: createChannelState(true),
    b: createChannelState(false),
  },
  pulseList: null,
  customPulseList: [],
  newClientName: '',
  clientId: '',
  clientWsUrlList: null,
  clientStatus: 'init',
  apiBaseHttpUrl: '',
  connectorType: ConnectorType.DGLAB,
  gameStarted: false,
  showConnectionDialog: false,
  showClientInfoDialog: false,
  showLiveCompDialog: false,
  showConfigSavePrompt: false,
  showClientNameDialog: false,
  showConnectToSavedClientsDialog: false,
});

const channelIdList: GameChannelId[] = ['a', 'b'];

const router = useRouter();
const coyoteLocalRef = ref<InstanceType<typeof CoyoteLocalConnectService> | null>(null);

const controllerPageTabs = [
  { title: '强度配置', id: 'strength', icon: 'pi pi-bolt' },
  { title: '波形配置', id: 'pulse', icon: 'pi pi-wave-pulse' },
  { title: '游戏连接', id: 'game', icon: 'pi pi-map' },
];

watch(() => state.controllerPage, (newVal) => {
  router.push({ path: newVal });
});

let receivedConfig = false;

const cloneConfig = <T>(value: T): T => JSON.parse(JSON.stringify(value));

let oldGameConfig: MainGameConfig | null = null;
const gameConfig = computed<MainGameConfig>({
  get: () => ({
    channels: {
      a: {
        enabled: true,
        strengthChangeInterval: [...state.channels.a.randomFreq] as [number, number],
        fireStrengthLimit: state.channels.a.fireStrengthLimit,
        pulseId: state.channels.a.selectPulseIds.length === 1 ? state.channels.a.selectPulseIds[0] : state.channels.a.selectPulseIds,
        firePulseId: state.channels.a.firePulseId === '' ? null : state.channels.a.firePulseId,
        pulseMode: state.channels.a.pulseMode,
        pulseChangeInterval: state.channels.a.pulseChangeInterval,
      },
      b: {
        enabled: state.channels.b.enabled,
        strengthChangeInterval: [...state.channels.b.randomFreq] as [number, number],
        fireStrengthLimit: state.channels.b.fireStrengthLimit,
        pulseId: state.channels.b.selectPulseIds.length === 1 ? state.channels.b.selectPulseIds[0] : state.channels.b.selectPulseIds,
        firePulseId: state.channels.b.firePulseId === '' ? null : state.channels.b.firePulseId,
        pulseMode: state.channels.b.pulseMode,
        pulseChangeInterval: state.channels.b.pulseChangeInterval,
      },
    },
  }),
  set: (value) => {
    channelIdList.forEach((channelId) => {
      const channelConfig = value.channels[channelId];
      const channelState = state.channels[channelId];
      channelState.enabled = channelId === 'a' ? true : channelConfig.enabled;
      channelState.randomFreq = [...channelConfig.strengthChangeInterval];
      channelState.fireStrengthLimit = channelConfig.fireStrengthLimit;
      channelState.selectPulseIds = typeof channelConfig.pulseId === 'string' ? [channelConfig.pulseId] : channelConfig.pulseId || [''];
      channelState.firePulseId = channelConfig.firePulseId || '';
      channelState.pulseMode = channelConfig.pulseMode;
      channelState.pulseChangeInterval = channelConfig.pulseChangeInterval;
    });
  }
});

let oldStrengthConfig: GameStrengthConfig | null = null;
const strengthConfig = computed<GameStrengthConfig>({
  get: () => ({
    a: {
      strength: state.channels.a.strengthVal,
      randomStrength: state.channels.a.randomStrengthVal,
    },
    b: {
      strength: state.channels.b.strengthVal,
      randomStrength: state.channels.b.randomStrengthVal,
    },
  }),
  set: (value) => {
    channelIdList.forEach((channelId) => {
      state.channels[channelId].strengthVal = value[channelId].strength;
      state.channels[channelId].randomStrengthVal = value[channelId].randomStrength;
    });
  }
});

const getChartVal = (channelId: GameChannelId) => {
  const channelState = state.channels[channelId];
  return {
    valLow: Math.min(channelState.strengthVal + channelState.tempStrength, channelState.strengthLimit),
    valHigh: Math.min(
      channelState.strengthVal + channelState.tempStrength + channelState.randomStrengthVal,
      channelState.strengthLimit,
    ),
    valLimit: channelState.strengthLimit,
  };
};

const toast = useToast();
const confirm = useConfirm();

const clientsStore = useClientsStore();
const remoteNotificationStore = useRemoteNotificationStore();

provide('parentToast', toast);
provide('parentConfirm', confirm);

let serverInfo: ServerInfoResData;
let wsClient: SocketApi;
let dgClientConnected = false;

const initServerInfo = async () => {
  try {
    const serverInfoRes = await webApi.getServerInfo();
    handleApiResponse(serverInfoRes);

    serverInfo = serverInfoRes!;
    state.clientWsUrlList = serverInfo.server.clientWsUrls;
    state.apiBaseHttpUrl = serverInfo.server.apiBaseHttpUrl;
  } catch (error: any) {
    console.error('Cannot get server info:', error);
    toast.add({ severity: 'error', summary: '获取服务器信息失败', detail: error.message });
  }
};

const initWebSocket = async () => {
  if (wsClient) return;

  wsClient = new SocketApi(serverInfo.server.wsUrl);

  wsClient.on('open', () => {
    if (state.clientId) {
      bindClient();
    }
  });

  wsClient.on('pulseListUpdated', (data: PulseItemResponse[]) => {
    state.pulseList = data;
  });

  wsClient.on('clientConnected', () => {
    state.showConnectionDialog = false;
    state.clientStatus = 'connected';
    dgClientConnected = true;
    handleClientConnected();
    toast.add({ severity: 'success', summary: '客户端连接成功', detail: '已连接到客户端', life: 3000 });
  });

  wsClient.on('clientDisconnected', () => {
    state.clientStatus = 'waiting';
    state.gameStarted = false;
    dgClientConnected = false;
  });

  wsClient.on('gameStarted', () => {
    state.gameStarted = true;
  });

  wsClient.on('gameStopped', () => {
    state.gameStarted = false;
  });

  wsClient.on('strengthChanged', (strength) => {
    channelIdList.forEach((channelId) => {
      state.channels[channelId].strengthLimit = strength[channelId].limit;
      state.channels[channelId].tempStrength = strength[channelId].tempStrength;
      state.channels[channelId].actualStrength = strength[channelId].strength;
    });
  });

  wsClient.on('strengthConfigUpdated', (config) => {
    if (state.showConfigSavePrompt) {
      oldStrengthConfig = cloneConfig(config);
    } else {
      strengthConfig.value = config;
      oldStrengthConfig = cloneConfig(config);
      receivedConfig = true;
      nextTick(() => {
        receivedConfig = false;
      });
    }
  });

  wsClient.on('mainGameConfigUpdated', (config) => {
    if (state.showConfigSavePrompt) {
      oldGameConfig = cloneConfig(config);
    } else {
      gameConfig.value = config;
      oldGameConfig = cloneConfig(config);
      receivedConfig = true;
      nextTick(() => {
        receivedConfig = false;
      });
    }
  });

  wsClient.on('customPulseConfigUpdated', (config) => {
    state.customPulseList = config.customPulseList;
  });

  wsClient.on('remoteNotification', (notification) => {
    if (notification.ignoreId && remoteNotificationStore.isIgnored(notification.ignoreId)) {
      return;
    }

    toast.add({
      severity: (notification.severity as unknown as 'success' | 'info' | 'warn' | 'error' | 'secondary' | 'contrast' | undefined) || 'info',
      summary: notification.title || '站点通知',
      detail: {
        type: 'custom',
        ...notification,
      },
      life: notification.sticky ? undefined : 5000,
    });
  });

  wsClient.connect();
};

const initClientConnection = async () => {
  try {
    const res = await webApi.getClientConnectInfo();
    handleApiResponse(res);
    state.clientId = res!.clientId;
    bindClient();
  } catch (error: any) {
    console.error('Cannot get client ws url list:', error);
    toast.add({ severity: 'error', summary: '获取客户端连接地址失败', detail: error.message });
  }
};

const bindClient = async () => {
  if (!state.clientId || !wsClient?.isConnected) return;

  try {
    state.clientStatus = 'waiting';
    const res = await wsClient.bindClient(state.clientId);
    handleApiResponse(res);
  } catch (error: any) {
    console.error('Cannot bind client:', error);
    toast.add({ severity: 'error', summary: '绑定客户端失败', detail: error.message });
  }
};

const handleClientConnected = () => {
  if (!state.clientId) return;

  const clientInfo = clientsStore.getClientInfo(state.clientId);
  if (!clientInfo) {
    state.newClientName = new Date().toLocaleString() + ' 连接的设备';
    state.showClientNameDialog = true;
  } else {
    clientsStore.updateClientConnectTime(state.clientId);
  }
};

const handleSaveClientConnect = async (clientName: string) => {
  clientsStore.addClient(state.clientId, clientName);
};

const showConnectionDialog = () => {
  state.showConnectionDialog = true;
  if (!state.clientId) {
    initClientConnection();
  }
};

const showLiveCompDialog = () => {
  state.showLiveCompDialog = true;
  if (!state.clientId) {
    initClientConnection();
  }
};

const handleResetClientId = () => {
  initClientConnection();
};

const handleConnSetClientId = (clientId: string) => {
  state.clientId = clientId;
  bindClient();
  state.showConnectionDialog = false;
};

const postConfig = async () => {
  try {
    if (simpleObjDiff(oldStrengthConfig, strengthConfig.value)) {
      const res = await wsClient.updateStrengthConfig(strengthConfig.value);
      handleApiResponse(res);
      oldStrengthConfig = cloneConfig(strengthConfig.value);
    }

    if (simpleObjDiff(oldGameConfig, gameConfig.value)) {
      const res = await wsClient.updateConfig(GameConfigType.MainGame, gameConfig.value);
      handleApiResponse(res);
      oldGameConfig = cloneConfig(gameConfig.value);
    }

    toast.add({ severity: 'success', summary: '保存成功', detail: '游戏配置已保存', life: 3000 });
  } catch (error: any) {
    console.error('Cannot post config:', error);
  }
};

const postCustomPulseConfig = async () => {
  try {
    const res = await wsClient.updateConfig(GameConfigType.CustomPulse, {
      customPulseList: state.customPulseList,
    });
    handleApiResponse(res);
  } catch (error: any) {
    console.error('Cannot post custom pulse config:', error);
  }
};
provide('postCustomPulseConfig', postCustomPulseConfig);

const handleStartGame = async () => {
  if (!dgClientConnected) {
    toast.add({ severity: 'warn', summary: '未连接到客户端', detail: '启动输出需要先连接到客户端', life: 5000 });
    return;
  }

  try {
    const res = await wsClient.startGame();
    handleApiResponse(res);
  } catch (error: any) {
    console.error('Cannot start game:', error);
  }
};

const handleStopGame = async () => {
  if (!dgClientConnected) {
    toast.add({ severity: 'warn', summary: '未连接到客户端', detail: '暂停输出需要先连接到客户端', life: 5000 });
    return;
  }

  try {
    const res = await wsClient.stopGame();
    handleApiResponse(res);
  } catch (error: any) {
    console.error('Cannot pause game:', error);
  }
};

const handleSaveConfig = () => {
  postConfig();
  state.showConfigSavePrompt = false;
};

const handleCancelSaveConfig = () => {
  if (oldGameConfig) {
    gameConfig.value = cloneConfig(oldGameConfig);
  }
  if (oldStrengthConfig) {
    strengthConfig.value = cloneConfig(oldStrengthConfig);
  }

  state.showConfigSavePrompt = false;
  receivedConfig = true;
  nextTick(() => {
    receivedConfig = false;
  });
};

const handleStartBluetoothConnect = (deviceVersion: CoyoteDeviceVersion) => {
  coyoteLocalRef.value?.startBluetoothConnect(deviceVersion);
};

const handleStartDebugConnect = () => {
  coyoteLocalRef.value?.startLocalDebugConnect();
};

const normalizeSinglePulseMode = (channelId: GameChannelId) => {
  const channelState = state.channels[channelId];
  if (channelState.pulseMode === 'single' && channelState.selectPulseIds.length > 1) {
    channelState.selectPulseIds = [channelState.selectPulseIds[0]];
  }
};

onMounted(async () => {
  if (clientsStore.clientList.length > 0) {
    state.showConnectToSavedClientsDialog = true;
  }

  await initServerInfo();
  await initWebSocket();
});

watch(() => state.channels.a.pulseMode, () => normalizeSinglePulseMode('a'));
watch(() => state.channels.b.pulseMode, () => normalizeSinglePulseMode('b'));

watch([gameConfig, strengthConfig], () => {
  if (receivedConfig) {
    receivedConfig = false;
    return;
  }

  state.showConfigSavePrompt = true;
}, { deep: true });
</script>

<template>
  <div class="w-full page-container">
    <Toast>
      <template #container="{ message, closeCallback }">
        <CustomToastContent :message="message" :close-callback="closeCallback" />
      </template>
    </Toast>
    <ConfirmDialog></ConfirmDialog>
    <CoyoteLocalConnectService :state="state" ref="coyoteLocalRef"></CoyoteLocalConnectService>
    <div class="flex flex-col lg:flex-row items-center lg:items-start gap-8">
      <div class="flex flex-wrap justify-center gap-4">
        <div
          v-for="channelId in channelIdList"
          :key="channelId"
          class="flex flex-col items-center gap-2"
          :class="{ 'opacity-60': channelId === 'b' && !state.channels.b.enabled }"
        >
          <span class="text-sm font-bold tracking-wide">
            {{ channelId.toUpperCase() }}通道
          </span>
          <StatusChart
            :val-low="getChartVal(channelId).valLow"
            :val-high="getChartVal(channelId).valHigh"
            :val-limit="getChartVal(channelId).valLimit"
            :real-strength="state.channels[channelId].actualStrength"
            :running="state.gameStarted"
            readonly
          />
        </div>
      </div>

      <Card class="controller-panel flex-grow-1 flex-shrink-1 w-full">
        <template #header>
          <div>
            <Toolbar class="controller-toolbar">
              <template #start>
                <Button icon="pi pi-qrcode" class="mr-4" severity="secondary" label="连接设备"
                  v-if="state.clientStatus !== 'connected'" @click="showConnectionDialog()"></Button>
                <Button v-else icon="pi pi-info-circle" class="mr-4" severity="secondary" label="连接信息"
                  @click="state.showClientInfoDialog = true"></Button>
                <span class="text-red-600 block flex items-center gap-1 mr-2" v-if="state.clientStatus === 'init'">
                  <i class="pi pi-circle-off"></i>
                  <span>未连接</span>
                </span>
                <span class="text-green-600 block flex items-center gap-1 mr-2"
                  v-else-if="state.clientStatus === 'connected'">
                  <i class="pi pi-circle-on"></i>
                  <span>已连接</span>
                </span>
                <span class="text-yellow-600 block flex items-center gap-1 mr-2" v-else>
                  <i class="pi pi-spin pi-spinner"></i>
                  <span>等待连接</span>
                </span>
              </template>
              <template #end>
                <Button icon="pi pi-file-export" class="mr-2" severity="secondary" label="添加到OBS"
                  @click="showLiveCompDialog()"></Button>
                <Button icon="pi pi-play" class="mr-2" severity="secondary" label="启动输出" v-if="!state.gameStarted"
                  @click="handleStartGame()"></Button>
                <Button icon="pi pi-pause" class="mr-2" severity="secondary" label="暂停输出" v-else
                  @click="handleStopGame()"></Button>
              </template>
            </Toolbar>
            <div class="w-full px-2 controller-page-tabs">
              <SelectButton v-model="state.controllerPage" :options="controllerPageTabs" optionLabel="title" optionValue="id" dataKey="id"
                :allowEmpty="false" aria-labelledby="custom">
                <template #option="slotProps">
                  <div class="flex flex-col items-center gap-2 px-2 py-1">
                    <i :class="slotProps.option.icon"></i>
                    <span>{{ slotProps.option.title }}</span>
                  </div>
                </template>
              </SelectButton>
            </div>
          </div>
        </template>

        <template #content>
          <RouterView>
            <template #default="{ Component }">
              <FadeAndSlideTransitionGroup>
                <component :is="Component" :state="state" />
              </FadeAndSlideTransitionGroup>
            </template>
          </RouterView>
        </template>
      </Card>
    </div>

    <ConnectToClientDialog v-model:visible="state.showConnectionDialog" :clientWsUrlList="state.clientWsUrlList"
      :client-id="state.clientId" @reset-client-id="handleResetClientId" @update:client-id="handleConnSetClientId"
      @start-bluetooth-connect="handleStartBluetoothConnect"
      @start-debug-connect="handleStartDebugConnect" />
    <ClientInfoDialog v-model:visible="state.showClientInfoDialog" :client-id="state.clientId"
      :controller-url="state.apiBaseHttpUrl" :connector-type="state.connectorType" />
    <GetLiveCompDialog v-model:visible="state.showLiveCompDialog" :client-id="state.clientId" />
    <ConfigSavePrompt :visible="state.showConfigSavePrompt" @save="handleSaveConfig" @cancel="handleCancelSaveConfig" />
    <ConnectToSavedClientsDialog v-model:visible="state.showConnectToSavedClientsDialog"
      @confirm="handleConnSetClientId" />
    <PromptDialog v-model:visible="state.showClientNameDialog" title="保存客户端" message="将此设备保存到本地，以便于下次连接。波形列表将跟随设备保存。"
      input-label="客户端备注名" :default-value="state.newClientName" :allow-empty="false"
      @confirm="handleSaveClientConnect" />
  </div>
</template>

<style lang="scss">
$container-max-widths: (
  md: 768px,
  lg: 960px,
  xl: 1100px,
);

body {
  background: #eff0f0;
}

@media (prefers-color-scheme: dark) {
  body {
    background: #000;
  }
}

.popover-pulseTime::before,
.popover-pulseTime::after {
  display: none;
}

.page-container {
  margin-top: 2rem;
  margin-bottom: 6rem;
  margin-left: auto;
  margin-right: auto;
  padding: 0 1rem;
  width: 100%;
}

@media (min-width: 768px) {
  .page-container {
    max-width: map-get($container-max-widths, lg);
  }
}

@media (min-width: 1024px) {
  .page-container {
    max-width: map-get($container-max-widths, xl);
  }
}

.controller-panel {
  background: #fcfcfc;
  border-radius: 0.8rem;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
  overflow: hidden;

  .input-small {
    height: 32px;
    --p-inputtext-padding-y: 0.25rem;
  }

  .input-text-center input {
    text-align: center;
  }

  .inner-tabs {
    --p-tabs-tablist-background: transparent;
    --p-tabs-tab-padding: 0.5rem 1.5rem;
  }
}

.controller-toolbar {
  --p-toolbar-border-radius: 0;
  border: none !important;
  border-bottom: 1px solid var(--p-content-border-color) !important;
}

.controller-page-tabs {
  background: var(--p-togglebutton-background);
  border-bottom: 1px solid var(--p-content-border-color) !important;
}

@media (prefers-color-scheme: dark) {
  .controller-panel {
    background: #121212;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
  }
}
</style>
