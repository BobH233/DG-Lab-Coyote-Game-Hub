import { v4 as uuidv4 } from "uuid";

import { AfterUpdate, Column, DataSource, Entity, Index, PrimaryColumn } from "typeorm";
import { ormDateToNumberTransformer } from "./transformers/date.js";
import { DGLabPulseService } from "#app/services/DGLabPulse.js";
import {
    createDefaultMainGameConfig,
    GameChannelConfig,
    MainGameConfig,
    MainGameConfigPatch,
    mergeMainGameConfig,
    normalizeMainGameConfig,
} from "#app/types/game.js";
import { ExEventEmitter } from "#app/utils/ExEventEmitter.js";
import { ormLooseJsonTransformer } from "./transformers/json.js";

export interface GameModelEvents {
    configUpdated: [newConfig: MainGameConfig];
};

@Entity({ name: 'game' })
export class GameModel {
    public static events = new ExEventEmitter<GameModelEvents>();

    @PrimaryColumn({ type: 'uuid', name: 'game_id', comment: '游戏ID' })
    gameId!: string;

    @Column({ type: 'varchar', name: 'main_connect_code', length: 64, nullable: true, comment: '主连接码' })
    @Index({ unique: true })
    mainConnectCode?: string | null;

    @Column({ type: 'varchar', name: 'replica_connect_code', length: 64, nullable: true, comment: '只读链接码（主要）' })
    @Index({ unique: true })
    replicaConnectCode?: string | null;

    @Column({ type: 'int', name: 'fire_strength_limit', default: 30, comment: 'A通道一键开火强度限制，兼容旧版字段' })
    fireStrengthLimit!: number;

    @Column({ type: 'json', name: 'strength_change_interval', default: '[10, 30]', comment: 'A通道强度变化间隔，兼容旧版字段' })
    strengthChangeInterval!: [number, number];

    @Column({ type: 'boolean', name: 'enable_b_channel', default: false, comment: '是否启用B通道，兼容旧版字段' })
    enableBChannel!: boolean;

    @Column({ type: 'double', name: 'b_channel_strength_multiplier', default: 1, comment: 'B通道强度倍率，兼容旧版字段' })
    bChannelStrengthMultiplier!: number;

    @Column({ type: 'text', name: 'pulse_id', default: '""', transformer: ormLooseJsonTransformer, comment: 'A通道波形ID或ID列表，兼容旧版字段' })
    pulseId!: string | string[];

    @Column({ type: 'text', name: 'fire_pulse_id', nullable: true, comment: 'A通道一键开火波形ID，兼容旧版字段' })
    firePulseId?: string | null;

    @Column({ type: 'simple-enum', name: 'pulse_mode', enum: ['single', 'sequence', 'random'], default: 'single', comment: 'A通道波形播放模式，兼容旧版字段' })
    pulseMode!: 'single' | 'sequence' | 'random';

    @Column({ type: 'int', name: 'pulse_change_interval', default: 60, comment: 'A通道波形切换间隔，兼容旧版字段' })
    pulseChangeInterval!: number;

    @Column({ type: 'text', name: 'a_channel_config', nullable: true, transformer: ormLooseJsonTransformer, comment: 'A通道独立配置' })
    aChannelConfig?: Partial<GameChannelConfig> | null;

    @Column({ type: 'text', name: 'b_channel_config', nullable: true, transformer: ormLooseJsonTransformer, comment: 'B通道独立配置' })
    bChannelConfig?: Partial<GameChannelConfig> | null;

    @Column({ type: 'int', name: 'last_connected_at', unsigned: true, nullable: true, transformer: ormDateToNumberTransformer, comment: '最后连接时间' })
    lastConnectedAt?: Date | null;

    @AfterUpdate()
    public async handleAfterUpdate() {
        GameModel.events.emitSub('configUpdated', this.gameId, this.toMainGameConfig());
    }

    public toMainGameConfig(): MainGameConfig {
        const defaultPulseId = DGLabPulseService.instance.getDefaultPulse().id;
        return normalizeMainGameConfig(this, defaultPulseId);
    }

    public applyMainGameConfig(config: MainGameConfig): void {
        this.aChannelConfig = config.channels.a;
        this.bChannelConfig = config.channels.b;

        this.fireStrengthLimit = config.channels.a.fireStrengthLimit;
        this.strengthChangeInterval = config.channels.a.strengthChangeInterval;
        this.enableBChannel = config.channels.b.enabled;
        this.bChannelStrengthMultiplier = 1;
        this.pulseId = config.channels.a.pulseId;
        this.firePulseId = config.channels.a.firePulseId ?? null;
        this.pulseMode = config.channels.a.pulseMode;
        this.pulseChangeInterval = config.channels.a.pulseChangeInterval;
    }

    public static getDefaultConfig(): GameModel {
        const model = new GameModel();
        const defaultPulseId = DGLabPulseService.instance.getDefaultPulse().id;

        model.gameId = uuidv4();
        model.mainConnectCode = uuidv4();
        model.replicaConnectCode = uuidv4();
        model.applyMainGameConfig(createDefaultMainGameConfig(defaultPulseId));

        return model;
    }

    public static async getByGameId(db: DataSource, gameId: string): Promise<GameModel | null> {
        const gameRepository = db.getRepository(GameModel);
        return await gameRepository.findOneBy({ gameId });
    }

    public static async getOrCreateByGameId(db: DataSource, gameId: string): Promise<GameModel> {
        const gameRepository = db.getRepository(GameModel);
        let game = await gameRepository.findOneBy({ gameId });
        if (!game) {
            game = GameModel.getDefaultConfig();
            game.gameId = gameId;
            game = await gameRepository.save(game);
        }

        if (!game.mainConnectCode || !game.replicaConnectCode) {
            if (!game.mainConnectCode) game.mainConnectCode = uuidv4();
            if (!game.replicaConnectCode) game.replicaConnectCode = uuidv4();
        }

        if (!game.aChannelConfig || !game.bChannelConfig) {
            game.applyMainGameConfig(game.toMainGameConfig());
        }

        game = await gameRepository.save(game);
        return game;
    }

    public static async update(db: DataSource, gameId: string, data: Partial<GameModel>): Promise<GameModel | null> {
        const repo = db.getRepository(GameModel);
        const game = await GameModel.getByGameId(db, gameId);
        if (!game) {
            return null;
        }

        Object.assign(game, data);

        if (typeof game.pulseId === 'string') {
            game.pulseId = [game.pulseId];
        }

        return await repo.save(game);
    }

    public static async updateConfig(db: DataSource, gameId: string, data: MainGameConfigPatch): Promise<GameModel | null> {
        const repo = db.getRepository(GameModel);
        const game = await GameModel.getByGameId(db, gameId);
        if (!game) {
            return null;
        }

        const defaultPulseId = DGLabPulseService.instance.getDefaultPulse().id;
        const nextConfig = mergeMainGameConfig(game.toMainGameConfig(), data, defaultPulseId);
        game.applyMainGameConfig(nextConfig);

        return await repo.save(game);
    }
}
