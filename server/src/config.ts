import yaml from 'js-yaml';
import * as fs from 'fs';
import { MainConfigSchema, MainConfigType } from './types/config.js';
import { z } from 'koa-swagger-decorator';

const getEnvValue = (...keys: string[]): string | undefined => {
    for (const key of keys) {
        const value = process.env[key];
        if (value !== undefined && value !== '') {
            return value;
        }
    }

    return undefined;
};

const parseEnvBoolean = (value: string): boolean => {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const applyEnvOverrides = (config: MainConfigType | null | undefined): MainConfigType => {
    const nextConfig = { ...(config ?? {}) } as MainConfigType;

    const port = getEnvValue('CGH_PORT', 'PORT');
    if (port !== undefined) {
        const parsedPort = Number(port);
        if (!Number.isNaN(parsedPort)) {
            nextConfig.port = parsedPort;
        }
    }

    const host = getEnvValue('CGH_HOST', 'HOST');
    if (host !== undefined) {
        nextConfig.host = host;
    }

    const reverseProxy = getEnvValue('CGH_REVERSE_PROXY', 'REVERSE_PROXY');
    if (reverseProxy !== undefined) {
        nextConfig.reverseProxy = parseEnvBoolean(reverseProxy);
    }

    const webBaseUrl = getEnvValue('CGH_WEB_BASE_URL', 'WEB_BASE_URL');
    if (webBaseUrl !== undefined) {
        nextConfig.webBaseUrl = webBaseUrl;
    }

    const webWsBaseUrl = getEnvValue('CGH_WEB_WS_BASE_URL', 'WEB_WS_BASE_URL');
    if (webWsBaseUrl !== undefined) {
        nextConfig.webWsBaseUrl = webWsBaseUrl;
    }

    const clientWsBaseUrl = getEnvValue('CGH_CLIENT_WS_BASE_URL', 'CLIENT_WS_BASE_URL');
    if (clientWsBaseUrl !== undefined) {
        nextConfig.clientWsBaseUrl = clientWsBaseUrl;
    }

    const apiBaseHttpUrl = getEnvValue('CGH_API_BASE_HTTP_URL', 'API_BASE_HTTP_URL');
    if (apiBaseHttpUrl !== undefined) {
        nextConfig.apiBaseHttpUrl = apiBaseHttpUrl;
    }

    return nextConfig;
};

export class Config<ConfigType = any> {
    public value: ConfigType | null = null;
    public filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    public async load() {
        try {
            const fileContent = await fs.promises.readFile(this.filePath, { encoding: 'utf-8' });
            this.value = yaml.load(fileContent) as ConfigType;
        } catch (error: any) {
            console.error('Failed to read config:', error);
        }
    }

    public async save() {
        if (this.value) {
            try {
                const yamlStr = yaml.dump(this.value);
                await fs.promises.writeFile(this.filePath, yamlStr, { encoding: 'utf-8' });
            } catch (error: any) {
                console.error('Failed to save config:', error);
            }
        }
    }
}

export class MainConfig {
    public static instance: Config<MainConfigType>;

    public static async initialize() {
        if (!fs.existsSync('config.yaml') && fs.existsSync('config.example.yaml')) {
            // 如果配置文件不存在，但存在示例配置文件，则复制示例配置文件
            fs.copyFileSync('config.example.yaml', 'config.yaml');
        }

        MainConfig.instance = new Config<MainConfigType>('config.yaml');
        await MainConfig.instance.load();

        try {
            MainConfig.instance.value = MainConfigSchema.parse(
                applyEnvOverrides(MainConfig.instance.value),
            );
        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error('MainConfig validation failed:', error.errors);
                throw new Error(`MainConfig validation failed: ${error.errors.map(e => e.message).join(', ')}`);
            } else if (error instanceof Error) {
                console.error('MainConfig validation failed:', error.message);
                throw new Error(`MainConfig validation failed: ${error.message}`);
            } else {
                console.error('MainConfig validation failed:', error);
                throw new Error('MainConfig validation failed: Unknown error');
            }
        }
    }

    public static get value() {
        return MainConfig.instance.value!;
    }

    public static load(): Promise<void> {
        return MainConfig.instance.load();
    }

    public static save(): Promise<void> {
        return MainConfig.instance.save();
    }
}
