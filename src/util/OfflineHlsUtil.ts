export interface OfflineHlsAudioTrack {
    track: string;
    name: string;
    streamIndex: number;
    isDualMono: false;
    codec: null;
    language: string | null;
    channels: null;
}

const parseAttributes = (line: string): Map<string, string> => {
    const attributes = new Map<string, string>();
    const value = line.slice(line.indexOf(':') + 1);
    for (const match of value.matchAll(/([A-Z-]+)=((?:"(?:[^"]|"")*")|[^,]*)/gu)) {
        const raw = match[2];
        attributes.set(
            match[1],
            raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw,
        );
    }

    return attributes;
};

/** 保存済み HLS master の音声 rendition を DPlayer 用一覧へ変換する。 */
export const parseOfflineHlsAudioTracks = (master: string): OfflineHlsAudioTrack[] => {
    const tracks: OfflineHlsAudioTrack[] = [];
    for (const line of master.split(/\r?\n/gu)) {
        if (line.startsWith('#EXT-X-MEDIA:') === false) continue;
        const attributes = parseAttributes(line);
        if (attributes.get('TYPE') !== 'AUDIO' || attributes.has('URI') === false) continue;
        const streamIndex = tracks.length;
        tracks.push({
            track: String(streamIndex),
            name: attributes.get('NAME') || (streamIndex === 0 ? '主音声' : '副音声'),
            streamIndex,
            isDualMono: false,
            codec: null,
            language: attributes.get('LANGUAGE') ?? null,
            channels: null,
        });
    }

    return tracks;
};
