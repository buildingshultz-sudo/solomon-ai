CREATE TABLE `conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL DEFAULT 'New conversation',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `finance_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('income','expense') NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`category` varchar(128) NOT NULL DEFAULT 'general',
	`description` varchar(500) DEFAULT '',
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `finance_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` enum('brand_voice','business_context','decision','project','performance','preference','general') NOT NULL DEFAULT 'general',
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`tags` varchar(500) DEFAULT '',
	`metadata` json,
	`importance` int NOT NULL DEFAULT 5,
	`pinned` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`role` enum('system','user','assistant','tool') NOT NULL,
	`content` text NOT NULL,
	`toolName` varchar(128),
	`toolPayload` json,
	`modelTier` enum('fast','smart'),
	`modelName` varchar(128),
	`tokensIn` int DEFAULT 0,
	`tokensOut` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`kind` enum('morning_brief','content_calendar','email_check','youtube_analytics','social_post','custom') NOT NULL,
	`cron` varchar(64) NOT NULL DEFAULT '0 6 * * *',
	`enabled` boolean NOT NULL DEFAULT true,
	`payload` json,
	`lastRunAt` timestamp,
	`lastResult` text,
	`nextRunAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduled_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(128) NOT NULL,
	`value` text NOT NULL DEFAULT (''),
	`category` varchar(64) NOT NULL DEFAULT 'general',
	`isSecret` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`status` enum('active','in_progress','completed','blocked') NOT NULL DEFAULT 'active',
	`priority` enum('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
	`project` varchar(128) DEFAULT 'general',
	`dueAt` timestamp,
	`autonomous` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tool_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`toolName` varchar(128) NOT NULL,
	`status` enum('success','error','stub') NOT NULL,
	`input` json,
	`output` json,
	`errorMessage` text,
	`durationMs` int DEFAULT 0,
	`triggeredBy` varchar(64) DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tool_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `conv_user_idx` ON `conversations` (`userId`);--> statement-breakpoint
CREATE INDEX `fin_type_idx` ON `finance_entries` (`type`);--> statement-breakpoint
CREATE INDEX `mem_cat_idx` ON `memories` (`category`);--> statement-breakpoint
CREATE INDEX `msg_conv_idx` ON `messages` (`conversationId`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tool_runs_tool_idx` ON `tool_runs` (`toolName`);