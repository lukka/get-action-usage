export declare class ProgressBar {
    static getActionString(msg: string): string;
    private readonly multiBar;
    private readonly timeBar;
    private readonly repoBar;
    constructor();
    init(startDate: Date, timeRangeDays: number): void;
    update(startDate: Date, nextDate: Date, totalRepoCount: number, timeSegment: number): void;
    updateRepo(barCounter: number, payload: any): void;
    updateApiQuota(restApi?: number, searchApi?: number): void;
    stop(): void;
}
