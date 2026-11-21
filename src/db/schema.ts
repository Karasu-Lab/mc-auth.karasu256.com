import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const mcAuthSession = sqliteTable('mc_auth_session', {
  id: text('id').primaryKey(),
  mcUuid: text('mc_uuid').notNull(),
  mcName: text('mc_name').notNull(),
  skin: text('skin'),
  rawCode: text('raw_code'),
  codeHash: text('code_hash'),
  status: text('status', { enum: ['pending', 'kicked', 'verified'] })
    .notNull()
    .default('pending'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const mcProfile = sqliteTable('mc_profile', {
  mcUuid: text('mc_uuid').primaryKey(),
  mcName: text('mc_name').notNull(),
  skin: text('skin'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const mcOnlinePlayer = sqliteTable('mc_online_player', {
  mcUuid: text('mc_uuid').primaryKey(),
  mcName: text('mc_name').notNull(),
  joinedAt: integer('joined_at', { mode: 'timestamp_ms' }).notNull(),
});
