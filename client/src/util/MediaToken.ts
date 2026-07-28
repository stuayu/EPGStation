/**
 * 外部プレイヤー (VLC / Infuse) や IPTV クライアント向けのアクセストークン。
 *
 * これらは EPGStation の Cookie を送れないため、動画配信 URL のクエリにトークンを付ける。
 * 起動時に 1 度取得してここに保持し、URL を組み立てる箇所から参照する。
 * 認証が無効な環境では null のままで、URL には何も付かない
 */
let mediaToken: string | null = null;

/**
 * 取得したトークンを保持する
 * @param token: string | null
 */
export const setMediaToken = (token: string | null): void => {
    mediaToken = typeof token === 'string' && token !== '' ? token : null;
};

/**
 * URL にアクセストークンを付ける (認証無効時はそのまま返す)
 * @param url: string
 * @return string
 */
export const withMediaToken = (url: string): string => {
    if (mediaToken === null) return url;

    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(mediaToken)}`;
};
