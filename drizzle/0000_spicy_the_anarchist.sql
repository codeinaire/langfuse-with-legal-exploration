CREATE TYPE "public"."conveyancing_stage" AS ENUM('engagement_and_onboarding', 'pre_contract_review', 'searches_and_investigations', 'pre_contract_enquiries', 'finance_and_mortgage', 'report_to_client', 'exchange_of_contracts', 'pre_settlement', 'settlement', 'post_settlement');--> statement-breakpoint
CREATE TYPE "public"."matter_status" AS ENUM('open', 'on_hold', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."matter_type" AS ENUM('residential_conveyancing');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."progress_status" AS ENUM('not_started', 'in_progress', 'blocked', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."australian_state" AS ENUM('nsw', 'vic', 'qld', 'wa', 'sa', 'tas', 'act', 'nt');--> statement-breakpoint
CREATE TABLE "ai_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_chat_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matter_stage_id" uuid NOT NULL,
	"title" varchar(255),
	"model" varchar(100),
	"session_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matter_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matter_stage_id" uuid NOT NULL,
	"description" text NOT NULL,
	"ai_suggested" boolean DEFAULT false NOT NULL,
	"status" "progress_status" DEFAULT 'not_started' NOT NULL,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "matter_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matter_id" uuid NOT NULL,
	"stage" "conveyancing_stage" NOT NULL,
	"status" "progress_status" DEFAULT 'not_started' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "matter_stages_matter_id_stage_unique" UNIQUE("matter_id","stage")
);
--> statement-breakpoint
CREATE TABLE "matters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reference_number" varchar(50) NOT NULL,
	"type" "matter_type" NOT NULL,
	"status" "matter_status" DEFAULT 'open' NOT NULL,
	"property_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"current_stage" "conveyancing_stage" DEFAULT 'engagement_and_onboarding' NOT NULL,
	CONSTRAINT "matters_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"street_address" varchar(255) NOT NULL,
	"suburb" varchar(255) NOT NULL,
	"state" "australian_state" NOT NULL,
	"postcode" varchar(4) NOT NULL,
	"lot_number" varchar(50),
	"plan_number" varchar(50),
	"title_reference" varchar(100)
);
--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_ai_chat_id_ai_chats_id_fk" FOREIGN KEY ("ai_chat_id") REFERENCES "public"."ai_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chats" ADD CONSTRAINT "ai_chats_matter_stage_id_matter_stages_id_fk" FOREIGN KEY ("matter_stage_id") REFERENCES "public"."matter_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_actions" ADD CONSTRAINT "matter_actions_matter_stage_id_matter_stages_id_fk" FOREIGN KEY ("matter_stage_id") REFERENCES "public"."matter_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matter_stages" ADD CONSTRAINT "matter_stages_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;