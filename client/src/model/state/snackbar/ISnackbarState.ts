export type colorType = 'normal' | 'success' | 'info' | 'error';

export interface SnackbarDipslayOption {
    color: string;
    timeout: number;
}

/**
 * スナックバーに表示するアクションボタン (例: 「元に戻す」)
 */
export interface SnackbarActionOption {
    text: string;
    onClick: () => void | Promise<void>;
}

export interface SnackBarTextOption {
    text: string;
    color?: colorType;
    timeout?: number;
    // 元に戻す等のアクション導線 (§4.8 可逆性)。指定しない場合はボタンを表示しない
    action?: SnackbarActionOption;
}

export default interface ISnackbarState {
    isOpen: boolean;
    displayOption: SnackbarDipslayOption;
    mainText: string;
    buttonText: string;
    action: SnackbarActionOption | null;
    open(option: SnackBarTextOption): void;
    close(): void;
}
