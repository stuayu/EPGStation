import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import mirakurun from 'mirakurun';
import * as path from 'path';
import IConfigFile from './IConfigFile';
import IConfiguration from './IConfiguration';
import IMirakurunClientModel from './IMirakurunClientModel';

/**
 * mirakurun client のインスタンスを生成する
 */
@injectable()
export default class MirakurunClientModel implements IMirakurunClientModel {
    private client: mirakurun;
    private config: IConfigFile;

    constructor(@inject('IConfiguration') conf: IConfiguration) {
        this.client = new mirakurun();
        this.config = conf.getConfig();

        this.setClient();
    }

    /**
     * mirakurun client の設定
     */
    private setClient(): void {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json')).toString());
        const mirakurunPath = this.config.mirakurunPath;
        // API エンドポイントのベースパス (未設定時はクライアントの従来デフォルト値をそのまま使う)
        const apiPath = this.config.mirakurunAPIPath;

        /**
         * Copyright (c) 2016 Yuki KAN and Chinachu Project Contributors
         * Released under the MIT license
         * http://opensource.org/licenses/mit-license.php
         */
        if (/\\\\.\\pipe/.test(mirakurunPath)) {
            this.client.socketPath = mirakurunPath;
            // named pipe は URL 由来の basePath を持たないため mirakurunAPIPath が明示設定されている場合のみ上書きする
            if (typeof apiPath !== 'undefined') {
                this.client.basePath = apiPath;
            }
        } else if (/(?:\/|\+)unix:/.test(mirakurunPath) === true) {
            const standardFormat = /^http\+unix:\/\/([^\/]+)(\/?.*)$/;
            const legacyFormat = /^http:\/\/unix:([^:]+):?(.*)$/;

            if (standardFormat.test(mirakurunPath) === true) {
                this.client.socketPath = mirakurunPath.replace(standardFormat, '$1').replace(/%2F/g, '/');
                this.client.basePath = path.posix.join(
                    mirakurunPath.replace(standardFormat, '$2'),
                    apiPath ?? this.client.basePath,
                );
            } else {
                this.client.socketPath = mirakurunPath.replace(legacyFormat, '$1');
                this.client.basePath = path.posix.join(
                    mirakurunPath.replace(legacyFormat, '$2'),
                    apiPath ?? this.client.basePath,
                );
            }
        } else {
            const urlObject = new URL(mirakurunPath);
            this.client.https = urlObject.protocol === 'https:';
            this.client.host = urlObject.hostname;
            this.client.port =
                urlObject.port !== '' ? Number(urlObject.port) : this.client.https ? 443 : 80;
            this.client.basePath = path.posix.join(urlObject.pathname, apiPath ?? this.client.basePath);
        }

        this.client.userAgent = `${pkg.name}/${pkg.version}`;
    }

    /**
     * mirakurun client を返す
     * @return mirakurun client
     */
    public getClient(): mirakurun {
        return this.client;
    }
}
