namespace Util {
    /**
     * sleep
     * @param msec: ミリ秒
     */
    export const sleep = (msec: number): Promise<void> => {
        return new Promise((resolve: () => void) => {
            setTimeout(() => {
                resolve();
            }, msec);
        });
    };

    /**
     * 指定時間内に Promise が解決しなければタイムアウトエラーで reject する
     * @param promise: Promise<T>
     * @param msec: タイムアウトまでのミリ秒
     * @return Promise<T>
     */
    export const promiseTimeout = <T>(promise: Promise<T>, msec: number): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('TimeoutError'));
            }, msec);

            promise
                .then(result => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch(err => {
                    clearTimeout(timer);
                    reject(err);
                });
        });
    };
}

export default Util;
