import type { RouteLocationNormalized as Route } from 'vue-router';
import Util from '@/util/Util';

/**
 * 番組表 (/guide) のクエリを組み立てるユーティリティ
 *
 * 番組表の表示条件は放送波 (`type`)・地域 (`region`)・系列 (`affiliation`)・単局 (`channelId`)・時刻 (`time`) の
 * 5 つで、時刻移動やダイアログからの遷移で**表示条件を落とさない**ことが重要。
 * (地域別番組表で日付を変えたら全放送波に戻る、といった不具合を防ぐ)
 */
namespace GuideRouteUtil {
    export interface CreateQueryOption {
        time?: string; // YYMMddhh。省略すると「現在時刻」になる
        type?: string; // 放送波。省略すると外れる
        channelId?: number | string; // 単局表示。省略すると現在のルートの値を引き継ぐ
        keepTime?: boolean; // true で現在のルートの time を引き継ぐ
    }

    /**
     * 現在のルートの表示条件を引き継いだ /guide のクエリを作る
     * @param route: Route 現在のルート
     * @param option: CreateQueryOption
     * @return { [key: string]: string }
     */
    export const createQuery = (route: Route, option: CreateQueryOption = {}): { [key: string]: string } => {
        const query: { [key: string]: string } = {};

        if (typeof option.time !== 'undefined') {
            query.time = option.time;
        } else if (option.keepTime === true && typeof route.query.time !== 'undefined') {
            const time = Util.getRouteString(route.query.time);
            if (typeof time !== 'undefined') {
                query.time = time;
            }
        }

        if (typeof option.type !== 'undefined') {
            query.type = option.type;
        }

        const region = Util.getRouteString(route.query.region);
        if (typeof region !== 'undefined') {
            query.region = region;
        }

        const affiliation = Util.getRouteString(route.query.affiliation);
        if (typeof affiliation !== 'undefined') {
            query.affiliation = affiliation;
        }

        if (typeof option.channelId !== 'undefined') {
            query.channelId = option.channelId.toString(10);
        } else {
            const channelId = Util.getRouteString(route.query.channelId);
            if (typeof channelId !== 'undefined') {
                query.channelId = channelId;
            }
        }

        return query;
    };
}

export default GuideRouteUtil;
