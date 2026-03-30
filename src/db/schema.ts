import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const matterTypeEnum = pgEnum('matter_type', [
  'residential_conveyancing',
  'family_law',
]);

export const stageStatusEnum = pgEnum('stage_status', [
  'not_started',
  'in_progress',
  'completed',
  'skipped',
]);

export const actionStatusEnum = pgEnum('action_status', [
  'pending',
  'in_progress',
  'completed',
  'skipped',
]);

// ─── JSONB Types ──────────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

// ─── Tables ───────────────────────────────────────────────────────────────────

export const matters = pgTable('matters', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: matterTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  currentStageOrder: integer('current_stage_order').default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const matterStages = pgTable('matter_stages', {
  id: uuid('id').defaultRandom().primaryKey(),
  matterId: uuid('matter_id')
    .notNull()
    .references(() => matters.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  stageOrder: integer('stage_order').notNull(),
  status: stageStatusEnum('status').default('not_started').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const matterActions = pgTable('matter_actions', {
  id: uuid('id').defaultRandom().primaryKey(),
  stageId: uuid('stage_id')
    .notNull()
    .references(() => matterStages.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  aiSuggested: boolean('ai_suggested').default(false).notNull(),
  status: actionStatusEnum('status').default('pending').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  notes: text('notes'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  matterId: uuid('matter_id')
    .notNull()
    .references(() => matters.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 255 }),
  messages: jsonb('messages').$type<Message[]>().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const mattersRelations = relations(matters, ({ many }) => ({
  stages: many(matterStages),
  conversations: many(conversations),
}));

export const matterStagesRelations = relations(matterStages, ({ one, many }) => ({
  matter: one(matters, {
    fields: [matterStages.matterId],
    references: [matters.id],
  }),
  actions: many(matterActions),
}));

export const matterActionsRelations = relations(matterActions, ({ one }) => ({
  stage: one(matterStages, {
    fields: [matterActions.stageId],
    references: [matterStages.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one }) => ({
  matter: one(matters, {
    fields: [conversations.matterId],
    references: [matters.id],
  }),
}));
