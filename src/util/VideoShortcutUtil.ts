export interface VideoShortcut {
    keys: string;
    description: string;
}

/** 視聴プレーヤーの独自ショートカット一覧。 */
export const VIDEO_SHORTCUTS: VideoShortcut[] = [
    { keys: 'Space', description: '再生 / 一時停止' },
    { keys: '← / →', description: '録画を 5 秒戻す / 進める' },
    { keys: 'Ctrl + ← / →', description: '15 秒戻す / 進める' },
    { keys: 'Shift + ← / →', description: '30 秒戻す / 進める' },
    { keys: 'Ctrl + ↑ / ↓', description: '音量を上げる / 下げる' },
    { keys: 'Q', description: 'ミュート切り替え' },
    { keys: 'F', description: 'フルスクリーン切り替え' },
    { keys: 'E', description: 'PiP 切り替え' },
    { keys: 'Shift + C', description: 'キャプチャ' },
    { keys: 'D', description: 'コメント表示切り替え' },
    { keys: '+ / -', description: '再生速度を上げる / 下げる' },
    { keys: ',', description: '1 フレーム戻す' },
    { keys: '.', description: '1 フレーム進める' },
    { keys: '[ / ]', description: '前 / 次のチャプター' },
    { keys: 'c', description: '字幕切り替え' },
    { keys: 'i', description: '動画情報' },
    { keys: '?', description: 'この一覧を表示' },
];

/** キーイベントが一覧にある操作かを判定する。処理側も一覧外のキーを受け付けない。 */
export function isListedVideoShortcut(event: { key: string; ctrlKey: boolean; shiftKey: boolean }): boolean {
    let label = event.key;
    if (event.key.startsWith('Arrow')) {
        const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
        if (event.ctrlKey === true) label = horizontal ? 'Ctrl + ← / →' : 'Ctrl + ↑ / ↓';
        else if (event.shiftKey === true) label = 'Shift + ← / →';
        else label = horizontal ? '← / →' : '';
    } else if (event.key === ' ') label = 'Space';
    else if (event.key === 'C') label = 'Shift + C';
    else if (event.key === 'c') label = 'c';
    else if (event.key.length === 1 && /[a-z]/i.test(event.key)) label = event.key.toUpperCase();
    else if (event.key === '[' || event.key === ']') label = '[ / ]';
    else if (event.key === '?') label = '?';
    return VIDEO_SHORTCUTS.some(shortcut => shortcut.keys === label);
}
