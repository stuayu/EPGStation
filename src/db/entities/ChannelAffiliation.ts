import { BaseEntity, Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * BIT (Broadcaster Information Table) から収集した放送局の系列情報
 * 1 つのネットワークが複数系列に属する場合 (クロスネット局) があるため複合主キーにしている
 */
@Entity()
export default class ChannelAffiliation extends BaseEntity {
    @PrimaryColumn({
        type: 'integer',
    })
    public networkId!: number;

    @PrimaryColumn({
        type: 'integer',
    })
    public affiliationId!: number;

    @Column({
        type: 'bigint',
    })
    public updatedAt!: number;
}
