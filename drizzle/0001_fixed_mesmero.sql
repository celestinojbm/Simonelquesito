ALTER TYPE "public"."payment_method" ADD VALUE 'store_credit';--> statement-breakpoint
ALTER TYPE "public"."sales_channel" ADD VALUE 'subscription';--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"limit_cop" integer NOT NULL,
	"channel" text DEFAULT 'in_store' NOT NULL,
	"vouched_by" text,
	"paused_reason" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_installments" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"seq" integer NOT NULL,
	"amount_cop" integer NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_account_id" text NOT NULL,
	"type" text NOT NULL,
	"amount_cop" integer NOT NULL,
	"plan_id" text,
	"order_id" text,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_account_id" text NOT NULL,
	"order_id" text,
	"total_cop" integer NOT NULL,
	"installments_count" integer NOT NULL,
	"frequency" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"document_id" text NOT NULL,
	"birth_date" text NOT NULL,
	"front_image_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_charges" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"amount_cop" integer NOT NULL,
	"agency_split_cop" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"method" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"channel" text DEFAULT 'in_store' NOT NULL,
	"activated_by" text,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_backgrounds" (
	"id" text PRIMARY KEY NOT NULL,
	"section_key" text NOT NULL,
	"url" text,
	"color" text,
	"style" jsonb,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_items" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"qty" integer NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"name" text DEFAULT 'Mi canasta' NOT NULL,
	"frequency" text NOT NULL,
	"delivery_day" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"fulfillment" "fulfillment_type" DEFAULT 'delivery' NOT NULL,
	"address_line" text,
	"neighborhood" text,
	"zone_id" text,
	"address_references" text,
	"delivery_lat" double precision,
	"delivery_lng" double precision,
	"payment_method" text DEFAULT 'cash_on_delivery' NOT NULL,
	"instructions" text,
	"substitution_pref" "substitution_preference" DEFAULT 'similar_product' NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_order_id" text,
	"last_error" text,
	"last_reminder_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" text DEFAULT 'login' NOT NULL,
	"email" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"profile_name" text,
	"mode" text DEFAULT 'bot' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"wa_message_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "driver_lat" double precision;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "driver_lng" double precision;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "driver_location_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_lat" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_lng" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "location_token" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "acknowledged_by" text;--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "credit" text;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_installments" ADD CONSTRAINT "credit_installments_plan_id_credit_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."credit_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_credit_account_id_credit_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_plan_id_credit_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."credit_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD CONSTRAINT "credit_plans_credit_account_id_credit_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."credit_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_plans" ADD CONSTRAINT "credit_plans_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_charges" ADD CONSTRAINT "membership_charges_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_conversation_id_wa_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."wa_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_accounts_customer_ux" ON "credit_accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "credit_installments_plan_ix" ON "credit_installments" USING btree ("plan_id","seq");--> statement-breakpoint
CREATE INDEX "credit_installments_due_ix" ON "credit_installments" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "credit_ledger_account_ix" ON "credit_ledger" USING btree ("credit_account_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_plans_account_ix" ON "credit_plans" USING btree ("credit_account_id","created_at");--> statement-breakpoint
CREATE INDEX "identity_verifications_customer_ix" ON "identity_verifications" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "membership_charges_membership_ix" ON "membership_charges" USING btree ("membership_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_customer_ux" ON "memberships" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "section_bg_key_ux" ON "section_backgrounds" USING btree ("section_key");--> statement-breakpoint
CREATE INDEX "subscription_items_sub_ix" ON "subscription_items" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_ix" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_due_ix" ON "subscriptions" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "verification_codes_phone_ix" ON "verification_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_conversations_phone_ux" ON "wa_conversations" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "wa_messages_conversation_ix" ON "wa_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_wamid_ux" ON "wa_messages" USING btree ("wa_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_location_token_ux" ON "orders" USING btree ("location_token");