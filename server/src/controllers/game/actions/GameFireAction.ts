import { Channel } from "#app/types/dg.js";
import { GameChannelId, gameChannelIdList } from "#app/types/game.js";
import { AbstractGameAction } from "./AbstractGameAction.js";

export type GameFireActionChannelConfig = {
    strength?: number;
    pulseId?: string;
    enabled?: boolean;
};

export type GameFireActionConfig = {
    /** 一键开火的强度 */
    strength?: number;
    /** 一键开火的持续时间（毫秒） */
    time: number;
    /** 指定所有通道使用相同波形ID */
    pulseId?: string;
    /** 按通道覆盖一键开火参数 */
    channels?: Partial<Record<GameChannelId, GameFireActionChannelConfig>>;
    /** 重复操作的模式 */
    updateMode: "replace" | "append";
};

type FireChannelState = {
    enabled: boolean;
    fireStrength: number;
    currentFireStrength: number;
    firePulseId: string;
};

export const SAFE_FIRE_STRENGTH = 30;
export const FIRE_BOOST_STRENGTH = 5;

export const FIRE_MAX_STRENGTH = 200;
export const FIRE_MAX_DURATION = 300000;

const channelMap: Record<GameChannelId, Channel> = {
    a: Channel.A,
    b: Channel.B,
};

export class GameFireAction extends AbstractGameAction<GameFireActionConfig> {
    public static readonly actionId = "fire";
    public static readonly actionName = "一键开火";

    /** 一键开火结束时间 */
    public fireEndTimestamp: number = 0;

    private fireChannels: Record<GameChannelId, FireChannelState> = {
        a: {
            enabled: false,
            fireStrength: 0,
            currentFireStrength: 0,
            firePulseId: '',
        },
        b: {
            enabled: false,
            fireStrength: 0,
            currentFireStrength: 0,
            firePulseId: '',
        },
    };

    initialize() {
        this.fireEndTimestamp = Date.now() + Math.min(this.config.time, FIRE_MAX_DURATION);
        this.refreshFireChannels();
    }

    private refreshFireChannels(): void {
        for (const channelId of gameChannelIdList) {
            const channelConfig = this.game.getChannelConfig(channelId);
            const overrideConfig = this.config.channels?.[channelId] ?? {};
            const enabled = channelConfig.enabled && overrideConfig.enabled !== false;

            const requestedStrength = overrideConfig.strength ?? this.config.strength ?? channelConfig.fireStrengthLimit;
            const fireStrength = Math.min(requestedStrength, channelConfig.fireStrengthLimit || FIRE_MAX_STRENGTH);

            const firePulseId = overrideConfig.pulseId
                || this.config.pulseId
                || channelConfig.firePulseId
                || this.game.getCurrentPulseId(channelId);

            this.fireChannels[channelId] = {
                enabled,
                fireStrength,
                currentFireStrength: Math.min(fireStrength, SAFE_FIRE_STRENGTH),
                firePulseId,
            };

            this.game.setTempStrength(
                channelId,
                enabled ? Math.min(fireStrength, SAFE_FIRE_STRENGTH) : 0,
            );
        }
    }

    private getEnabledChannels(): GameChannelId[] {
        return gameChannelIdList.filter((channelId) => this.fireChannels[channelId].enabled && this.fireChannels[channelId].fireStrength > 0);
    }

    private async applyCurrentFireStrength(channelId: GameChannelId): Promise<void> {
        const fireState = this.fireChannels[channelId];
        const baseStrength = this.game.strengthConfig[channelId].strength;
        const limit = this.game.getChannelClientStrength(channelId).limit;
        const absoluteStrength = Math.min(baseStrength + fireState.currentFireStrength, limit);
        await this.game.setChannelStrength(channelId, absoluteStrength);
    }

    private async restoreBaseStrength(): Promise<void> {
        await Promise.all(
            gameChannelIdList.map(async (channelId) => {
                this.game.setTempStrength(channelId, 0);
                await this.game.setChannelStrength(channelId, this.game.strengthConfig[channelId].strength);
            })
        );
    }

    async execute(ab: AbortController, harvest: () => void, done: () => void): Promise<void> {
        const enabledChannels = this.getEnabledChannels();
        if (enabledChannels.length === 0) {
            done();
            return;
        }

        for (const channelId of enabledChannels) {
            const fireState = this.fireChannels[channelId];
            fireState.currentFireStrength = Math.min(fireState.fireStrength, SAFE_FIRE_STRENGTH);
            this.game.setTempStrength(channelId, fireState.currentFireStrength);
        }

        await Promise.all(enabledChannels.map((channelId) => this.applyCurrentFireStrength(channelId)));

        const boostAb = new AbortController();
        ab.signal.addEventListener('abort', () => {
            boostAb.abort();
        });

        const setStrengthInterval = setInterval(() => {
            if (boostAb.signal.aborted) {
                clearInterval(setStrengthInterval);
                return;
            }

            for (const channelId of enabledChannels) {
                const fireState = this.fireChannels[channelId];
                if (fireState.currentFireStrength >= fireState.fireStrength) {
                    continue;
                }

                fireState.currentFireStrength = Math.min(
                    fireState.currentFireStrength + FIRE_BOOST_STRENGTH,
                    fireState.fireStrength,
                );
                this.game.setTempStrength(channelId, fireState.currentFireStrength);
                this.applyCurrentFireStrength(channelId).catch((error) => {
                    console.error(`Failed to apply ${channelId.toUpperCase()} fire strength:`, error);
                });
            }
        }, 200);

        const outputTime = Math.min(this.fireEndTimestamp - Date.now(), 30000);
        await Promise.all(
            enabledChannels.map((channelId) => {
                const fireState = this.fireChannels[channelId];
                return this.game.client?.outputPulse(channelMap[channelId], fireState.firePulseId, outputTime, {
                    abortController: ab,
                });
            })
        );

        boostAb.abort();
        clearInterval(setStrengthInterval);

        if (Date.now() > this.fireEndTimestamp) {
            await this.restoreBaseStrength();
            done();
            return;
        }

        harvest();
    }

    updateConfig(config: GameFireActionConfig): void {
        this.config = {
            ...this.config,
            ...config,
            channels: {
                ...(this.config.channels ?? {}),
                ...(config.channels ?? {}),
            },
        };

        if (config.updateMode === 'replace') {
            this.fireEndTimestamp = Date.now() + Math.min(config.time, FIRE_MAX_DURATION);
        } else if (config.updateMode === 'append') {
            this.fireEndTimestamp += Math.min(config.time, FIRE_MAX_DURATION);
        }

        this.refreshFireChannels();
    }
}
