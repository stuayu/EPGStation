'use strict';

const { result } = require('./output');
const OfflineStreamParser = require('../../../dist/util/OfflineStreamParser').default;

/**
 * 本番の original-hevc Offline 保存ストリーム先頭だけを読み、複数音声レコードを検査する。
 * ブラウザーを使わず、init/master と各 role の最初の segment が揃った時点で切断する。
 */
const runHevcDualAudio = async options => {
    if (typeof options.baseUrl !== 'string' || options.baseUrl.length === 0)
        return result('hevc-dual-audio', false, {}, '--base-url が必要');
    const videoFileId = Number(options.videoFileId);
    if (!Number.isSafeInteger(videoFileId))
        return result('hevc-dual-audio', false, {}, '--video-file-id が必要');

    const baseUrl = options.baseUrl.replace(/\/$/u, '');
    const url = `${baseUrl}/api/videos/${videoFileId}/offline?profile=original-hevc&audioTrack=all`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
    const parser = new OfflineStreamParser();
    const roles = new Set();
    const segments = new Map();
    let master = null;
    let bytesRead = 0;
    let stoppedAfterHeader = false;

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok || response.body === null) {
            const body = await response.text().catch(() => '');
            return result('hevc-dual-audio', false, { url, status: response.status, body: body.slice(0, 500) }, 'Offline 保存 API が失敗');
        }

        const reader = response.body.getReader();
        for (;;) {
            const item = await reader.read();
            if (item.done === true) break;
            bytesRead += item.value.byteLength;
            for (const event of parser.push(item.value)) {
                if (event.type === 'init') roles.add(event.init.role);
                if (event.type === 'master') master = Buffer.from(event.data).toString('utf8');
                if (event.type === 'segment') segments.set(event.segment.role, (segments.get(event.segment.role) ?? 0) + 1);
            }

            if (roles.has('video') && roles.has('audio0') && roles.has('audio1') && master !== null && ['video', 'audio0', 'audio1'].every(role => (segments.get(role) ?? 0) > 0)) {
                stoppedAfterHeader = true;
                await reader.cancel();
                break;
            }
        }

        const masterHasAudio =
            master !== null &&
            master.includes('#EXT-X-MEDIA:TYPE=AUDIO') &&
            master.includes('AUDIO="audio"') &&
            master.includes('URI="audio0.m3u8"') &&
            master.includes('URI="audio1.m3u8"') &&
            /CODECS="[^"]*hvc1[^"]*,mp4a\.40\.2[^"]*"/u.test(master);
        const checkedRoles = [...roles].sort();
        const segmentCounts = Object.fromEntries([...segments.entries()].sort());
        const passed = stoppedAfterHeader && checkedRoles.join(',') === 'audio0,audio1,video' && masterHasAudio;
        return result(
            'hevc-dual-audio',
            passed,
            { url, status: response.status, bytesRead, roles: checkedRoles, segmentCounts, master, stoppedAfterHeader },
            passed ? null : 'video/audio0/audio1 の init・segment または master 音声属性が不足',
        );
    } catch (error) {
        if (error?.name === 'AbortError' && stoppedAfterHeader === true) {
            return result('hevc-dual-audio', false, { url, bytesRead, stoppedAfterHeader }, 'ストリーム切断後の AbortError');
        }
        return result('hevc-dual-audio', false, { url, bytesRead }, error instanceof Error ? error.message : String(error));
    } finally {
        clearTimeout(timeout);
        controller.abort();
    }
};

module.exports = runHevcDualAudio;
