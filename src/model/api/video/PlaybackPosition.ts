import { WatchStatus } from '../../../db/entities/WatchHistory';
export interface PlaybackPositionInput {
    position: number;
    duration: number;
}
export interface NormalizedPlaybackPosition extends PlaybackPositionInput {
    status: WatchStatus;
}
export function normalizePlaybackPosition(input: PlaybackPositionInput): NormalizedPlaybackPosition {
    if (!Number.isFinite(input.position) || input.position < 0) throw new Error('PlaybackPositionIsInvalid');
    if (!Number.isFinite(input.duration) || input.duration <= 0) throw new Error('PlaybackDurationIsInvalid');
    const duration = Math.round(input.duration);
    const position = Math.min(Math.round(input.position), duration);
    const status: WatchStatus = position === 0 ? 'unwatched' : position / duration >= 0.9 ? 'watched' : 'watching';
    return { position, duration, status };
}
