import { injectable } from 'inversify';
import ISnackbarState, { SnackbarActionOption, SnackbarDipslayOption, SnackBarTextOption } from './ISnackbarState';

@injectable()
class SnackbarState implements ISnackbarState {
    public isOpen: boolean = false;
    public displayOption: SnackbarDipslayOption = {
        color: SnackbarState.NROMAL_COLOR,
        timeout: 2000,
    };
    public mainText: string = '';
    public buttonText: string;
    public action: SnackbarActionOption | null = null;

    private timerId: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.buttonText = this.getDefaultButtonText();
    }

    /**
     * ボタンのデフォルトテキストを返す
     * @return string
     */
    private getDefaultButtonText(): string {
        return '閉じる';
    }

    /**
     * open snackbar
     * @param option: SnackBarTextOption
     */
    public open(option: SnackBarTextOption): void {
        this.mainText = option.text;
        this.displayOption.color = typeof option.color === 'undefined' || option.color === 'normal' ? SnackbarState.NROMAL_COLOR : option.color;
        // アクション付きの場合は自動で消えると押す間もなく消えてしまうため表示時間を長めにする
        this.displayOption.timeout = typeof option.timeout === 'undefined' ? (typeof option.action === 'undefined' ? 1500 : 6000) : option.timeout;
        this.action = option.action ?? null;
        this.isOpen = true;

        if (this.timerId !== null) {
            clearTimeout(this.timerId);
        }

        this.timerId = setTimeout(() => {
            this.close();
        }, this.displayOption.timeout);
    }

    /**
     * close snackbar
     */
    public close(): void {
        this.action = null;

        if (this.timerId === null) {
            return;
        }

        clearTimeout(this.timerId);
        this.timerId = null;
        this.isOpen = false;
    }
}

namespace SnackbarState {
    export const NROMAL_COLOR = 'grey darken-3';
}

export default SnackbarState;
