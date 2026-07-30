import { BaseEntity, Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import VideoFile from './VideoFile';

/**
 * 録画ファイルの TS (PSI/SI) を解析して得られた放送情報
 *
 * ファイル名や program.txt からの推定ではなく TS 実体から取れた値を保持する。
 * 取り込んだ外部ファイルの放送局・番組の特定と、実況コメントの時刻合わせに使う。
 */
@Entity()
export default class VideoFileTsInfo extends BaseEntity {
    @PrimaryColumn({
        type: 'integer',
    })
    public videoFileId!: number;

    // --- 放送・サービスの識別子 (SDT / PAT / NIT) ---

    @Column({
        type: 'integer',
        nullable: true,
    })
    public networkId: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public transportStreamId: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public serviceId: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public serviceType: number | null = null;

    // 放送局名 (service_descriptor)
    @Column({
        type: 'text',
        nullable: true,
    })
    public serviceName: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public serviceProviderName: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public networkName: string | null = null;

    // --- EIT[p/f] present の番組情報 ---

    @Column({
        type: 'integer',
        nullable: true,
    })
    public eventId: number | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public eventName: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public eventDescription: string | null = null;

    @Column({
        type: 'text',
        nullable: true,
    })
    public eventExtended: string | null = null;

    // 番組の開始時刻 (UNIX 時刻・ミリ秒)
    @Column({
        type: 'bigint',
        nullable: true,
    })
    public eventStartAt: number | null = null;

    // 番組の長さ (秒)
    @Column({
        type: 'integer',
        nullable: true,
    })
    public eventDuration: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre1: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre1: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre2: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre2: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public genre3: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public subGenre3: number | null = null;

    // --- PMT のストリーム構成 ---

    @Column({
        type: 'integer',
        nullable: true,
    })
    public videoStreamType: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public videoPid: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public audioStreamType: number | null = null;

    @Column({
        type: 'integer',
        nullable: true,
    })
    public audioPid: number | null = null;

    /**
     * ファイル先頭付近で最初に現れた TDT / TOT の放送時刻 (UNIX 時刻・ミリ秒)
     * 録画開始時刻そのものなので、ファイル更新時刻からの推定より正確
     */
    @Column({
        type: 'bigint',
        nullable: true,
    })
    public firstTdtAt: number | null = null;

    // 解析した時刻 (UNIX 時刻・ミリ秒)
    @Column({
        type: 'bigint',
    })
    public analyzedAt!: number;

    @OneToOne(() => VideoFile, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'videoFileId' })
    public videoFile?: VideoFile;
}
