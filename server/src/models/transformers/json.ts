import { ValueTransformer } from "typeorm";

const markParsed = (value: any) => {
    if (value && typeof value === 'object' && !value.$parsed) {
        Object.defineProperty(value, '$parsed', {
            value: true,
            enumerable: false,
            configurable: true,
        });
    }

    return value;
};

const parseLooseJsonValue = (value: any) => {
    if (typeof value !== 'string') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        // 兼容历史遗留的裸字符串字段，例如直接存 pulseId = d6f83af0
        return value;
    }
};

export const ormLooseJsonTransformer: ValueTransformer = {
    to: (value: any): string | null => {
        return value ? JSON.stringify({ data: value }) : null;
    },
    from: (value: any | null): any => {
        if (value === null || value === undefined) {
            return null;
        }

        if (value?.$parsed) {
            // 如果已经解析过，直接返回原始数据
            return value;
        }

        const parsedValue = parseLooseJsonValue(value);
        const parsedData = parsedValue && typeof parsedValue === 'object' && 'data' in parsedValue
            ? parsedValue.data
            : parsedValue;
        if (parsedData === undefined || parsedData === null) {
            return null;
        }

        return markParsed(parsedData);
    }
};
