import { GameChannelId, gameChannelIdList } from "#app/types/game.js";
import { CoyoteGameController } from "../CoyoteGameController.js";

export abstract class AbstractGameAction<ActionConfig = any> {
    /** 游戏动作的默认权重 */
    static readonly defaultPriority = 0;

    public game!: CoyoteGameController;
    abortController: AbortController = new AbortController();

    public static actionId: string = "";
    public static actionName: string = "";

    constructor(
        /** 游戏动作的配置 */
        public config: ActionConfig,
        /** 游戏动作的权重 */
        public priority: number = AbstractGameAction.defaultPriority,
    ) {}

    _initialize(game: CoyoteGameController) {
        this.game = game;
        this.initialize();
    }

    initialize() {
        // Subclass could override this method
    }

    /**
     * 返回当前动作需要独占的通道。
     * 默认占用所有通道，避免未知动作与默认任务并发执行。
     */
    public getOccupiedChannels(): GameChannelId[] {
        return [...gameChannelIdList];
    }

    /** 执行游戏动作 */
    public abstract execute(ab: AbortController, harvest: () => void, done: () => void): Promise<void>;

    /** 更新游戏动作的配置 */
    public abstract updateConfig(config: ActionConfig): void;
}
