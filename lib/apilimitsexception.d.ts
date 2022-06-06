export declare class ApiLimitsException extends Error {
    readonly message: string;
    readonly remaining: number;
    readonly nextReset: Date;
    readonly used: number;
    protected __proto__: ErrorConstructor;
    constructor(message: string, remaining: number, nextReset: Date, used: number);
}
