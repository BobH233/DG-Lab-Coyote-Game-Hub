import { Context } from 'koa';
import { RouterContext } from 'koa-router';
import { body, responses, routeConfig, z } from 'koa-swagger-decorator';

import { CoyoteGameManager } from '#app/managers/CoyoteGameManager.js';
import {
    GameChannelId,
    GameStrengthConfig,
    gameChannelIdList,
    MainGameConfig,
    MainGameConfigPatch,
} from '#app/types/game.js';
import { CoyoteGameController } from '../game/CoyoteGameController.js';
import { MainConfig } from '#app/config.js';
import { DGLabPulseService } from '#app/services/DGLabPulse.js';
import { asleep } from '#app/utils/utils.js';
import { FIRE_MAX_DURATION, FIRE_MAX_STRENGTH, GameFireAction } from '../game/actions/GameFireAction.js';
import {
    ChannelStrengthUpdate,
    ClientIdSchema,
    GetGameApiInfoResponse,
    GetGameApiInfoResponseSchema,
    GetGameConfigResponse,
    GetGameConfigResponseSchema,
    GetGameInfoResponse,
    GetGameInfoResponseSchema,
    GetGameStrengthConfigResponse,
    GetGameStrengthConfigResponseSchema,
    GetPulseIdResponse,
    GetPulseIdResponseSchema,
    GetPulseListResponse,
    GetPulseListResponseSchema,
    SetConfigResponse,
    SetConfigResponseSchema,
    SetPulseIdRequest,
    SetPulseIdRequestSchema,
    SetStrengthConfigRequest,
    SetStrengthConfigRequestSchema,
    StartFireActionRequest,
    StartFireActionRequestSchema,
    StrengthOperation,
    UpdateGameConfigRequest,
    UpdateGameConfigRequestSchema,
} from './schemas/GameApi.js';
import { GameModel } from '#app/models/GameModel.js';
import { CustomPulseModel } from '#app/models/CustomPulseModel.js';

export type ApiResponseType = {
    status: number;
    code: string;
    message?: string;
    warnings?: { code: string, message: string }[];
} & Record<string, any>;

type NormalizedStrengthUpdateRequest = {
    channels: Partial<Record<GameChannelId, ChannelStrengthUpdate>>;
};

type NormalizedPulseUpdateRequest = MainGameConfigPatch;

export function apiResponse(ctx: Context, data: ApiResponseType) {
    ctx.response.header['X-Api-Status'] = data.status;

    if (data.status === 0) {
        ctx.response.header['X-Api-Error-Code'] = data.code;
        ctx.response.header['X-Api-Error-Message'] = data.message;
    }

    if (data.warnings) {
        ctx.response.header['X-Api-Warning-Code'] = data.warnings.map(w => w.code).join(', ');
        ctx.response.header['X-Api-Warning-Message'] = data.warnings.map(w => w.message).join(', ');
    }

    ctx.body = data;
}

const cloneStrengthConfig = (config: GameStrengthConfig): GameStrengthConfig => JSON.parse(JSON.stringify(config));

const applyStrengthOperation = (currentValue: number, operation?: StrengthOperation): number => {
    if (!operation) {
        return currentValue;
    }

    if (typeof operation.add === 'number') {
        return currentValue + operation.add;
    }
    if (typeof operation.sub === 'number') {
        return currentValue - operation.sub;
    }
    if (typeof operation.set === 'number') {
        return operation.set;
    }

    return currentValue;
};

const normalizeStrengthUpdateRequest = (request: SetStrengthConfigRequest): NormalizedStrengthUpdateRequest => ({
    channels: {
        a: request.channels?.a ?? (request.strength || request.randomStrength ? {
            strength: request.strength,
            randomStrength: request.randomStrength,
        } : undefined),
        b: request.channels?.b,
    },
});

const normalizePulseUpdateRequest = (request: SetPulseIdRequest): NormalizedPulseUpdateRequest => ({
    channels: {
        ...(request.channels?.a || request.pulseId ? {
            a: {
                ...(request.channels?.a ?? {}),
                ...(request.pulseId ? { pulseId: request.pulseId } : {}),
            },
        } : {}),
        ...(request.channels?.b ? {
            b: request.channels.b,
        } : {}),
    },
});

const getConfiguredCurrentPulseId = (pulseId: string | string[]): string => {
    return typeof pulseId === 'string' ? pulseId : pulseId[0];
};

export class GameStrengthUpdateQueue {
    private queuedUpdates: Map<string, NormalizedStrengthUpdateRequest[]> = new Map();
    private runningQueue: Set<string> = new Set();

    public pushUpdate(clientId: string, update: NormalizedStrengthUpdateRequest) {
        if (!this.queuedUpdates.has(clientId)) {
            this.queuedUpdates.set(clientId, [update]);
        } else {
            this.queuedUpdates.get(clientId)!.push(update);
        }

        this.run(clientId);
    }

    public async run(clientId: string) {
        if (this.runningQueue.has(clientId)) {
            return;
        }

        this.runningQueue.add(clientId);
        while (this.queuedUpdates.get(clientId)) {
            const game = CoyoteGameManager.instance.getGame(clientId);
            if (!game) {
                this.queuedUpdates.delete(clientId);
                break;
            }

            const updates = this.queuedUpdates.get(clientId)!;
            const strengthConfig = cloneStrengthConfig(game.strengthConfig);
            let handledUpdateNum = 0;

            for (const update of updates) {
                for (const channelId of gameChannelIdList) {
                    const channelUpdate = update.channels[channelId];
                    if (!channelUpdate) {
                        continue;
                    }

                    strengthConfig[channelId].strength = applyStrengthOperation(
                        strengthConfig[channelId].strength,
                        channelUpdate.strength,
                    );
                    strengthConfig[channelId].randomStrength = applyStrengthOperation(
                        strengthConfig[channelId].randomStrength,
                        channelUpdate.randomStrength,
                    );
                }

                handledUpdateNum++;
            }

            updates.splice(0, handledUpdateNum);

            for (const channelId of gameChannelIdList) {
                const limit = game.getChannelClientStrength(channelId).limit;
                strengthConfig[channelId].strength = Math.min(Math.max(0, strengthConfig[channelId].strength), limit);
                strengthConfig[channelId].randomStrength = Math.max(0, strengthConfig[channelId].randomStrength);
            }

            try {
                await game.updateStrengthConfig(strengthConfig);
            } catch (err: any) {
                console.error(`[GameStrengthUpdateQueue] Error while updating game config: ${err.message}`);
            }

            if (updates.length === 0) {
                this.queuedUpdates.delete(clientId);
            }

            await asleep(50);
        }

        this.runningQueue.delete(clientId);
    }
}

export const gameStrengthUpdateQueue = new GameStrengthUpdateQueue();

export class GameApiController {
    private async requestGameInstance(ctx: RouterContext): Promise<CoyoteGameController | null> {
        if (!ctx.params.id) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::INVALID_CLIENT_ID',
                message: '无效的客户端ID',
            });
            return null;
        }

        const game = CoyoteGameManager.instance.getGame(ctx.params.id);
        if (!game) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::GAME_NOT_FOUND',
                message: '游戏进程不存在，可能是客户端未连接',
            });
            return null;
        }

        return game;
    }

    private requestBroadcastAllowed(ctx: RouterContext): boolean {
        if (!MainConfig.value.allowBroadcastToClients) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::BROADCAST_NOT_ALLOWED',
                message: '当前服务器配置不允许向所有客户端广播指令',
            });
            return false;
        }

        return true;
    }

    private async resolveGameTarget(ctx: RouterContext): Promise<{ clientId: string; game: CoyoteGameController | null } | null> {
        if (ctx.params.id === 'all') {
            if (!this.requestBroadcastAllowed(ctx)) {
                return null;
            }

            const game = CoyoteGameManager.instance.getGameList().next().value as CoyoteGameController | undefined;
            if (!game) {
                apiResponse(ctx, {
                    status: 0,
                    code: 'ERR::GAME_NOT_FOUND',
                    message: '游戏进程不存在，可能是客户端未连接',
                });
                return null;
            }

            return {
                clientId: game.clientId,
                game,
            };
        }

        const game = await this.requestGameInstance(ctx);
        if (!game) {
            return null;
        }

        return {
            clientId: ctx.params.id,
            game,
        };
    }

    private async resolveTargetClientIds(ctx: RouterContext): Promise<string[] | null> {
        if (!ctx.params.id) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::INVALID_CLIENT_ID',
                message: '无效的客户端ID',
            });
            return null;
        }

        if (ctx.params.id === 'all') {
            if (!this.requestBroadcastAllowed(ctx)) {
                return null;
            }

            const gameList = CoyoteGameManager.instance.getGameList();
            return Array.from(gameList, (game) => game.clientId);
        }

        return [ctx.params.id];
    }

    private async validatePulseIds(ctx: RouterContext, clientId: string, pulseId: string | string[]): Promise<string | null> {
        const pulseIds = typeof pulseId === 'string' ? [pulseId] : pulseId;
        const pulseSet = new Set(DGLabPulseService.instance.pulseList.map((pulse) => pulse.id));

        const customPulseList = await CustomPulseModel.getPulseListByGameId(ctx.database, clientId);
        customPulseList.forEach((pulse) => pulseSet.add(pulse.id));

        const invalidPulseId = pulseIds.find((id) => !pulseSet.has(id));
        return invalidPulseId ?? null;
    }

    @routeConfig({
        method: 'get',
        path: '/api/game',
        summary: '获取游戏API信息',
        operationId: 'Get Game API Info',
        tags: ['Game V1'],
    })
    @responses(GetGameApiInfoResponseSchema)
    public async gameApiInfo(ctx: RouterContext): Promise<void> {
        apiResponse(ctx, {
            status: 1,
            code: 'OK',
            message: 'Coyote Live 游戏API',
            minApiVersion: 1,
            maxApiVersion: 2,
        } as GetGameApiInfoResponse);
    }

    @routeConfig({
        method: 'get',
        path: '/api/v2/game',
        summary: '获取游戏API信息',
        operationId: 'Get Game API Info V2',
        tags: ['Game V2'],
    })
    @responses(GetGameApiInfoResponseSchema)
    public async gameApiInfoV2(ctx: RouterContext): Promise<void> {
        return await this.gameApiInfo(ctx);
    }

    @routeConfig({
        method: 'get',
        path: '/api/game/{id}',
        summary: '获取游戏信息',
        operationId: 'Get Game Info',
        tags: ['Game V1'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @responses(GetGameInfoResponseSchema)
    public async gameInfo(ctx: RouterContext): Promise<void> {
        const target = await this.resolveGameTarget(ctx);
        if (!target) {
            return;
        }

        const gameConfigModel = await GameModel.getByGameId(ctx.database, target.clientId);
        const gameConfig = gameConfigModel?.toMainGameConfig() ?? null;

        apiResponse(ctx, {
            status: 1,
            code: 'OK',
            strengthConfig: target.game?.strengthConfig ?? null,
            gameConfig,
            clientStrength: target.game?.gameStrength ?? null,
            currentPulseId: target.game?.getCurrentPulseIds() ?? (gameConfig ? {
                a: getConfiguredCurrentPulseId(gameConfig.channels.a.pulseId),
                b: getConfiguredCurrentPulseId(gameConfig.channels.b.pulseId),
            } : null),
        } as GetGameInfoResponse);
    }

    @routeConfig({
        method: 'get',
        path: '/api/v2/game/{id}',
        summary: '获取游戏信息',
        operationId: 'Get Game Info V2',
        tags: ['Game V2'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @responses(GetGameInfoResponseSchema)
    public async gameInfoV2(ctx: RouterContext): Promise<void> {
        return await this.gameInfo(ctx);
    }

    @routeConfig({
        method: 'get',
        path: '/api/game/{id}/strength_config',
        summary: '获取游戏强度配置',
        operationId: 'Get Game Strength Info',
        tags: ['Game V1'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @responses(GetGameStrengthConfigResponseSchema)
    public async getGameStrength(ctx: RouterContext): Promise<void> {
        const target = await this.resolveGameTarget(ctx);
        if (!target?.game) {
            if (target) {
                apiResponse(ctx, {
                    status: 0,
                    code: 'ERR::GAME_NOT_FOUND',
                    message: '游戏进程不存在，可能是客户端未连接',
                });
            }
            return;
        }

        apiResponse(ctx, {
            status: 1,
            code: 'OK',
            strengthConfig: target.game.strengthConfig,
        } as GetGameStrengthConfigResponse);
    }

    @routeConfig({
        method: 'get',
        path: '/api/v2/game/{id}/strength',
        summary: '获取游戏强度配置',
        operationId: 'Get Game Strength Info V2',
        tags: ['Game V2'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @responses(GetGameStrengthConfigResponseSchema)
    public async getGameStrengthV2(ctx: RouterContext): Promise<void> {
        return await this.getGameStrength(ctx);
    }

    @routeConfig({
        method: 'get',
        path: '/api/v2/game/{id}/config',
        summary: '获取游戏主配置',
        operationId: 'Get Game Config V2',
        tags: ['Game V2'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @responses(GetGameConfigResponseSchema)
    public async getGameConfigV2(ctx: RouterContext): Promise<void> {
        const target = await this.resolveGameTarget(ctx);
        if (!target) {
            return;
        }

        const gameConfigModel = await GameModel.getByGameId(ctx.database, target.clientId);
        if (!gameConfigModel) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::GAME_NOT_FOUND',
                message: '游戏配置不存在，可能是客户端未连接',
            });
            return;
        }

        apiResponse(ctx, {
            status: 1,
            code: 'OK',
            gameConfig: gameConfigModel.toMainGameConfig(),
        } as GetGameConfigResponse);
    }

    @routeConfig({
        method: 'post',
        path: '/api/game/{id}/strength_config',
        summary: '设置游戏强度配置',
        operationId: 'Set Game Strength Info',
        tags: ['Game V1'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @body(SetStrengthConfigRequestSchema)
    @responses(SetConfigResponseSchema)
    public async setGameStrength(ctx: RouterContext): Promise<void> {
        let postBody: SetStrengthConfigRequest;
        try {
            postBody = SetStrengthConfigRequestSchema.parse(ctx.request.body);
        } catch (err: any) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::INVALID_REQUEST',
                message: `无效的请求，参数错误: ${err.message}`,
            });
            return;
        }

        if (!postBody.strength && !postBody.randomStrength && !postBody.channels?.a && !postBody.channels?.b) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::INVALID_REQUEST',
                message: '无效的请求，至少需要提供一个通道的强度更新参数',
            });
            return;
        }

        const clientIdList = await this.resolveTargetClientIds(ctx);
        if (!clientIdList) {
            return;
        }

        const normalizedRequest = normalizeStrengthUpdateRequest(postBody);
        const successClientIds = new Set<string>();

        for (const clientId of clientIdList) {
            const game = CoyoteGameManager.instance.getGame(clientId);
            if (!game) {
                continue;
            }

            gameStrengthUpdateQueue.pushUpdate(game.clientId, normalizedRequest);
            successClientIds.add(game.clientId);
        }

        apiResponse(ctx, {
            status: 1,
            code: 'OK',
            message: `成功设置了 ${successClientIds.size} 个游戏的强度配置`,
            successClientIds: Array.from(successClientIds),
        } as SetConfigResponse);
    }

    @routeConfig({
        method: 'post',
        path: '/api/v2/game/{id}/strength',
        summary: '设置游戏强度配置',
        operationId: 'Set Game Strength Info V2',
        tags: ['Game V2'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @body(SetStrengthConfigRequestSchema)
    @responses(SetConfigResponseSchema)
    public async setGameStrengthV2(ctx: RouterContext): Promise<void> {
        return await this.setGameStrength(ctx);
    }

    @routeConfig({
        method: 'post',
        path: '/api/v2/game/{id}/config',
        summary: '设置游戏主配置',
        operationId: 'Set Game Config V2',
        tags: ['Game V2'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @body(UpdateGameConfigRequestSchema)
    @responses(SetConfigResponseSchema)
    public async setGameConfigV2(ctx: RouterContext): Promise<void> {
        let postBody: UpdateGameConfigRequest;
        try {
            postBody = UpdateGameConfigRequestSchema.parse(ctx.request.body);
        } catch (err: any) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::INVALID_REQUEST',
                message: `无效的请求，参数错误: ${err.message}`,
            });
            return;
        }

        const clientIdList = await this.resolveTargetClientIds(ctx);
        if (!clientIdList) {
            return;
        }

        const successClientIds = new Set<string>();
        for (const clientId of clientIdList) {
            await GameModel.updateConfig(ctx.database, clientId, postBody);
            successClientIds.add(clientId);
        }

        apiResponse(ctx, {
            status: 1,
            code: 'OK',
            message: `成功设置了 ${successClientIds.size} 个游戏的主配置`,
            successClientIds: Array.from(successClientIds),
        } as SetConfigResponse);
    }

    @routeConfig({
        method: 'get',
        path: '/api/game/{id}/pulse_id',
        summary: '获取游戏当前波形ID和波形播放列表',
        operationId: 'Get Game Pulse ID',
        tags: ['Game V1'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @responses(GetPulseIdResponseSchema)
    public async getPulseId(ctx: RouterContext): Promise<void> {
        const target = await this.resolveGameTarget(ctx);
        if (!target) {
            return;
        }

        const gameConfigModel = await GameModel.getByGameId(ctx.database, target.clientId);
        if (!gameConfigModel) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::GAME_NOT_FOUND',
                message: '游戏配置不存在，可能是控制器未连接',
            });
            return;
        }

        const gameConfig = gameConfigModel.toMainGameConfig();
        const currentPulseId = target.game?.getCurrentPulseIds() ?? {
            a: getConfiguredCurrentPulseId(gameConfig.channels.a.pulseId),
            b: getConfiguredCurrentPulseId(gameConfig.channels.b.pulseId),
        };

        apiResponse(ctx, {
            status: 1,
            code: 'OK',
            currentPulseId,
            pulseId: {
                a: gameConfig.channels.a.pulseId,
                b: gameConfig.channels.b.pulseId,
            },
        } as GetPulseIdResponse);
    }

    @routeConfig({
        method: 'get',
        path: '/api/v2/game/{id}/pulse',
        summary: '获取游戏当前波形ID和波形播放列表',
        operationId: 'Get Game Pulse ID V2',
        tags: ['Game V2'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @responses(GetPulseIdResponseSchema)
    public async getPulseIdV2(ctx: RouterContext): Promise<void> {
        return await this.getPulseId(ctx);
    }

    @routeConfig({
        method: 'post',
        path: '/api/game/{id}/pulse_id',
        summary: '设置游戏波形播放列表',
        operationId: 'Set Game Pulse ID',
        tags: ['Game V1'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @body(SetPulseIdRequestSchema)
    @responses(SetConfigResponseSchema)
    public async setPulseId(ctx: RouterContext): Promise<void> {
        let postBody: SetPulseIdRequest;
        try {
            postBody = SetPulseIdRequestSchema.parse(ctx.request.body);
        } catch (err: any) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::INVALID_REQUEST',
                message: `无效的请求，参数错误: ${err.message}`,
            });
            return;
        }

        if (!postBody.pulseId && !postBody.channels?.a && !postBody.channels?.b) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::INVALID_REQUEST',
                message: '无效的请求，至少需要提供一个通道的波形配置',
            });
            return;
        }

        const clientIdList = await this.resolveTargetClientIds(ctx);
        if (!clientIdList) {
            return;
        }

        const updateConfig = normalizePulseUpdateRequest(postBody);
        if (ctx.params.id !== 'all') {
            const channels = (updateConfig.channels ?? {}) as Partial<Record<GameChannelId, { pulseId: string | string[] }>>;
            for (const channelId of gameChannelIdList) {
                const pulseId = channels[channelId]?.pulseId;
                if (!pulseId) {
                    continue;
                }

                const invalidPulseId = await this.validatePulseIds(ctx, clientIdList[0], pulseId);
                if (invalidPulseId) {
                    apiResponse(ctx, {
                        status: 0,
                        code: 'ERR::INVALID_REQUEST',
                        message: `波形 ${invalidPulseId} 不存在`,
                    });
                    return;
                }
            }
        }

        const successClientIds = new Set<string>();
        for (const clientId of clientIdList) {
            await GameModel.updateConfig(ctx.database, clientId, updateConfig);
            successClientIds.add(clientId);
        }

        apiResponse(ctx, {
            status: 1,
            code: 'OK',
            message: `成功设置了 ${successClientIds.size} 个游戏的波形ID`,
            successClientIds: Array.from(successClientIds),
        } as SetConfigResponse);
    }

    @routeConfig({
        method: 'post',
        path: '/api/v2/game/{id}/pulse',
        summary: '设置游戏波形播放列表',
        operationId: 'Set Game Pulse ID V2',
        tags: ['Game V2'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @body(SetPulseIdRequestSchema)
    @responses(SetConfigResponseSchema)
    public async setPulseIdV2(ctx: RouterContext): Promise<void> {
        return await this.setPulseId(ctx);
    }

    @routeConfig({
        method: 'get',
        path: '/api/game/{id}/pulse_list',
        summary: '获取游戏波形列表',
        operationId: 'Get Game Pulse List',
        tags: ['Game V1'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @responses(GetPulseListResponseSchema)
    public async getPulseList(ctx: RouterContext): Promise<void> {
        let pulseList: any[] = DGLabPulseService.instance.pulseList;

        if (ctx.params.id && ctx.params.id !== 'all') {
            const customPulseList = await CustomPulseModel.getPulseListByGameId(ctx.database, ctx.params.id);
            if (customPulseList) {
                for (const pulse of customPulseList) {
                    pulseList.push(pulse.getBasePulseData());
                }
            }
        }

        const isFullMode = ctx.request.query?.type === 'full';
        if (!isFullMode) {
            pulseList = pulseList.map(pulse => ({
                id: pulse.id,
                name: pulse.name,
            }));
        }

        apiResponse(ctx, {
            status: 1,
            code: 'OK',
            pulseList,
        } as GetPulseListResponse);
    }

    @routeConfig({
        method: 'get',
        path: '/api/v2/game/{id}/pulse_list',
        summary: '获取游戏波形列表',
        operationId: 'Get Game Pulse List V2',
        tags: ['Game V2'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        }
    })
    @responses(GetPulseListResponseSchema)
    public async getPulseListV2(ctx: RouterContext): Promise<void> {
        return await this.getPulseList(ctx);
    }

    @routeConfig({
        method: 'post',
        path: '/api/game/{id}/fire',
        summary: '一键开火',
        operationId: 'Start Action Fire',
        tags: ['Game V1'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        },
    })
    @body(StartFireActionRequestSchema)
    @responses(SetConfigResponseSchema)
    public async startActionFire(ctx: RouterContext): Promise<void> {
        let postBody: StartFireActionRequest;
        try {
            postBody = await StartFireActionRequestSchema.parseAsync(ctx.request.body);
        } catch (err: any) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::INVALID_REQUEST',
                message: `无效的请求，参数错误: ${err.message}`,
            });
            return;
        }

        if (
            typeof postBody.strength !== 'number'
            && typeof postBody.channels?.a?.strength !== 'number'
            && typeof postBody.channels?.b?.strength !== 'number'
        ) {
            apiResponse(ctx, {
                status: 0,
                code: 'ERR::INVALID_REQUEST',
                message: '无效的请求，至少需要提供一个通道的一键开火强度',
            });
            return;
        }

        const warnings: { code: string, message: string }[] = [];
        const allStrengths = [
            postBody.strength,
            postBody.channels?.a?.strength,
            postBody.channels?.b?.strength,
        ].filter((value): value is number => typeof value === 'number');

        if (allStrengths.some((value) => value > FIRE_MAX_STRENGTH)) {
            warnings.push({
                code: 'WARN::INVALID_STRENGTH',
                message: `一键开火强度值不能超过 ${FIRE_MAX_STRENGTH}`,
            });
        }

        const fireTime = postBody.time ?? 5000;
        if (fireTime > FIRE_MAX_DURATION) {
            warnings.push({
                code: 'WARN::INVALID_TIME',
                message: `一键开火时间不能超过 ${FIRE_MAX_DURATION}ms`,
            });
        }

        const clientIdList = await this.resolveTargetClientIds(ctx);
        if (!clientIdList) {
            return;
        }

        const successClientIds = new Set<string>();
        for (const clientId of clientIdList) {
            const game = CoyoteGameManager.instance.getGame(clientId);
            if (!game) {
                continue;
            }

            const fireAction = new GameFireAction({
                strength: postBody.strength,
                time: fireTime,
                pulseId: postBody.pulseId,
                channels: postBody.channels,
                updateMode: postBody.override ? 'replace' : 'append',
            });
            await game.startAction(fireAction);
            successClientIds.add(game.clientId);
        }

        apiResponse(ctx, {
            status: 1,
            code: 'OK',
            message: `成功向 ${successClientIds.size} 个游戏发送了一键开火指令`,
            successClientIds: Array.from(successClientIds),
            warnings,
        } as SetConfigResponse);
    }

    @routeConfig({
        method: 'post',
        path: '/api/v2/game/{id}/action/fire',
        summary: '一键开火',
        operationId: 'Start Action Fire V2',
        tags: ['Game V2'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        },
    })
    @body(StartFireActionRequestSchema)
    @responses(SetConfigResponseSchema)
    public async startActionFireV2(ctx: RouterContext): Promise<void> {
        return await this.startActionFire(ctx);
    }

    @routeConfig({
        method: 'post',
        path: '/api/v2/game/{id}/gameplay/init',
        summary: '初始化游戏插件',
        operationId: 'Init Game Play V2',
        tags: ['Game Play V2'],
        request: {
            params: z.object({
                id: ClientIdSchema,
            }),
        },
    })
    @body(StartFireActionRequestSchema)
    @responses(SetConfigResponseSchema)
    public async initGameV2(ctx: RouterContext): Promise<void> {
    }
}
