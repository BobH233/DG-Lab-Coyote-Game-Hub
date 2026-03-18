<script lang="ts" setup>
import { GameChannelId, SocketApi } from './apis/socketApi';
import { ServerInfoResData, webApi } from './apis/webApi';
import { parseChartParams } from './utils/request';
import { handleApiResponse } from './utils/response';

type ViewerChannelState = {
  strength: number;
  randomStrength: number;
  strengthLimit: number;
  tempStrength: number;
  realStrength: number;
};

const createChannelState = (): ViewerChannelState => ({
  strength: 0,
  randomStrength: 0,
  strengthLimit: 50,
  tempStrength: 0,
  realStrength: 0,
});

const state = reactive({
  clientId: '',
  layout: 'dual' as 'single' | 'dual',
  channel: 'a' as GameChannelId,
  gameStarted: false,
  channels: {
    a: createChannelState(),
    b: createChannelState(),
  },
  error: null as string | null,
});

let serverInfo: ServerInfoResData;
let wsClient: SocketApi;

const route = useRoute();

const chartParams = computed(() => {
  return parseChartParams(route);
});

const displayChannels = computed<GameChannelId[]>(() => {
  if (state.layout === 'single') {
    return [state.channel];
  }

  return ['a', 'b'];
});

const getChartVal = (channelId: GameChannelId) => {
  const channelState = state.channels[channelId];
  return {
    valLow: Math.min(channelState.strength + channelState.tempStrength, channelState.strengthLimit),
    valHigh: Math.min(channelState.strength + channelState.tempStrength + channelState.randomStrength, channelState.strengthLimit),
    valLimit: channelState.strengthLimit,
  };
};

const initServerInfo = async () => {
  try {
    let serverInfoRes = await webApi.getServerInfo();
    handleApiResponse(serverInfoRes);
    serverInfo = serverInfoRes!;
  } catch (error: any) {
    console.error('Cannot get server info:', error);
    state.error = '无法获取服务器信息';
  }
};

const initWebSocket = async () => {
  wsClient = new SocketApi(serverInfo.server.wsUrl);

  wsClient.on('open', () => {
    // 此事件在重连时也会触发
    console.log('WebSocket connected or re-connected');
    if (state.clientId) { // 重连时重新绑定客户端
      bindClient();
    }
  });

  wsClient.on('strengthChanged', (strength) => {
    (['a', 'b'] as GameChannelId[]).forEach((channelId) => {
      state.channels[channelId].strengthLimit = strength[channelId].limit;
      state.channels[channelId].tempStrength = strength[channelId].tempStrength;
      state.channels[channelId].realStrength = strength[channelId].strength;
    });
  });

  wsClient.on('strengthConfigUpdated', (config) => {
    (['a', 'b'] as GameChannelId[]).forEach((channelId) => {
      const channelState = state.channels[channelId];
      channelState.strength = Math.min(config[channelId].strength, channelState.strengthLimit);
      channelState.randomStrength = config[channelId].randomStrength;
    });
  });

  wsClient.on('gameStarted', () => {
    state.gameStarted = true;
  });

  wsClient.on('gameStopped', () => {
    state.gameStarted = false;
  });

  wsClient.connect();
};

const bindClient = async () => {
  try {
    let res = await wsClient.bindClient(state.clientId);
    handleApiResponse(res);
  } catch (error: any) {
    console.error('Cannot bind client:', error);
    state.error = '绑定客户端失败' + error.message;
  }
};

onBeforeUnmount(() => {
  wsClient.close();
});

onMounted(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has('clientId')) {
    state.error = '缺少 clientId 参数';
    return;
  }

  state.clientId = urlParams.get('clientId')!;
  state.layout = urlParams.get('layout') === 'single' ? 'single' : 'dual';
  state.channel = urlParams.get('channel') === 'b' ? 'b' : 'a';
  if (urlParams.has('channel')) {
    state.layout = 'single';
  }

  await initServerInfo();
  await initWebSocket();
});
</script>

<template>
  <div class="viewer-root w-full h-full" :class="{ 'viewer-root--single': displayChannels.length === 1 }">
    <RouterView>
      <template #default="{ Component }">
        <div class="viewer-grid">
          <div v-for="channelId in displayChannels" :key="channelId" class="viewer-panel">
            <div class="viewer-channel-tag" v-if="displayChannels.length > 1">
              {{ channelId.toUpperCase() }}通道
            </div>
            <Component
              :is="Component"
              v-bind="chartParams"
              :valLimit="getChartVal(channelId).valLimit"
              :valLow="getChartVal(channelId).valLow"
              :valHigh="getChartVal(channelId).valHigh"
              :strength="state.channels[channelId].strength"
              :randomStrength="state.channels[channelId].randomStrength"
              :tempStrength="state.channels[channelId].tempStrength"
              :realStrength="state.channels[channelId].realStrength"
              :strengthLimit="state.channels[channelId].strengthLimit"
              :running="state.gameStarted"
            />
          </div>
        </div>
      </template>
    </RouterView>
    <Transition name="fade">
      <div class="fixed w-full h-full left-0 top-0 error-cover" v-if="state.error">
        <div class="flex flex-col items-center justify-center h-full">
          <p class="text-xl font-semibold text-white">{{ state.error }}</p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style>
body {
  background-color: transparent;
  height: 100vh;
  margin: 0;
}

#app {
  width: 100%;
  height: 100%;
}

.viewer-root {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  box-sizing: border-box;
}

.viewer-root--single {
  padding: 0;
}

.viewer-grid {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  flex-wrap: wrap;
  width: 100%;
}

.viewer-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.viewer-channel-tag {
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  font-size: 0.95rem;
  font-weight: 700;
  color: white;
  letter-spacing: 0.04em;
  background: rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(8px);
}

.error-cover {
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(5px);
  z-index: 20;
  text-shadow: 0 0 5px black;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 150ms;
}

.fade-enter,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-to,
.fade-leave {
  opacity: 1;
}
</style>
