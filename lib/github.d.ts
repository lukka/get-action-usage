import { IReporter } from './interfaces';
export declare function isRunningOnGitHubRunner(): boolean;
export declare function getHtmlUrl(url: string, line: number): string;
export declare class Reporter implements IReporter {
    info(message: string, error?: Error): void;
    warn(message: string, error?: Error): void;
    error(message: string, error?: Error): void;
    debug(message: string, error?: Error): void;
}
