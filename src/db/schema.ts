import { relations } from "drizzle-orm";
import {
	boolean,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

// ─── Common Columns ──────────────────────────────────────────────────────────

const baseColumns = {
	id: uuid("id").defaultRandom().primaryKey(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
};

// ─── Enums ────────────────────────────────────────────────────────────────────

export const matterTypeEnum = pgEnum("matter_type", [
	"residential_conveyancing",
]);

export const progressStatusEnum = pgEnum("progress_status", [
	"not_started",
	"in_progress",
	"blocked",
	"completed",
	"skipped",
]);

export const conveyancingStageEnum = pgEnum("conveyancing_stage", [
	"engagement_and_onboarding",
	"pre_contract_review",
	"searches_and_investigations",
	"pre_contract_enquiries",
	"finance_and_mortgage",
	"report_to_client",
	"exchange_of_contracts",
	"pre_settlement",
	"settlement",
	"post_settlement",
]);

export const matterStatusEnum = pgEnum("matter_status", [
	"open",
	"on_hold",
	"completed",
	"archived",
]);

export const stateEnum = pgEnum("australian_state", [
	"nsw",
	"vic",
	"qld",
	"wa",
	"sa",
	"tas",
	"act",
	"nt",
]);

export const messageRoleEnum = pgEnum("message_role", [
	"user",
	"assistant",
	"system",
]);

// ─── Tables ───────────────────────────────────────────────────────────────────

export const properties = pgTable("properties", {
	...baseColumns,
	streetAddress: varchar("street_address", { length: 255 }).notNull(),
	suburb: varchar("suburb", { length: 255 }).notNull(),
	state: stateEnum("state").notNull(),
	postcode: varchar("postcode", { length: 4 }).notNull(),
	lotNumber: varchar("lot_number", { length: 50 }),
	planNumber: varchar("plan_number", { length: 50 }),
	titleReference: varchar("title_reference", { length: 100 }),
});

export const matters = pgTable("matters", {
	...baseColumns,
	referenceNumber: varchar("reference_number", { length: 50 }).notNull().unique(),
	type: matterTypeEnum("type").notNull(),
	status: matterStatusEnum("status").default("open").notNull(),
	propertyId: uuid("property_id")
		.notNull()
		.references(() => properties.id, { onDelete: "restrict" }),
	title: varchar("title", { length: 255 }).notNull(),
	description: text("description"),
	currentStage: conveyancingStageEnum("current_stage")
		.default("engagement_and_onboarding")
		.notNull(),
});

export const matterStages = pgTable(
	"matter_stages",
	{
		...baseColumns,
		matterId: uuid("matter_id")
			.notNull()
			.references(() => matters.id, { onDelete: "cascade" }),
		stage: conveyancingStageEnum("stage").notNull(),
		status: progressStatusEnum("status").default("not_started").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		notes: text("notes"),
	},
	(table) => [unique().on(table.matterId, table.stage)],
);

export const matterActions = pgTable("matter_actions", {
	...baseColumns,
	matterStageId: uuid("matter_stage_id")
		.notNull()
		.references(() => matterStages.id, { onDelete: "cascade" }),
	description: text("description").notNull(),
	aiSuggested: boolean("ai_suggested").default(false).notNull(),
	status: progressStatusEnum("status").default("not_started").notNull(),
	dueDate: timestamp("due_date", { withTimezone: true }),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	notes: text("notes"),
});

export const aiChats = pgTable("ai_chats", {
	id: uuid("id").defaultRandom().primaryKey(),
	matterStageId: uuid("matter_stage_id")
		.notNull()
		.references(() => matterStages.id, { onDelete: "cascade" }),
	title: varchar("title", { length: 255 }),
	model: varchar("model", { length: 100 }),
	sessionId: varchar("session_id", { length: 255 }),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const aiChatMessages = pgTable("ai_chat_messages", {
	id: uuid("id").defaultRandom().primaryKey(),
	aiChatId: uuid("ai_chat_id")
		.notNull()
		.references(() => aiChats.id, { onDelete: "cascade" }),
	role: messageRoleEnum("role").notNull(),
	content: text("content").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const propertiesRelations = relations(properties, ({ many }) => ({
	matters: many(matters),
}));

export const mattersRelations = relations(matters, ({ one, many }) => ({
	property: one(properties, {
		fields: [matters.propertyId],
		references: [properties.id],
	}),
	matterStages: many(matterStages),
}));

export const matterStagesRelations = relations(
	matterStages,
	({ one, many }) => ({
		matter: one(matters, {
			fields: [matterStages.matterId],
			references: [matters.id],
		}),
		matterActions: many(matterActions),
		aiChats: many(aiChats),
	}),
);

export const matterActionsRelations = relations(matterActions, ({ one }) => ({
	matterStage: one(matterStages, {
		fields: [matterActions.matterStageId],
		references: [matterStages.id],
	}),
}));

export const aiChatsRelations = relations(
	aiChats,
	({ one, many }) => ({
		matterStage: one(matterStages, {
			fields: [aiChats.matterStageId],
			references: [matterStages.id],
		}),
		aiChatMessages: many(aiChatMessages),
	}),
);

export const aiChatMessagesRelations = relations(
	aiChatMessages,
	({ one }) => ({
		aiChat: one(aiChats, {
			fields: [aiChatMessages.aiChatId],
			references: [aiChats.id],
		}),
	}),
);
