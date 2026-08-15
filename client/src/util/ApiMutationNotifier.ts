type MutationListener = () => void;

/**
 * 状態を変える API 呼び出し (POST / PUT / DELETE) が成功したことを、
 * クライアント内部で配るための小さな通知口。
 *
 * サーバからの socket.io 通知が届かない環境 (リバースプロキシ・接続断など) でも、
 * 自分自身の操作結果だけは画面へ即時反映させるために使う。
 * DI の循環参照を避けるため、あえて inversify を介さないモジュールにしてある
 * (RepositoryModel が publish し、SocketIOModel が subscribe する)。
 */
namespace ApiMutationNotifier {
    const listeners: MutationListener[] = [];

    // 通知不要な API。視聴中に周期的に呼ばれるものは、全画面の再取得を誘発させたくない
    const IGNORE_URL_PATTERNS: RegExp[] = [/^\/auth/, /^\/streams\/[0-9]+\/keep/];

    /**
     * 通知の受け取りを開始する
     * @param listener: MutationListener
     */
    export const addListener = (listener: MutationListener): void => {
        listeners.push(listener);
    };

    /**
     * 通知の受け取りをやめる
     * @param listener: MutationListener
     */
    export const removeListener = (listener: MutationListener): void => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
            listeners.splice(index, 1);
        }
    };

    /**
     * 指定した url が通知対象か
     * @param url: string
     * @return boolean
     */
    export const isTargetUrl = (url: string): boolean => {
        for (const pattern of IGNORE_URL_PATTERNS) {
            if (pattern.test(url) === true) {
                return false;
            }
        }

        return true;
    };

    /**
     * 状態変更を通知する
     */
    export const notify = (): void => {
        for (const listener of listeners.concat()) {
            try {
                listener();
            } catch (err) {
                console.error('api mutation notify error', err);
            }
        }
    };
}

export default ApiMutationNotifier;
