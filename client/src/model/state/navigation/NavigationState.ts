import { inject, injectable } from 'inversify';
import type { RouteLocationNormalized as Route } from 'vue-router';
import { isFeatureEnabled } from '../../../util/FeatureFlags';
import * as apid from '../../../../../api';
import IChannelModel from '../../channels/IChannelModel';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import { ISettingStorageModel } from '../../storage/setting/ISettingStorageModel';
import INavigationState, { NavigationItem, NavigationType } from './INavigationState';

@injectable()
export default class NavigationState implements INavigationState {
    public openState: null | boolean = null;
    public isClipped: boolean = false;
    public type: NavigationType = 'default';
    public items: NavigationItem[] = [];
    public navigationPosition: number = -1;

    private serverConfig: IServerConfigModel;
    private setting: ISettingStorageModel;
    private channelModel: IChannelModel;

    constructor(
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('ISettingStorageModel') setting: ISettingStorageModel,
        @inject('IChannelModel') channelModel: IChannelModel,
    ) {
        this.serverConfig = serverConfig;
        this.setting = setting;
        this.channelModel = channelModel;
    }

    /**
     * 地上波系 (GR / NWxx) の放送波種別か
     * @param type: string
     * @return boolean
     */
    private static isRegionalType(type: string): boolean {
        return type === 'GR' || /^NW\d+$/.test(type) === true;
    }

    /**
     * 取得済みの放送局情報から地域一覧を作成する
     * 地域不明の放送局 (CATV 等) は末尾にまとめられる
     * @param regionalTypes: string[] 対象の放送波種別
     * @return apid.BroadcastRegionItem[]
     */
    private getRegions(regionalTypes: string[]): apid.BroadcastRegionItem[] {
        const isHalfWidth = this.setting.getSavedValue().isHalfWidthDisplayed;
        const regions: apid.BroadcastRegionItem[] = [];
        const addedIds: { [regionId: string]: boolean } = {};

        for (const channel of this.channelModel.getChannels(isHalfWidth)) {
            if (regionalTypes.indexOf(channel.channelType) === -1 || typeof channel.region === 'undefined') {
                continue;
            }

            if (addedIds[channel.region.id] === true) {
                continue;
            }
            addedIds[channel.region.id] = true;
            regions.push({ id: channel.region.id, name: channel.region.name, order: channel.region.order });
        }

        // 都道府県コード順に並べる (判定不能な「その他」は order 99 なので必ず末尾になる)
        return regions.sort((a, b) => a.order - b.order);
    }

    /**
     * ナビゲーションの表示内容を更新
     * @param currentRoute: Route
     */
    public updateItems(currentRoute: Route): void {
        const newItems: NavigationItem[] = [];
        newItems.push({
            icon: 'mdi-view-dashboard',
            title: 'ダッシュボード',
            herf: {
                path: '/',
            },
        });

        const config = this.serverConfig.getConfig();

        if (config !== null && config.isEnableTSLiveStream === true) {
            newItems.push({
                icon: 'mdi-television-play',
                title: '放映中',
                herf: {
                    path: '/onair',
                },
            });
        }

        if (this.setting.getSavedValue().isEnableDisplayForEachBroadcastWave === true && config !== null) {
            const types: string[] = [];
            if (config.broadcast.GR === true) {
                types.push('GR');
            }
            if (config.broadcast.BS === true) {
                types.push('BS');
            }
            if (config.broadcast.CS === true) {
                types.push('CS');
            }
            if (config.broadcast.SKY === true) {
                types.push('SKY');
            }
            if (config.broadcast.NW1 === true) {
                types.push('NW1');
            }
            if (config.broadcast.NW2 === true) {
                types.push('NW2');
            }
            if (config.broadcast.NW3 === true) {
                types.push('NW3');
            }
            if (config.broadcast.NW4 === true) {
                types.push('NW4');
            }
            if (config.broadcast.NW5 === true) {
                types.push('NW5');
            }
            if (config.broadcast.NW6 === true) {
                types.push('NW6');
            }
            if (config.broadcast.NW7 === true) {
                types.push('NW7');
            }
            if (config.broadcast.NW8 === true) {
                types.push('NW8');
            }
            if (config.broadcast.NW9 === true) {
                types.push('NW9');
            }
            if (config.broadcast.NW10 === true) {
                types.push('NW10');
            }
            if (config.broadcast.NW11 === true) {
                types.push('NW11');
            }
            if (config.broadcast.NW12 === true) {
                types.push('NW12');
            }
            if (config.broadcast.NW13 === true) {
                types.push('NW13');
            }
            if (config.broadcast.NW14 === true) {
                types.push('NW14');
            }
            if (config.broadcast.NW15 === true) {
                types.push('NW15');
            }
            if (config.broadcast.NW16 === true) {
                types.push('NW16');
            }
            if (config.broadcast.NW17 === true) {
                types.push('NW17');
            }
            if (config.broadcast.NW18 === true) {
                types.push('NW18');
            }
            if (config.broadcast.NW19 === true) {
                types.push('NW19');
            }
            if (config.broadcast.NW20 === true) {
                types.push('NW20');
            }
            if (config.broadcast.NW21 === true) {
                types.push('NW21');
            }
            if (config.broadcast.NW22 === true) {
                types.push('NW22');
            }
            if (config.broadcast.NW23 === true) {
                types.push('NW23');
            }
            if (config.broadcast.NW24 === true) {
                types.push('NW24');
            }
            if (config.broadcast.NW25 === true) {
                types.push('NW25');
            }
            if (config.broadcast.NW26 === true) {
                types.push('NW26');
            }
            if (config.broadcast.NW27 === true) {
                types.push('NW27');
            }
            if (config.broadcast.NW28 === true) {
                types.push('NW28');
            }
            if (config.broadcast.NW29 === true) {
                types.push('NW29');
            }
            if (config.broadcast.NW30 === true) {
                types.push('NW30');
            }
            if (config.broadcast.NW31 === true) {
                types.push('NW31');
            }
            if (config.broadcast.NW32 === true) {
                types.push('NW32');
            }
            if (config.broadcast.NW33 === true) {
                types.push('NW33');
            }
            if (config.broadcast.NW34 === true) {
                types.push('NW34');
            }
            if (config.broadcast.NW35 === true) {
                types.push('NW35');
            }
            if (config.broadcast.NW36 === true) {
                types.push('NW36');
            }
            if (config.broadcast.NW37 === true) {
                types.push('NW37');
            }
            if (config.broadcast.NW38 === true) {
                types.push('NW38');
            }
            if (config.broadcast.NW39 === true) {
                types.push('NW39');
            }
            if (config.broadcast.NW40 === true) {
                types.push('NW40');
            }

            // 地上波系は地域別、BS / CS / SKY は従来通り放送波種別で表示する
            const regionalTypes = types.filter(type => NavigationState.isRegionalType(type) === true);
            const otherTypes = types.filter(type => NavigationState.isRegionalType(type) === false);
            const regions = regionalTypes.length === 0 ? [] : this.getRegions(regionalTypes);

            if (regions.length === 0) {
                // 放送局情報が未取得などで地域を判定できない場合は放送波種別で表示する
                for (const type of regionalTypes) {
                    newItems.push({
                        icon: 'mdi-television-guide',
                        title: `番組表${type}`,
                        herf: {
                            path: '/guide',
                            query: {
                                type: type,
                            },
                        },
                    });
                }
            } else {
                for (const region of regions) {
                    newItems.push({
                        icon: 'mdi-television-guide',
                        title: `番組表${region.name}`,
                        herf: {
                            path: '/guide',
                            query: {
                                region: region.id,
                            },
                        },
                    });
                }
            }

            for (const type of otherTypes) {
                newItems.push({
                    icon: 'mdi-television-guide',
                    title: `番組表${type}`,
                    herf: {
                        path: '/guide',
                        query: {
                            type: type,
                        },
                    },
                });
            }
        } else {
            newItems.push({
                icon: 'mdi-television-guide',
                title: '番組表',
                herf: {
                    path: '/guide',
                },
            });
        }

        newItems.push({
            icon: 'mdi-radiobox-marked',
            title: '録画中',
            herf: {
                path: '/recording',
            },
        });
        newItems.push({
            icon: 'mdi-filmstrip-box-multiple',
            title: '録画済み',
            herf: {
                path: '/recorded',
            },
        });
        // シリーズ機能は段階導入の機能フラグ (featureFlags.seriesLibrary) が有効な場合のみナビゲーションに表示する
        if (isFeatureEnabled(config, 'seriesLibrary') === true) {
            newItems.push({ icon: 'mdi-folder-play', title: 'シリーズ', herf: { path: '/series' } });
        }
        newItems.push({
            icon: 'mdi-sync',
            title: 'エンコード',
            herf: {
                path: '/encode',
            },
        });
        newItems.push({
            icon: 'mdi-clock-outline',
            title: '予約',
            herf: {
                path: '/reserves',
                query: {
                    type: 'normal',
                },
            },
        });
        newItems.push({
            icon: 'mdi-clock-outline',
            title: '競合',
            herf: {
                path: '/reserves',
                query: {
                    type: 'conflict',
                },
            },
        });
        newItems.push({
            icon: 'mdi-clock-outline',
            title: '重複',
            herf: {
                path: '/reserves',
                query: {
                    type: 'overlap',
                },
            },
        });
        newItems.push({
            icon: 'mdi-magnify',
            title: '検索',
            herf: {
                path: '/search',
            },
        });
        newItems.push({
            icon: 'mdi-calendar',
            title: 'ルール',
            herf: {
                path: '/rule',
            },
        });
        newItems.push({
            icon: 'mdi-sd',
            title: 'ストレージ',
            herf: {
                path: '/storages',
            },
        });
        newItems.push({
            icon: 'mdi-text-box-search-outline',
            title: 'ログ',
            herf: {
                path: '/logs',
            },
        });
        newItems.push({
            icon: 'mdi-cog',
            title: '設定',
            herf: {
                path: '/settings',
            },
        });

        this.items = newItems;
        this.updateNavigationPosition(currentRoute);
    }

    /**
     * ナビゲーションの選択位置を返す
     * @param currentRoute: Route
     * @return number 選択位置がない場合は -1 を返す
     */
    public updateNavigationPosition(currentRoute: Route): void {
        this.navigationPosition = this.items.findIndex(item => {
            if (item.herf === null) {
                return false;
            }

            const path = typeof item.herf === 'string' ? item.herf : 'path' in item.herf ? item.herf.path : undefined;
            if (path !== currentRoute.path) {
                return false;
            }

            const query = typeof item.herf === 'string' || !('query' in item.herf) ? undefined : item.herf.query;
            if (typeof query === 'undefined') {
                return true;
            }

            for (const key in query) {
                if (query[key] !== currentRoute.query[key]) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * ナビゲーションの開閉状態を切り替える
     */
    public toggle(): void {
        this.openState = !this.openState;
    }

    /**
     * ナビゲーションの表示項目を返す
     * @return NavigationItem[]
     */
    public getItems(): NavigationItem[] {
        return this.items;
    }
}
