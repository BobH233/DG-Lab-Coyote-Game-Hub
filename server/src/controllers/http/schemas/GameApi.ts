import {
    GameChannelConfigSchema,
    GameStrengthConfigSchema,
    MainGameConfigSchema,
    PulseIdSchema,
    PulsePlayModeSchema,
} from "#app/types/game.js";
import { z } from "koa-swagger-decorator";

const AutoCastInt = <Schema extends z.ZodNumber>(schema: Schema) => {
    return z.preprocess((value) => {
        switch (typeof value) {
            case "string":
                if (!/^-?\d+$/.test(value)) {
                    return value;
                }
                return parseInt(value, 10);
            default:
                return value;
        }
    }, schema);
};

const AutoCastBool = <Schema extends z.ZodBoolean>(schema: Schema) => {
    return z.preprocess((value) => {
        switch (typeof value) {
            case "string":
                switch (value.toLowerCase()) {
                    case 'true':
                    case '1':
                        return true;
                    case 'false':
                    case '0':
                        return false;
                    default:
                        return value;
                }
            case "number":
                if (value === 1) return true;
                if (value === 0) return false;
                return value;
            default:
                return value;
        }
    }, schema);
};

export const ClientIdSchema = z.union([
    z.string().describe('客户端ID'),
    z.enum(['all']).describe('所有客户端'),
]).describe('客户端ID');

export const ChannelStrengthInfoSchema = z.object({
    strength: z.number().int().min(0).max(200).describe('当前强度'),
    limit: z.number().int().min(0).max(200).describe('强度限制'),
    tempStrength: z.number().int().min(0).max(200).describe('临时附加强度'),
}).describe('通道强度信息');

export const GameStrengthInfoSchema = z.object({
    a: ChannelStrengthInfoSchema.describe('A通道实时强度'),
    b: ChannelStrengthInfoSchema.describe('B通道实时强度'),
}).describe('双通道实时强度信息');

export const ApiResponseSchema = z.object({
    status: z.number().int().describe('响应状态码，1表示成功，0表示失败'),
    code: z.string().describe('响应代码，标识具体的错误或状态'),
    message: z.string().optional().describe('可选的响应消息，提供额外信息'),
    warnings: z.array(z.object({
        code: z.string().describe('警告代码'),
        message: z.string().describe('警告消息')
    })).optional().describe('可选的警告列表'),
}).passthrough().describe('API响应格式');
export type ApiResponseType = z.infer<typeof ApiResponseSchema>;

export const GetGameApiInfoResponseSchema = ApiResponseSchema.extend({
    minApiVersion: z.number().int().describe('最小API版本号'),
    maxApiVersion: z.number().int().describe('最大API版本号'),
}).describe('获取游戏API信息响应格式');
export type GetGameApiInfoResponse = z.infer<typeof GetGameApiInfoResponseSchema>;

export const GameCurrentPulseResponseSchema = z.object({
    a: z.string().describe('A通道当前波形ID'),
    b: z.string().describe('B通道当前波形ID'),
}).describe('当前播放波形信息');

export const GamePulseConfigResponseSchema = z.object({
    a: PulseIdSchema.describe('A通道波形ID或ID列表'),
    b: PulseIdSchema.describe('B通道波形ID或ID列表'),
}).describe('双通道波形配置');

export const GetGameInfoResponseSchema = ApiResponseSchema.extend({
    strengthConfig: GameStrengthConfigSchema.optional().nullable().describe('游戏强度配置'),
    gameConfig: MainGameConfigSchema.optional().nullable().describe('游戏配置'),
    clientStrength: GameStrengthInfoSchema.optional().nullable().describe('客户端强度信息'),
    currentPulseId: GameCurrentPulseResponseSchema.optional().nullable().describe('当前波形ID'),
}).describe('获取游戏信息响应格式');
export type GetGameInfoResponse = z.infer<typeof GetGameInfoResponseSchema>;

export const GetGameStrengthConfigResponseSchema = ApiResponseSchema.extend({
    strengthConfig: GameStrengthConfigSchema.optional().nullable().describe('游戏强度配置'),
}).describe('获取游戏强度配置响应格式');
export type GetGameStrengthConfigResponse = z.infer<typeof GetGameStrengthConfigResponseSchema>;

export const GetGameConfigResponseSchema = ApiResponseSchema.extend({
    gameConfig: MainGameConfigSchema.optional().nullable().describe('游戏配置'),
}).describe('获取游戏主配置响应格式');
export type GetGameConfigResponse = z.infer<typeof GetGameConfigResponseSchema>;

export const ConnectGameRequestSchema = z.object({
    gameId: z.string().describe('游戏ID'),
}).describe('连接游戏请求格式');
export type ConnectGameRequest = z.infer<typeof ConnectGameRequestSchema>;

export const StrengthOperationSchema = z.object({
    add: AutoCastInt(z.number()).optional().describe('增加的强度'),
    sub: AutoCastInt(z.number()).optional().describe('减少的强度'),
    set: AutoCastInt(z.number()).optional().describe('设置的强度'),
}).describe('强度运算');
export type StrengthOperation = z.infer<typeof StrengthOperationSchema>;

export const ChannelStrengthUpdateSchema = z.object({
    strength: StrengthOperationSchema.optional().describe('基础强度配置'),
    randomStrength: StrengthOperationSchema.optional().describe('随机强度配置'),
}).describe('通道强度更新配置');
export type ChannelStrengthUpdate = z.infer<typeof ChannelStrengthUpdateSchema>;

export const SetStrengthConfigRequestSchema = z.object({
    channels: z.object({
        a: ChannelStrengthUpdateSchema.optional().describe('A通道强度更新'),
        b: ChannelStrengthUpdateSchema.optional().describe('B通道强度更新'),
    }).optional().describe('按通道更新强度'),
    strength: StrengthOperationSchema.optional().describe('兼容旧版的A通道基础强度更新'),
    randomStrength: StrengthOperationSchema.optional().describe('兼容旧版的A通道随机强度更新'),
}).describe('设置强度配置请求');
export type SetStrengthConfigRequest = z.infer<typeof SetStrengthConfigRequestSchema>;

export const SetConfigResponseSchema = ApiResponseSchema.extend({
    successClientIds: z.array(ClientIdSchema).describe('成功设置配置的客户端ID列表'),
}).describe('设置配置响应');
export type SetConfigResponse = z.infer<typeof SetConfigResponseSchema>;

export const GetPulseIdResponseSchema = ApiResponseSchema.extend({
    currentPulseId: GameCurrentPulseResponseSchema.describe('当前波形ID'),
    pulseId: GamePulseConfigResponseSchema.describe('波形ID或ID列表'),
}).describe('获取游戏当前波形ID和波形播放列表');
export type GetPulseIdResponse = z.infer<typeof GetPulseIdResponseSchema>;

export const SetPulseIdRequestSchema = z.object({
    channels: z.object({
        a: z.object({
            pulseId: PulseIdSchema.describe('A通道波形ID或ID列表'),
        }).optional(),
        b: z.object({
            pulseId: PulseIdSchema.describe('B通道波形ID或ID列表'),
        }).optional(),
    }).optional().describe('按通道设置波形ID'),
    pulseId: PulseIdSchema.optional()
        .describe('兼容旧版的A通道波形ID或ID列表'),
}).describe('设置波形ID请求');
export type SetPulseIdRequest = z.infer<typeof SetPulseIdRequestSchema>;

export const GetPulseListResponseSchema = ApiResponseSchema.extend({
    pulseList: z.array(z.object({
        id: z.string().describe('波形ID'),
        name: z.string().describe('波形名称'),
    })).describe('波形ID列表'),
});
export type GetPulseListResponse = z.infer<typeof GetPulseListResponseSchema>;

const ChannelGameConfigUpdateSchema = z.object({
    enabled: AutoCastBool(z.boolean()).optional().describe('是否启用该通道'),
    strengthChangeInterval: z.tuple([
        AutoCastInt(z.number().int().min(1).max(60)),
        AutoCastInt(z.number().int().min(1).max(60)),
    ]).refine(([min, max]) => min <= max, {
        message: '强度变化间隔的最小值不能大于最大值',
    }).optional().describe('强度变化间隔，单位秒'),
    fireStrengthLimit: AutoCastInt(z.number().int().min(1)).optional().describe('一键开火强度限制'),
    pulseId: PulseIdSchema.optional().describe('波形ID或ID列表'),
    firePulseId: z.string().nullable().optional().describe('一键开火波形ID'),
    pulseMode: PulsePlayModeSchema.optional().describe('波形播放模式'),
    pulseChangeInterval: AutoCastInt(z.number().int().min(1)).optional().describe('波形切换间隔，单位秒'),
}).describe('通道主配置更新');

export const UpdateGameConfigRequestSchema = z.object({
    channels: z.object({
        a: ChannelGameConfigUpdateSchema.optional().describe('A通道主配置更新'),
        b: ChannelGameConfigUpdateSchema.optional().describe('B通道主配置更新'),
    }).describe('双通道主配置更新'),
}).describe('设置游戏主配置请求');
export type UpdateGameConfigRequest = z.infer<typeof UpdateGameConfigRequestSchema>;

export const FireActionChannelRequestSchema = z.object({
    strength: AutoCastInt(z.number().int().min(0).max(200)).optional()
        .describe('该通道一键开火的强度'),
    pulseId: z.string().optional()
        .describe('该通道一键开火的波形ID'),
    enabled: AutoCastBool(z.boolean()).optional()
        .describe('是否在本次一键开火中启用该通道'),
}).describe('按通道覆盖一键开火参数');

export const StartFireActionRequestSchema = z.object({
    strength: AutoCastInt(z.number().int().min(0).max(200)).optional()
        .describe('所有通道共用的一键开火强度'),
    time: AutoCastInt(z.number().int().min(1)).optional()
        .describe('一键开火持续时间（毫秒）'),
    override: AutoCastBool(z.boolean()).optional().default(false)
        .describe('是否覆盖当前一键开火时间，为false时会累加时间'),
    pulseId: z.string().optional()
        .describe('所有通道共用的一键开火波形ID'),
    channels: z.object({
        a: FireActionChannelRequestSchema.optional().describe('A通道一键开火覆盖参数'),
        b: FireActionChannelRequestSchema.optional().describe('B通道一键开火覆盖参数'),
    }).optional().describe('按通道覆盖一键开火参数'),
}).describe('一键开火请求');

export type StartFireActionRequest = z.infer<typeof StartFireActionRequestSchema>;
