import { IFile, IReporter } from './interfaces';
export declare function isRunningOnGitHubRunner(): boolean;
export declare function getHtmlUrl(file: Pick<IFile, 'html_url'>, line: number): string;
export declare class Reporter implements IReporter {
    info(message: string, error?: Error): void;
    warn(message: string, error?: Error): void;
    error(message: string, error?: Error): void;
    debug(message: string, error?: Error): void;
}
