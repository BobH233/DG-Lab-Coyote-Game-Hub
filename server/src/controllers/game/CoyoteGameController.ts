import { EventEmitter } from 'events';

import { Channel } from '#app/types/dg.js';
import { DGLabWSClient, StrengthInfo } from '../ws/DGLabWS.js';
import { Task, TaskAbortedError } from '#app/utils/task.js';
import { randomInt, simpleObjDiff, throttle } from '#app/utils/utils.js';
import { EventStore } from '#app/utils/EventStore.js';
import { CoyoteGameManager } from '#app/managers/CoyoteGameManager.js';
import {
    createDefaultGameStrengthConfig,
    GameChannelId,
    GameStrengthConfig,
    gameChannelIdList,
    MainGameConfig,
    normalizeGameStrengthConfig,
} from '#app/types/game.js';
import { PulsePlayList } from '#app/utils/PulsePlayList.js';
import { AbstractGameAction } from './actions/AbstractGameAction.js';
import { WebWSClient } from '../ws/WebWS.js';
import { DGLabPulseInfo } from '#app/services/DGLabPulse.js';
import { LatencyLogger } from '#app/utils/latencyLogger.js';
import { ServerContext } from '#app/types/server.js';
import { GameModel } from '#app/models/GameModel.js';
import { CustomPulseModel } from '#app/models/CustomPulseModel.js';
import { CoyoteGameConfigService, GameConfigType as PersistedGameConfigType } from '#app/services/CoyoteGameConfigService.js';

export type GameChannelStrengthInfo = StrengthInfo & {
    tempStrength: number;
};

export type GameStrengthInfo = Record<GameChannelId, GameChannelStrengthInfo>;

export interface CoyoteGameEvents {
    close: [];
    strengthChanged: [strength: GameStrengthInfo];
    strengthConfigUpdated: [config: GameStrengthConfig];
    clientConnected: [];
    clientDisconnected: [];
    gameStarted: [];
    gameStopped: [];
}

const channelMap: Record<GameChannelId, Channel> = {
    a: Channel.A,
    b: Channel.B,
};

export class CoyoteGameController {
    private ctx: ServerContext;

    /** 在线Socket的ID列表，用于判断是否可以释放Game */
    private onlineSockets = new Set<string>();

    /** 延迟调试 */
    private latencyLogger = new LatencyLogger();

    /** 游戏对应的clientId */
    public clientId: string;

    /** DG-Lab客户端连接 */
    public client?: DGLabWSClient;

    /** 强度配置 */
    public strengthConfig: GameStrengthConfig = createDefaultGameStrengthConfig();

    public gameConfig!: MainGameConfig;

    /** 强度配置更改时间 */
    public strengthConfigModified: number = 0;

    /** 强度设置时间 */
    public strengthSetTime: number = 0;

    /** 当前游戏Action列表 */
    public actionList: AbstractGameAction[] = [];

    private channelTasks: Partial<Record<GameChannelId, Task>> = {};
    private actionAbortController: AbortController | null = null;
    private actionRunner: Promise<void> | null = null;
    private runningAction: AbstractGameAction | null = null;
    private started = false;

    private _tempStrength: Record<GameChannelId, number> = {
        a: 0,
        b: 0,
    };

    /** 自定义波形列表 */
    public customPulseList: DGLabPulseInfo[] = [];

    /** 波形播放列表 */
    public pulsePlayLists!: Record<GameChannelId, PulsePlayList>;

    public events = new EventEmitter<CoyoteGameEvents>();

    private eventStore: EventStore = new EventStore();

    public get running() {
        return this.started;
    }

    public getTempStrength(channelId: GameChannelId): number {
        return this._tempStrength[channelId];
    }

    public setTempStrength(channelId: GameChannelId, value: number): void {
        this._tempStrength[channelId] = value;
        this.events.emit('strengthChanged', this.gameStrength);
    }

    public resetTempStrength(): void {
        this._tempStrength.a = 0;
        this._tempStrength.b = 0;
        this.events.emit('strengthChanged', this.gameStrength);
    }

    public getChannelClientStrength(channelId: GameChannelId): StrengthInfo {
        if (channelId === 'a') {
            return this.client?.strength ?? {
                strength: 0,
                limit: 20,
            };
        }

        return this.client?.strengthChannelB ?? {
            strength: 0,
            limit: 20,
        };
    }

    public get clientStrength(): StrengthInfo {
        return this.getChannelClientStrength('a');
    }

    public get gameStrength(): GameStrengthInfo {
        return {
            a: {
                ...this.getChannelClientStrength('a'),
                tempStrength: this._tempStrength.a,
            },
            b: {
                ...this.getChannelClientStrength('b'),
                tempStrength: this._tempStrength.b,
            },
        };
    }

    constructor(ctx: ServerContext, clientId: string) {
        this.ctx = ctx;
        this.clientId = clientId;
    }

    async initialize(): Promise<void> {
        const gameModel = await GameModel.getOrCreateByGameId(this.ctx.database, this.clientId);
        this.gameConfig = gameModel.toMainGameConfig();
        this.customPulseList = await CustomPulseModel.getPulseListByGameId(this.ctx.database, this.clientId) ?? [];
        this.pulsePlayLists = this.createPulsePlayLists();

        // 从缓存中恢复游戏状态
        const configCachePrefix = `coyoteLiveGameConfig:${this.clientId}:`;
        const configCache = CoyoteGameManager.instance.configCache;
        const cachedGameStrengthConfig = configCache.get(`${configCachePrefix}:strength`);
        if (cachedGameStrengthConfig) {
            this.strengthConfig = normalizeGameStrengthConfig(cachedGameStrengthConfig);
            this.strengthConfigModified = Date.now();
            this.events.emit('strengthConfigUpdated', this.strengthConfig);
        } else {
            const persistedStrengthConfig = await CoyoteGameConfigService.instance.get(this.clientId, PersistedGameConfigType.Strength, false);
            if (persistedStrengthConfig) {
                this.strengthConfig = normalizeGameStrengthConfig(persistedStrengthConfig);
                this.strengthConfigModified = Date.now();
                configCache.set(`${configCachePrefix}:strength`, this.strengthConfig);
                this.events.emit('strengthConfigUpdated', this.strengthConfig);
            }
        }

        // 监听游戏配置更新事件
        const gameConfigEvents = this.eventStore.wrap(GameModel.events);
        gameConfigEvents.on('configUpdated', this.clientId, throttle((newConfig) => {
            this.handleConfigUpdated(newConfig);
        }, 100));

        const pulseEvents = this.eventStore.wrap(CustomPulseModel.events);
        pulseEvents.on('pulseListUpdated', this.clientId, throttle(async () => {
            this.customPulseList = await CustomPulseModel.getPulseListByGameId(this.ctx.database, this.clientId);
        }, 100));
    }

    public getChannelConfig(channelId: GameChannelId) {
        return this.gameConfig.channels[channelId];
    }

    public getEnabledChannels(): GameChannelId[] {
        return gameChannelIdList.filter((channelId) => this.gameConfig.channels[channelId].enabled);
    }

    public getCurrentPulseId(channelId: GameChannelId): string {
        return this.pulsePlayLists[channelId].getCurrentPulseId();
    }

    public getCurrentPulseIds(): Record<GameChannelId, string> {
        return {
            a: this.getCurrentPulseId('a'),
            b: this.getCurrentPulseId('b'),
        };
    }

    public async bindClient(client: DGLabWSClient): Promise<void> {
        this.client = client;
        this.onlineSockets.add('dgclient');

        await this.stopGame(true);
        this.started = false;
        this.events.emit('clientConnected');
        this.events.emit('gameStopped');

        await this.setChannelStrength('a', 0);
        await this.setChannelStrength('b', 0);
        this.resetTempStrength();

        const clientEvents = this.eventStore.wrap(this.client);
        clientEvents.on('close', async () => {
            clientEvents.removeAllListeners();
            this.onlineSockets.delete('dgclient');

            try {
                await this.stopGame(true);
            } catch (error) {
                console.error('Failed to stop game after client disconnected:', error);
            }

            this.handleSocketDisconnected();
            this.client = undefined;

            this.events.emit('gameStopped');
            this.events.emit('clientDisconnected');
        });

        clientEvents.on('strengthChanged', () => {
            this.events.emit('strengthChanged', this.gameStrength);
        });
    }

    public async bindControllerSocket(socket: WebWSClient): Promise<void> {
        this.onlineSockets.add(socket.socketId);

        const socketEvents = this.eventStore.wrap(socket);
        socketEvents.on('close', () => {
            socketEvents.removeAllListeners();
            this.onlineSockets.delete(socket.socketId);
            this.handleSocketDisconnected();
        });
    }

    public async updateStrengthConfig(config: GameStrengthConfig): Promise<void> {
        const nextConfig = normalizeGameStrengthConfig(config);

        if (!simpleObjDiff(nextConfig, this.strengthConfig)) {
            return;
        }

        this.strengthConfig = nextConfig;
        this.strengthConfigModified = Date.now();
        const configCachePrefix = `coyoteLiveGameConfig:${this.clientId}:`;
        CoyoteGameManager.instance.configCache.set(`${configCachePrefix}:strength`, this.strengthConfig);
        await CoyoteGameConfigService.instance.set(this.clientId, PersistedGameConfigType.Strength, this.strengthConfig);

        this.events.emit('strengthConfigUpdated', this.strengthConfig);

        if (!this.client || !this.started) {
            return;
        }

        let shouldRestart = this.actionList.length > 0;
        for (const channelId of this.getEnabledChannels()) {
            const delta = this.strengthConfig[channelId].strength - this.getChannelClientStrength(channelId).strength;
            if (delta > 5) {
                shouldRestart = true;
                break;
            }
        }

        if (shouldRestart) {
            await this.restartGame();
            return;
        }

        await Promise.all(
            this.getEnabledChannels().map((channelId) => this.setChannelStrength(channelId, this.strengthConfig[channelId].strength))
        );
    }

    public async startAction(action: AbstractGameAction): Promise<void> {
        this.latencyLogger.start('action ' + action.constructor.name);

        let existsIndex = this.actionList.findIndex((a) => a.constructor === action.constructor);
        if (existsIndex >= 0) {
            const oldAction = this.actionList[existsIndex];
            oldAction.updateConfig(action.config);
            oldAction.priority = action.priority;
        } else {
            action._initialize(this);
            this.actionList.push(action);
        }

        this.actionList.sort((a, b) => b.priority - a.priority);

        if (this.started) {
            await this.refreshRunners();
        }
    }

    public async stopAction(action: AbstractGameAction): Promise<void> {
        const existsIndex = this.actionList.findIndex((a) => a.constructor === action.constructor);
        if (existsIndex >= 0) {
            this.actionList.splice(existsIndex, 1);

            if (this.started) {
                await this.refreshRunners();
            }
        }
    }

    private handleConfigUpdated(newGameConfig: MainGameConfig): void {
        const diffKeys = simpleObjDiff(newGameConfig, this.gameConfig);
        this.gameConfig = newGameConfig;

        if (!diffKeys) {
            return;
        }

        this.pulsePlayLists = this.createPulsePlayLists();

        if (this.started) {
            this.restartGame().catch((error) => {
                console.error('Failed to restart game:', error);
            });
        }
    }

    private createPulsePlayLists(): Record<GameChannelId, PulsePlayList> {
        return {
            a: this.createPulsePlayList('a'),
            b: this.createPulsePlayList('b'),
        };
    }

    private createPulsePlayList(channelId: GameChannelId): PulsePlayList {
        const channelConfig = this.getChannelConfig(channelId);
        const pulseList = typeof channelConfig.pulseId === 'string' ? [channelConfig.pulseId] : channelConfig.pulseId;
        return new PulsePlayList(pulseList, channelConfig.pulseMode, channelConfig.pulseChangeInterval);
    }

    public async setChannelStrength(channelId: GameChannelId, strength: number): Promise<void> {
        if (!this.client?.active) {
            return;
        }

        const channelStrength = this.getChannelClientStrength(channelId);
        const targetStrength = Math.min(Math.max(0, strength), channelStrength.limit);
        await this.client.setStrength(channelMap[channelId], targetStrength);
        this.strengthSetTime = Date.now();
    }

    private async runChannelTask(channelId: GameChannelId, ab: AbortController, harvest: () => void): Promise<void> {
        if (!this.client) {
            await this.stopGame();
            return;
        }

        const channelConfig = this.getChannelConfig(channelId);
        if (!channelConfig.enabled) {
            await this.setChannelStrength(channelId, 0);
            return;
        }

        const pulseId = this.pulsePlayLists[channelId].getCurrentPulseId();
        const strengthChangeInterval = channelConfig.strengthChangeInterval;
        const outputTime = randomInt(strengthChangeInterval[0], strengthChangeInterval[1]) * 1000;

        let targetStrength = this.strengthConfig[channelId].strength + randomInt(0, this.strengthConfig[channelId].randomStrength);
        targetStrength = Math.min(targetStrength, this.getChannelClientStrength(channelId).limit);

        let currentStrength = this.getChannelClientStrength(channelId).strength;
        if (targetStrength > currentStrength) {
            const setStrengthInterval = setInterval(() => {
                if (ab.signal.aborted) {
                    clearInterval(setStrengthInterval);
                    return;
                }

                this.setChannelStrength(channelId, currentStrength).catch((error) => {
                    console.error(`Failed to set ${channelId.toUpperCase()} channel strength:`, error);
                });

                if (currentStrength >= targetStrength) {
                    clearInterval(setStrengthInterval);
                }

                currentStrength = Math.min(currentStrength + 2, targetStrength);
            }, 200);
        } else {
            this.setChannelStrength(channelId, targetStrength).catch((error) => {
                console.error(`Failed to set ${channelId.toUpperCase()} channel strength:`, error);
            });
        }

        harvest();

        await this.client.outputPulse(channelMap[channelId], pulseId, outputTime, {
            abortController: ab,
            customPulseList: this.customPulseList,
        });
    }

    private async startDefaultChannelTasks(excludedChannels: Set<GameChannelId> = new Set()): Promise<void> {
        for (const channelId of gameChannelIdList) {
            const shouldRun = this.getChannelConfig(channelId).enabled && !excludedChannels.has(channelId);
            const existingTask = this.channelTasks[channelId];

            if (!shouldRun) {
                if (existingTask) {
                    delete this.channelTasks[channelId];
                    await existingTask.abort();
                }
                continue;
            }

            if (existingTask) {
                continue;
            }

            const task = new Task((ab, harvest) => this.runChannelTask(channelId, ab, harvest));
            task.on('error', (error) => {
                console.error(`Channel ${channelId.toUpperCase()} task error:`, error);
            });
            this.channelTasks[channelId] = task;
        }
    }

    private async stopDefaultChannelTasks(channelIds?: GameChannelId[]): Promise<void> {
        const targetChannelIds = channelIds ?? [...gameChannelIdList];

        for (const channelId of targetChannelIds) {
            const task = this.channelTasks[channelId];
            if (!task) {
                continue;
            }

            delete this.channelTasks[channelId];
            await task.abort();
        }
    }

    private startActionRunner(): void {
        if (!this.started || !this.actionList.length || this.actionRunner) {
            return;
        }

        const currentAction = this.actionList[0];
        const actionAb = new AbortController();
        const harvest = () => {
            if (actionAb.signal.aborted) {
                throw new TaskAbortedError();
            }
        };

        this.actionAbortController = actionAb;
        this.runningAction = currentAction;

        const runner = currentAction.execute(actionAb, harvest, () => {
            this.actionList.shift();
        }).then(() => {
            harvest();
        }).catch((error) => {
            if (!(error instanceof TaskAbortedError)) {
                console.error('Action runner error:', error);
            }
        }).finally(() => {
            if (this.actionAbortController === actionAb) {
                this.actionAbortController = null;
            }

            if (this.runningAction === currentAction) {
                this.runningAction = null;
            }

            if (this.actionRunner === runner) {
                this.actionRunner = null;
            }

            if (!this.started || actionAb.signal.aborted) {
                return;
            }

            this.refreshRunners().catch((error) => {
                console.error('Failed to refresh runners after action completed:', error);
            });
        });

        this.actionRunner = runner;
    }

    private async stopActionRunner(): Promise<void> {
        if (this.actionAbortController) {
            this.actionAbortController.abort();
        }

        if (this.actionRunner) {
            await this.actionRunner;
        }

        this.actionAbortController = null;
        this.actionRunner = null;
        this.runningAction = null;
    }

    private getCurrentActionOccupiedChannels(): Set<GameChannelId> {
        const currentAction = this.actionList[0];
        if (!currentAction) {
            return new Set();
        }

        return new Set(currentAction.getOccupiedChannels());
    }

    private async refreshRunners(): Promise<void> {
        if (!this.started || !this.client) {
            return;
        }

        const currentAction = this.actionList[0] ?? null;
        if (!currentAction || (this.runningAction && this.runningAction !== currentAction)) {
            await this.stopActionRunner();
        }

        const occupiedChannels = this.getCurrentActionOccupiedChannels();
        await this.startDefaultChannelTasks(occupiedChannels);

        if (!currentAction) {
            return;
        }

        if (!this.actionRunner) {
            this.startActionRunner();
        }
    }

    private async startRunners(): Promise<void> {
        await this.refreshRunners();
    }

    private async stopRunners(): Promise<void> {
        await this.stopActionRunner();
        await this.stopDefaultChannelTasks();
    }

    public async startGame(ignoreEvent = false): Promise<void> {
        if (!this.client || this.started) {
            return;
        }

        await this.client.reset();
        await Promise.all(gameChannelIdList.map((channelId) => this.setChannelStrength(channelId, 0)));
        this.resetTempStrength();

        this.started = true;
        await this.startRunners();

        if (!ignoreEvent) {
            this.events.emit('gameStarted');
        }
    }

    public async stopGame(ignoreEvent = false): Promise<void> {
        if (!this.started && !this.actionRunner && Object.keys(this.channelTasks).length === 0) {
            return;
        }

        this.started = false;
        await this.stopRunners();
        this.resetTempStrength();

        if (this.client?.active) {
            await Promise.all(gameChannelIdList.map((channelId) => this.setChannelStrength(channelId, 0)));
            await this.client.reset();
        }

        if (!ignoreEvent) {
            this.events.emit('gameStopped');
        }
    }

    public async restartGame(): Promise<void> {
        if (!this.client || !this.started) {
            return;
        }

        await this.stopRunners();
        await this.client.reset();
        this.pulsePlayLists = this.createPulsePlayLists();
        await this.startRunners();
        this.latencyLogger.finish();
    }

    public handleSocketDisconnected(): void {
        if (this.onlineSockets.size === 0) {
            this.destroy().catch((error) => {
                console.error('Failed to destroy CoyoteLiveGame:', error);
            });
        }
    }

    public async destroy(): Promise<void> {
        this.started = false;
        await this.stopRunners();

        this.events.emit('close');

        const configCachePrefix = `coyoteLiveGameConfig:${this.clientId}:`;
        const configCache = CoyoteGameManager.instance.configCache;
        configCache.set(`${configCachePrefix}:strength`, this.strengthConfig);

        this.eventStore.removeAllListeners();
        this.events.removeAllListeners();
    }

    public on = this.events.on.bind(this.events);
    public once = this.events.once.bind(this.events);
    public off = this.events.off.bind(this.events);
    public removeAllListeners = this.events.removeAllListeners.bind(this.events);
}
