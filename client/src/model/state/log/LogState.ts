import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import ILogApiModel from '../../api/log/ILogApiModel';
import ILogState, { LogCategoryTab, LogProcessTab } from './ILogState';

@injectable()
class LogState implements ILogState {
    public lines: string[] = [];
    public isTruncated: boolean = false;
    public isLoading: boolean = false;
    public selectedProcess: apid.LogProcessType | null = null;
    public selectedCategory: string | null = null;
    public selectedFileId: string | null = null;
    public keyword: string = '';
    public displayLines: number = LogState.DEFAULT_LINES;

    private logApiModel: ILogApiModel;
    private files: apid.LogFileItem[] = [];

    constructor(@inject('ILogApiModel') logApiModel: ILogApiModel) {
        this.logApiModel = logApiModel;
    }

    /**
     * 取得済みデータをクリアする
     */
    public clearData(): void {
        this.lines = [];
        this.isTruncated = false;
    }

    /**
     * ログファイル一覧を取得する
     * 選択中のタブが無効になった場合は先頭へフォールバックする
     */
    public async fetchFiles(): Promise<void> {
        const result = await this.logApiModel.getFiles();
        this.files = result.items;

        // プロセス選択の整合性を保つ
        const processTabs = this.getProcessTabs();
        if (
            this.selectedProcess === null ||
            processTabs.some(tab => tab.process === this.selectedProcess) === false
        ) {
            this.selectedProcess = processTabs.length === 0 ? null : processTabs[0].process;
        }

        // カテゴリ選択の整合性を保つ
        const categoryTabs = this.getCategoryTabs();
        if (
            this.selectedCategory === null ||
            categoryTabs.some(tab => tab.category === this.selectedCategory) === false
        ) {
            this.selectedCategory = categoryTabs.length === 0 ? null : categoryTabs[0].category;
        }

        // ファイル選択の整合性を保つ
        const files = this.getFiles();
        if (this.selectedFileId === null || files.some(f => f.id === this.selectedFileId) === false) {
            this.selectedFileId = files.length === 0 ? null : files[0].id;
        }
    }

    /**
     * 選択中のログファイルの内容を取得する
     */
    public async fetchContent(): Promise<void> {
        if (this.selectedFileId === null) {
            this.lines = [];
            this.isTruncated = false;

            return;
        }

        this.isLoading = true;
        try {
            const content = await this.logApiModel.getContent(this.selectedFileId, {
                lines: this.displayLines,
                keyword: this.keyword,
            });

            this.lines = content.lines;
            this.isTruncated = content.isTruncated;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * プロセス単位のタブを返す
     * @return LogProcessTab[]
     */
    public getProcessTabs(): LogProcessTab[] {
        const tabs: LogProcessTab[] = [];

        for (const process of LogState.PROCESS_ORDER) {
            const items = this.files.filter(f => f.process === process);
            if (items.length === 0) {
                continue;
            }

            tabs.push({
                process: process,
                name: process,
                categories: this.createCategoryTabs(items),
            });
        }

        return tabs;
    }

    /**
     * 選択中プロセスのカテゴリタブを返す
     * @return LogCategoryTab[]
     */
    public getCategoryTabs(): LogCategoryTab[] {
        const tab = this.getProcessTabs().find(t => t.process === this.selectedProcess);

        return typeof tab === 'undefined' ? [] : tab.categories;
    }

    /**
     * 選択中のプロセス / カテゴリに属するファイルを返す
     * @return apid.LogFileItem[]
     */
    public getFiles(): apid.LogFileItem[] {
        const tab = this.getCategoryTabs().find(t => t.category === this.selectedCategory);

        return typeof tab === 'undefined' ? [] : tab.files;
    }

    /**
     * 選択中のログファイルを返す
     * @return apid.LogFileItem | null
     */
    public getSelectedFile(): apid.LogFileItem | null {
        return this.files.find(f => f.id === this.selectedFileId) ?? null;
    }

    /**
     * 選択中のログファイルのダウンロード URL を返す
     * @return string | null
     */
    public getDownloadUrl(): string | null {
        return this.selectedFileId === null ? null : this.logApiModel.getDownloadUrl(this.selectedFileId);
    }

    /**
     * プロセスタブを切り替える
     * @param process: apid.LogProcessType
     */
    public selectProcess(process: apid.LogProcessType): void {
        if (this.selectedProcess === process) {
            return;
        }

        this.selectedProcess = process;

        // カテゴリ / ファイル選択を切り替え先の先頭へ合わせる
        const categoryTabs = this.getCategoryTabs();
        const keepCategory =
            this.selectedCategory !== null && categoryTabs.some(t => t.category === this.selectedCategory);
        if (keepCategory === false) {
            this.selectedCategory = categoryTabs.length === 0 ? null : categoryTabs[0].category;
        }

        const files = this.getFiles();
        this.selectedFileId = files.length === 0 ? null : files[0].id;
        this.clearData();
    }

    /**
     * カテゴリタブを切り替える
     * @param category: string
     */
    public selectCategory(category: string): void {
        if (this.selectedCategory === category) {
            return;
        }

        this.selectedCategory = category;

        const files = this.getFiles();
        this.selectedFileId = files.length === 0 ? null : files[0].id;
        this.clearData();
    }

    /**
     * 表示するログファイル (世代) を切り替える
     * @param logFileId: ログファイル id
     */
    public selectFile(logFileId: string): void {
        if (this.selectedFileId === logFileId) {
            return;
        }

        this.selectedFileId = logFileId;
        this.clearData();
    }

    /**
     * ファイル一覧をカテゴリごとにまとめる
     * @param items: apid.LogFileItem[]
     * @return LogCategoryTab[]
     */
    private createCategoryTabs(items: apid.LogFileItem[]): LogCategoryTab[] {
        const categories: LogCategoryTab[] = [];

        for (const item of items) {
            let tab = categories.find(c => c.category === item.category);
            if (typeof tab === 'undefined') {
                tab = {
                    category: item.category,
                    files: [],
                };
                categories.push(tab);
            }

            tab.files.push(item);
        }

        // 現行ログを先頭に、以降は新しい順に並べる
        for (const category of categories) {
            category.files.sort((a, b) => {
                if (a.isRotated !== b.isRotated) {
                    return a.isRotated === false ? -1 : 1;
                }

                return b.updatedAt - a.updatedAt;
            });
        }

        // カテゴリは見やすい順序で固定し、未知のものは後ろへ
        categories.sort((a, b) => {
            const aIndex = LogState.CATEGORY_ORDER.indexOf(a.category);
            const bIndex = LogState.CATEGORY_ORDER.indexOf(b.category);
            const aOrder = aIndex === -1 ? LogState.CATEGORY_ORDER.length : aIndex;
            const bOrder = bIndex === -1 ? LogState.CATEGORY_ORDER.length : bIndex;

            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }

            return a.category < b.category ? -1 : 1;
        });

        return categories;
    }
}

namespace LogState {
    export const PROCESS_ORDER: apid.LogProcessType[] = ['Operator', 'Service', 'EPGUpdater'];
    export const CATEGORY_ORDER: string[] = ['system', 'access', 'stream', 'encode'];
    export const DEFAULT_LINES = 500;
}

export default LogState;
