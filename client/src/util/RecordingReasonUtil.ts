import * as apid from '../../../api';

export default class RecordingReasonUtil {
    public static getStatusLabel(status: apid.RecordedItem['recordingStatus']): string | undefined {
        switch (status) {
            case 'partial':
                return '一部欠落';
            case 'failed':
                return '録画失敗';
            case 'canceled':
                return 'キャンセル';
            case 'completed':
                return '完了';
            default:
                return undefined;
        }
    }

    public static getReasonLabel(reason: string | undefined): string {
        if (reason === undefined || reason === '') return '不明';
        const labels: Record<string, string> = {
            'scheduled-end': '予定終了',
            boundary: '番組境界',
            canceled: 'キャンセル',
            'tuner-handoff': 'チューナー引き継ぎ',
            superseded: '置き換え',
            obsolete: '不要',
            teardown: '終了処理',
            'write-error': '書き込みエラー',
            'reconnect-no-data': '再接続後データなし',
            'transport-lost': '受信断',
            'process-restart': 'プロセス再起動',
            error: 'エラー',
        };
        return labels[reason] ?? reason;
    }

    public static getTransportGaps(attempts: apid.RecordingAttemptItem[]): apid.RecordingTransportGap[] {
        const ordered = [...attempts].sort((a, b) => a.attemptNo - b.attemptNo);
        const gaps: apid.RecordingTransportGap[] = [];
        for (let i = 0; i + 1 < ordered.length; i++) {
            const current = ordered[i];
            const next = ordered[i + 1];
            if (typeof current.endedAt === 'number') {
                gaps.push({ startAt: current.endedAt, endAt: next.firstDataAt, reason: current.closeReason });
            }
        }
        return gaps;
    }

    public static getGapDurationSeconds(gaps: apid.RecordingTransportGap[]): number {
        return gaps.reduce((sum, gap) => sum + (gap.endAt === undefined ? 0 : Math.max(0, gap.endAt - gap.startAt) / 1000), 0);
    }
}
