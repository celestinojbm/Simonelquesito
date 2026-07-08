CREATE TYPE "public"."commission_period_status" AS ENUM('open', 'pending_approval', 'approved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'assigned', 'picked_up', 'delivered', 'failed', 'returned');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_type" AS ENUM('delivery', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."inventory_movement_type" AS ENUM('purchase_receipt', 'sale', 'adjustment', 'shrinkage', 'return_in', 'return_out', 'transfer', 'initial');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('new', 'pending_payment', 'paid', 'confirmed', 'preparing', 'awaiting_substitution', 'weight_adjustment_pending', 'ready', 'assigned', 'out_for_delivery', 'delivered', 'cancelled', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('sandbox', 'wompi', 'mercado_pago', 'nequi', 'daviplata', 'bank_transfer', 'cash_on_delivery', 'card_on_delivery');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('draft', 'sent', 'partially_received', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'consumed', 'released');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('customer', 'cashier', 'picker', 'admin', 'driver', 'accountant', 'tech_admin', 'owner');--> statement-breakpoint
CREATE TYPE "public"."sales_channel" AS ENUM('web_pwa', 'whatsapp', 'rappi', 'didi', 'social', 'manual', 'pos_physical');--> statement-breakpoint
CREATE TYPE "public"."substitution_preference" AS ENUM('no_substitution', 'similar_product', 'contact_me', 'up_to_price_limit');--> statement-breakpoint
CREATE TYPE "public"."sync_job_status" AS ENUM('pending', 'running', 'completed', 'completed_with_errors', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sale_unit" AS ENUM('unit', 'pack', 'kg', 'g', 'l', 'ml', 'lb');--> statement-breakpoint
CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1;--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"actor_label" text DEFAULT 'system' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"address_line" text,
	"neighborhood" text,
	"city" text DEFAULT 'Bogotá' NOT NULL,
	"timezone" text DEFAULT 'America/Bogota' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"tax_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"opened_by" text NOT NULL,
	"opening_cop" integer NOT NULL,
	"closing_cop" integer,
	"expected_cop" integer,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"prep_area" text DEFAULT 'other' NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"period_id" text NOT NULL,
	"amount_cop" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "commission_period_status" DEFAULT 'open' NOT NULL,
	"snapshot" jsonb,
	"rate_pct_bps" integer DEFAULT 1000 NOT NULL,
	"commission_cop" bigint,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"source" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"promotion_id" text NOT NULL,
	"customer_id" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"label" text DEFAULT 'Casa' NOT NULL,
	"address_line" text NOT NULL,
	"neighborhood" text NOT NULL,
	"zone_id" text,
	"reference_notes" text,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"full_name" text NOT NULL,
	"document_id" text,
	"phone" text NOT NULL,
	"email" text,
	"birth_date" text,
	"age_verified_at" timestamp with time zone,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"driver_id" text,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"confirmation_code" text NOT NULL,
	"proof_photo_url" text,
	"payment_received_method" text,
	"incidents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"name" text NOT NULL,
	"neighborhoods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fee_cop" integer NOT NULL,
	"min_order_cop" integer DEFAULT 0 NOT NULL,
	"free_delivery_from_cop" integer,
	"eta_minutes_min" integer DEFAULT 30 NOT NULL,
	"eta_minutes_max" integer DEFAULT 60 NOT NULL,
	"slot_capacity" integer DEFAULT 10 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vehicle" text,
	"is_available" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"concept" text NOT NULL,
	"amount_cop" integer NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"incurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "external_product_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"external_id" text NOT NULL,
	"external_name" text
);
--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"encrypted_credentials" text,
	"status" text DEFAULT 'not_connected' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"lot_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"qty_received" integer NOT NULL,
	"qty_remaining" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"lot_id" text,
	"type" "inventory_movement_type" NOT NULL,
	"qty" integer NOT NULL,
	"reason" text,
	"reference_type" text,
	"reference_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"qty" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "loyalty_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"points_balance" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"recipient" text NOT NULL,
	"template" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"order_id" text,
	"customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"name_snapshot" text NOT NULL,
	"sale_unit_snapshot" text DEFAULT 'unit' NOT NULL,
	"qty" integer NOT NULL,
	"actual_weight_g" integer,
	"unit_price_cop" integer NOT NULL,
	"line_total_cop" integer NOT NULL,
	"final_line_total_cop" integer,
	"note" text,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"prep_area" text DEFAULT 'other' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"actor_user_id" text,
	"actor_label" text DEFAULT 'system' NOT NULL,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"branch_id" text NOT NULL,
	"customer_id" text,
	"channel" "sales_channel" DEFAULT 'web_pwa' NOT NULL,
	"status" "order_status" DEFAULT 'new' NOT NULL,
	"fulfillment" "fulfillment_type" DEFAULT 'delivery' NOT NULL,
	"address_line" text,
	"neighborhood" text,
	"zone_id" text,
	"address_references" text,
	"contact_phone" text NOT NULL,
	"contact_name" text NOT NULL,
	"delivery_slot" text,
	"instructions" text,
	"substitution_pref" "substitution_preference" DEFAULT 'similar_product' NOT NULL,
	"substitution_price_limit_cop" integer,
	"has_weight_items" boolean DEFAULT false NOT NULL,
	"has_restricted_items" boolean DEFAULT false NOT NULL,
	"age_declared_birth_date" text,
	"age_terms_accepted_at" timestamp with time zone,
	"id_check_required" boolean DEFAULT false NOT NULL,
	"id_checked_at" timestamp with time zone,
	"items_total_cop" integer NOT NULL,
	"discount_cop" integer DEFAULT 0 NOT NULL,
	"delivery_fee_cop" integer DEFAULT 0 NOT NULL,
	"tax_cop" integer DEFAULT 0 NOT NULL,
	"tip_cop" integer DEFAULT 0 NOT NULL,
	"total_cop" integer NOT NULL,
	"is_estimated_total" boolean DEFAULT false NOT NULL,
	"coupon_code" text,
	"loyalty_points_used" integer DEFAULT 0 NOT NULL,
	"marketplace_order_id" text,
	"marketplace_commission_cop" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payables" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"purchase_order_id" text,
	"invoice_number" text,
	"amount_cop" integer NOT NULL,
	"paid_cop" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"provider" text NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount_cop" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_ref" text,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"price_cop" integer NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"url" text NOT NULL,
	"alt" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"barcode" text,
	"sale_unit" "sale_unit" DEFAULT 'unit' NOT NULL,
	"unit_size" integer DEFAULT 1 NOT NULL,
	"sold_by_weight" boolean DEFAULT false NOT NULL,
	"estimated_weight_g" integer,
	"price_cop" integer NOT NULL,
	"compare_at_cop" integer,
	"cost_cop" integer,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"is_perishable" boolean DEFAULT false NOT NULL,
	"physical_location" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" text NOT NULL,
	"brand" text,
	"search_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"restricted_rule_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"category_id" text,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_purchase_cop" integer DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"budget_cop" integer,
	"spent_cop" integer DEFAULT 0 NOT NULL,
	"time_window" text,
	"excludes_restricted" boolean DEFAULT true NOT NULL,
	"stackable" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"qty_ordered" integer NOT NULL,
	"unit_cost_cop" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"status" "purchase_order_status" DEFAULT 'draft' NOT NULL,
	"expected_at" timestamp with time zone,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"amount_cop" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" "role" NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_permission_pk" PRIMARY KEY("role","permission")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "substitutions" (
	"id" text PRIMARY KEY NOT NULL,
	"order_item_id" text NOT NULL,
	"original_variant_id" text NOT NULL,
	"substitute_variant_id" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"price_diff_cop" integer DEFAULT 0 NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" "sync_job_status" DEFAULT 'pending' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "role" DEFAULT 'customer' NOT NULL,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_adjustments" ADD CONSTRAINT "commission_adjustments_period_id_commission_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."commission_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_product_mappings" ADD CONSTRAINT "external_product_mappings_integration_id_integration_accounts_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_product_mappings" ADD CONSTRAINT "external_product_mappings_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_account_id_loyalty_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_ix" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_action_ix" ON "audit_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_ux" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "commission_adj_period_ix" ON "commission_adjustments" USING btree ("period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_period_ux" ON "commission_periods" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "consents_customer_kind_ix" ON "consents" USING btree ("customer_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_ux" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_ix" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customers_phone_ix" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_order_ux" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "deliveries_driver_status_ix" ON "deliveries" USING btree ("driver_id","status");--> statement-breakpoint
CREATE INDEX "zones_branch_ix" ON "delivery_zones" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_mapping_ux" ON "external_product_mappings" USING btree ("integration_id","external_id");--> statement-breakpoint
CREATE INDEX "ext_mapping_variant_ix" ON "external_product_mappings" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_kind_ux" ON "integration_accounts" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "lots_variant_ix" ON "inventory_lots" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "lots_expiry_ix" ON "inventory_lots" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "movements_variant_ix" ON "inventory_movements" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "movements_ref_ix" ON "inventory_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "reservations_variant_status_ix" ON "inventory_reservations" USING btree ("variant_id","status");--> statement-breakpoint
CREATE INDEX "reservations_order_ix" ON "inventory_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_customer_ux" ON "loyalty_accounts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "loyalty_tx_account_ix" ON "loyalty_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "notifications_order_ix" ON "notifications" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_ix" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_ix" ON "order_status_events" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_ux" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "orders_status_ix" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_customer_ix" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_channel_created_ix" ON "orders" USING btree ("channel","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_marketplace_ux" ON "orders" USING btree ("channel","marketplace_order_id");--> statement-breakpoint
CREATE INDEX "payables_supplier_ix" ON "payables" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_ux" ON "payments" USING btree ("provider","idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_order_ix" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_provider_ref_ix" ON "payments" USING btree ("provider_ref");--> statement-breakpoint
CREATE INDEX "prices_variant_ix" ON "prices" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "product_images_product_ix" ON "product_images" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "variants_product_ix" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_sku_ux" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "variants_barcode_ix" ON "product_variants" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_ux" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_category_ix" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "po_items_po_ix" ON "purchase_order_items" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_ix" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "receipts_po_ix" ON "purchase_receipts" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_ix" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "sessions_user_ix" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_branch_key_ux" ON "settings" USING btree ("branch_id","key");--> statement-breakpoint
CREATE INDEX "substitutions_item_ix" ON "substitutions" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "sync_jobs_kind_ix" ON "sync_jobs" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_ux" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_ux" ON "webhook_events" USING btree ("provider","external_event_id");