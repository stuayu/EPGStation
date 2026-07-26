import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
@Entity({ name: 'metadata_provider_cache' })
@Index('IDX_metadata_provider_cache_key', ['provider', 'externalId'], { unique: true })
export default class MetadataProviderCache extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' }) id!: number;
    @Column({ type: 'text' }) provider!: string;
    @Column({ type: 'text' }) externalId!: string;
    @Column({ type: 'text' }) payload!: string;
    @Column({ type: 'text', nullable: true }) etag!: string | null;
    @Column({ type: 'bigint' }) expiresAt!: number;
    @Column({ type: 'bigint' }) updatedAt!: number;
}
