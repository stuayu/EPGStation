import { cloneDeep } from 'lodash';
import type { Router as VueRouter, RouteLocationRaw as Location, RouteLocationNormalized as Route } from 'vue-router';

namespace Util {
    /**
     * 指定した時間だけ待機する
     * @param time: 待機する時間 (ms)
     * @return Promise<void>
     */
    export const sleep = (time: number): Promise<void> => {
        return new Promise<void>((resolve: () => void) => {
            setTimeout(() => {
                resolve();
            }, time);
        });
    };

    /**
     * url から query を取り出す
     * @param url: string
     * @return { [key: string]: string }
     */
    export const getQuery = (url: string): { [key: string]: string } => {
        const urls = url.split('?');
        if (urls.length < 2) {
            return {};
        }

        const strs = urls[1].split('&');
        const result: Record<string, string> = {};
        for (const s of strs) {
            const query = s.split('=');
            if (query.length === 2) {
                result[query[0]] = query[1];
            }
        }

        return result;
    };

    /**
     * 引数で渡された url の 指定された パラメータの値を返す
     * @param url: url
     * @param key: query
     * @return string | null
     */
    export const getQueryParam = (url: string, key: string): string | null => {
        const value = Util.getQuery(url)[key];

        return typeof value === 'undefined' ? null : decodeURIComponent(value);
    };

    /**
     * query に timestamp を追加してページ移動する
     * @param router: VueRouter
     * @param location Location
     * @return Promise<Route>
     */
    export const move = async (router: VueRouter, location: Location): Promise<void> => {
        const target = typeof location === 'string' ? { path: location } : cloneDeep(location);
        const query = 'query' in target && typeof target.query !== 'undefined' ? target.query : {};
        const path = 'path' in target && typeof target.path === 'string' ? target.path : undefined;

        if (typeof path !== 'undefined') {
            target.path = path.startsWith('/') ? path : `/${path}`;
        }

        if (typeof target.path !== 'undefined' && router.currentRoute.value.path === target.path) {
            const oldQuery = cloneDeep(router.currentRoute.value.query);
            delete oldQuery.timestamp;
            delete query.timestamp;

            if (Object.keys(oldQuery).length === Object.keys(query).length) {
                const isEqual = Object.keys(oldQuery).every(key => query[key] === oldQuery[key]);
                if (isEqual) {
                    return;
                }
            }
        }

        query.timestamp = new Date().getTime().toString(10);
        target.query = query;
        await router.push(target);
    };

    /**
     * get subdirectory
     * @return string
     */
    export const getSubDirectory = (): string => {
        return window.location.pathname.replace(/\/[^\/]*$/, '');
    };

    /**
     * Route からページ数を取り出す
     * @param route: Route
     * @return number
     */
    export const getPageNum = (route: Route): number => {
        const page = typeof route.query.page === 'string' ? parseInt(route.query.page, 10) : 1;

        if (isNaN(page) === true) {
            throw new Error('PageIsNaN');
        }

        return page;
    };

    // ファイルサイズ単位
    const fileSizeUnits = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

    /**
     * ファイルサイズ取得
     * @param size: number
     * @return string
     */
    export const getFileSizeStr = (size: number): string => {
        let cnt = 0;
        for (; cnt <= fileSizeUnits.length; cnt++) {
            if (size < 1000) {
                break;
            }
            size /= 1024;
        }

        return `${size.toFixed(1)}${fileSizeUnits[cnt]}`;
    };

    export const getOSDarkTheme = (): boolean => {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    };
}

export default Util;
