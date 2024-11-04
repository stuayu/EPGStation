import axios from 'axios';
import {configure, getLogger} from 'log4js';
const RECORDEDID: number = Number(process.env.RECORDEDID);
const VIDEOFILEID: number = Number(process.env.VIDEOFILEID);
// const RECORDEDID: number = 4556;
// const VIDEOFILEID: number = 8816;
const HOST: string = 'http://[::1]:8888';
configure({
    appenders: {
        console: {
            type: 'console',
        },
        logfile: {
            type: 'file',
            filename: './logs/update_thumbnail.log',
            pattern: 'yyyy-MM-dd', // 日付でログをローテーション
            daysToKeep: 3, // 3日分のログを保持
            compress: true // ログファイルを圧縮
        },
    },
    categories: {
        default: { appenders: ['console', 'logfile'], level: 'info' },
    },
});

const logger = getLogger();
logger.level = 'info';

async function main() {
    logger.info("start thumbnail更新");
    const thumbnails_number = await get_thumbnail_number();
    logger.info(thumbnails_number);
    await del_thumbnail(thumbnails_number);
    await create_thumbnail();
    return 0;
}

async function get_thumbnail_number(): Promise<number> {
    logger.info(`${HOST}/api/recorded/${RECORDEDID.toString()}?isHalfWidth=true`);
    return await axios.get(`${HOST}/api/recorded/${RECORDEDID.toString()}?isHalfWidth=true`).then(function (response) {
        logger.debug(response);
        logger.debug(response.data.thumbnails[0]);
        return response.data.thumbnails[0];
    });
}

async function del_thumbnail(thumbnails_number: number) {
    return await axios.delete(`${HOST}/api/thumbnails/${thumbnails_number.toString()}`).then(function (response) {
        logger.info(`delete:${ response.data }`);
    });
}

async function create_thumbnail() {
    return await axios.post(`${HOST}/api/thumbnails/videos/${VIDEOFILEID.toString()}`).then(function (response) {
        logger.info(`create:${ response.data }`);
    });
}

main();