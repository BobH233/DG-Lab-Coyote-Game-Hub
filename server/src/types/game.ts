import { z } from 'koa-swagger-decorator';

export enum GameConfigType {
    MainGame = 'main-game',
    CustomPulse = 'custom-pulse',
}

export const gameChannelIdList = ['a', 'b'] as const;
export const GameChannelIdSchema = z.enum(gameChannelIdList);
export type GameChannelId = z.infer<typeof GameChannelIdSchema>;

export const PulsePlayModeSchema = z.enum(['single', 'sequence', 'random']);
export type PulsePlayMode = z.infer<typeof PulsePlayModeSchema>;

export const PulseIdSchema = z.union([z.string(), z.array(z.string())]);
export type PulseId = z.infer<typeof PulseIdSchema>;

export const GameChannelStrengthConfigSchema = z.object({
    strength: z.number().int().min(0).max(100).describe('基础强度'),
    randomStrength: z.number().int().min(0).max(100).describe('随机强度'),
}).describe('通道强度配置');
export type GameChannelStrengthConfig = z.infer<typeof GameChannelStrengthConfigSchema>;

export const GameStrengthConfigSchema = z.object({
    a: GameChannelStrengthConfigSchema.describe('A通道强度配置'),
    b: GameChannelStrengthConfigSchema.describe('B通道强度配置'),
}).describe('双通道强度配置');
export type GameStrengthConfig = z.infer<typeof GameStrengthConfigSchema>;

export const StrengthChangeIntervalSchema = z.tuple([
    z.number().int().min(1).max(60),
    z.number().int().min(1).max(60),
]).refine(([min, max]) => min <= max, {
    message: '强度变化间隔的最小值不能大于最大值',
}).describe('强度变化间隔，单位秒');

export const GameChannelConfigSchema = z.object({
    enabled: z.boolean().default(true).describe('是否启用该通道'),
    strengthChangeInterval: StrengthChangeIntervalSchema,
    fireStrengthLimit: z.number().int().min(1).default(30)
        .describe('一键开火强度限制，默认30'),
    pulseId: PulseIdSchema.describe('波形ID或ID列表'),
    firePulseId: z.string().optional().nullable()
        .describe('一键开火波形ID，如果不设置则使用当前波形'),
    pulseMode: PulsePlayModeSchema.default('single')
        .describe('波形播放模式'),
    pulseChangeInterval: z.number().int().min(1).default(60)
        .describe('波形切换间隔，单位秒'),
}).describe('通道游戏配置');
export type GameChannelConfig = z.infer<typeof GameChannelConfigSchema>;

export const MainGameConfigSchema = z.object({
    channels: z.object({
        a: GameChannelConfigSchema.describe('A通道配置'),
        b: GameChannelConfigSchema.describe('B通道配置'),
    }).describe('双通道配置'),
}).describe('游戏主配置');
export type MainGameConfig = z.infer<typeof MainGameConfigSchema>;
export type MainGameConfigPatch = {
    channels?: Partial<Record<GameChannelId, Partial<GameChannelConfig>>>;
};

export const PulseDataSchema = z.object({
    id: z.string().describe('波形ID'),
    name: z.string().describe('波形名称'),
    pulseData: z.array(z.string()).describe('波形数据'),
}).describe('波形数据');
export type PulseData = z.infer<typeof PulseDataSchema>;

export const GameCustomPulseConfigSchema = z.object({
    customPulseList: z.array(PulseDataSchema).describe('自定义波形列表'),
}).describe('游戏自定义波形配置');
export type GameCustomPulseConfig = z.infer<typeof GameCustomPulseConfigSchema>;

type AnyRecord = Record<string, any>;

const omitUndefined = <T extends AnyRecord>(value: T): Partial<T> => {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined)
    ) as Partial<T>;
};

export const createDefaultChannelStrengthConfig = (): GameChannelStrengthConfig => ({
    strength: 5,
    randomStrength: 5,
});

export const createDefaultGameStrengthConfig = (): GameStrengthConfig => ({
    a: createDefaultChannelStrengthConfig(),
    b: createDefaultChannelStrengthConfig(),
});

export const createDefaultChannelConfig = (
    defaultPulseId: string,
    overrides: Partial<GameChannelConfig> = {},
): GameChannelConfig => ({
    enabled: true,
    strengthChangeInterval: [15, 30],
    fireStrengthLimit: 30,
    pulseId: defaultPulseId,
    firePulseId: null,
    pulseMode: 'single',
    pulseChangeInterval: 60,
    ...overrides,
});

export const createDefaultMainGameConfig = (defaultPulseId: string): MainGameConfig => ({
    channels: {
        a: createDefaultChannelConfig(defaultPulseId, {
            enabled: true,
        }),
        b: createDefaultChannelConfig(defaultPulseId, {
            enabled: false,
        }),
    },
});

export const normalizeGameStrengthConfig = (value: any): GameStrengthConfig => {
    const defaults = createDefaultGameStrengthConfig();

    const normalized = {
        a: {
            ...defaults.a,
            ...(value?.a ?? {}),
        },
        b: {
            ...defaults.b,
            ...(value?.b ?? {}),
        },
    };

    if (typeof value?.strength === 'number') {
        normalized.a.strength = value.strength;
    }
    if (typeof value?.randomStrength === 'number') {
        normalized.a.randomStrength = value.randomStrength;
    }
    if (typeof value?.bStrength === 'number') {
        normalized.b.strength = value.bStrength;
    }
    if (typeof value?.bRandomStrength === 'number') {
        normalized.b.randomStrength = value.bRandomStrength;
    }

    const hasLegacyA = typeof value?.strength === 'number' || typeof value?.randomStrength === 'number';
    const hasExplicitB = Boolean(value?.b) || typeof value?.bStrength === 'number' || typeof value?.bRandomStrength === 'number';
    if (hasLegacyA && !hasExplicitB) {
        normalized.b = {
            ...normalized.a,
        };
    }

    return GameStrengthConfigSchema.parse(normalized);
};

export const normalizeMainGameConfig = (value: any, defaultPulseId: string): MainGameConfig => {
    const defaults = createDefaultMainGameConfig(defaultPulseId);

    const legacyA = omitUndefined({
        strengthChangeInterval: value?.strengthChangeInterval,
        fireStrengthLimit: value?.fireStrengthLimit,
        pulseId: value?.pulseId,
        firePulseId: value?.firePulseId,
        pulseMode: value?.pulseMode,
        pulseChangeInterval: value?.pulseChangeInterval,
    });

    const legacyB = omitUndefined({
        enabled: value?.enableBChannel,
        strengthChangeInterval: value?.bStrengthChangeInterval ?? value?.strengthChangeInterval,
        fireStrengthLimit: value?.bFireStrengthLimit ?? value?.fireStrengthLimit,
        pulseId: value?.bPulseId ?? value?.pulseId,
        firePulseId: value?.bFirePulseId ?? value?.firePulseId,
        pulseMode: value?.bPulseMode ?? value?.pulseMode,
        pulseChangeInterval: value?.bPulseChangeInterval ?? value?.pulseChangeInterval,
    });

    const normalized = {
        channels: {
            a: {
                ...defaults.channels.a,
                ...legacyA,
                ...(value?.aChannelConfig ?? {}),
                ...(value?.channels?.a ?? {}),
                enabled: true,
            },
            b: {
                ...defaults.channels.b,
                ...legacyB,
                ...(value?.bChannelConfig ?? {}),
                ...(value?.channels?.b ?? {}),
            },
        },
    };

    if (!value?.channels?.b && !value?.bChannelConfig && value?.enableBChannel) {
        normalized.channels.b.pulseId = normalized.channels.b.pulseId ?? normalized.channels.a.pulseId;
        normalized.channels.b.firePulseId = normalized.channels.b.firePulseId ?? normalized.channels.a.firePulseId;
        normalized.channels.b.pulseMode = normalized.channels.b.pulseMode ?? normalized.channels.a.pulseMode;
        normalized.channels.b.pulseChangeInterval = normalized.channels.b.pulseChangeInterval ?? normalized.channels.a.pulseChangeInterval;
        normalized.channels.b.strengthChangeInterval = normalized.channels.b.strengthChangeInterval ?? normalized.channels.a.strengthChangeInterval;
        normalized.channels.b.fireStrengthLimit = normalized.channels.b.fireStrengthLimit ?? normalized.channels.a.fireStrengthLimit;
    }

    return MainGameConfigSchema.parse(normalized);
};

export const mergeMainGameConfig = (baseConfig: MainGameConfig, patch: MainGameConfigPatch, defaultPulseId: string): MainGameConfig => {
    return normalizeMainGameConfig({
        ...baseConfig,
        ...patch,
        channels: {
            a: {
                ...baseConfig.channels.a,
                ...(patch.channels?.a ?? {}),
            },
            b: {
                ...baseConfig.channels.b,
                ...(patch.channels?.b ?? {}),
            },
        },
    }, defaultPulseId);
};
