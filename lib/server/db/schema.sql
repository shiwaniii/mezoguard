-- FROZEN schema (brief §7.2). Postgres 15+ / PGlite. Amounts stored as numeric(78,0) strings of native units; ratios as numeric(78,0) 1e18-scaled.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique not null,          -- lowercase
  email text,
  telegram_chat_id text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);
create table if not exists tracked_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wallet_address text not null,
  chain_id int not null default 31611,
  label text,
  tracking_status text not null default 'active', -- active | paused
  created_at timestamptz not null default now(),
  unique (user_id, wallet_address, chain_id)
);
create table if not exists protocols (
  id text primary key,                            -- 'mezo-musd-trove' | 'morpho-blue'
  name text not null,
  adapter text not null,
  chain_id int not null,
  enabled boolean not null default true,
  configuration jsonb not null default '{}'
);
create table if not exists loan_positions (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  protocol_id text not null references protocols(id),
  protocol_position_id text not null,
  collateral_asset text not null,
  collateral_amount numeric(78,0) not null,
  debt_asset text not null,
  debt_amount numeric(78,0) not null,
  collateral_value numeric(78,0) not null,
  collateral_ratio numeric(78,0) not null,
  liquidation_price numeric(78,0) not null,
  risk_level text not null,
  status text not null default 'active',
  last_synced_at timestamptz not null default now(),
  onchain_updated_at timestamptz,
  onchain_block bigint,
  unique (protocol_id, protocol_position_id)
);
create table if not exists risk_snapshots (
  id bigserial primary key,
  position_id uuid not null references loan_positions(id) on delete cascade,
  btc_price numeric(78,0) not null,
  price_stale boolean not null default false,
  collateral_value numeric(78,0) not null,
  debt_value numeric(78,0) not null,
  collateral_ratio numeric(78,0) not null,
  liquidation_price numeric(78,0) not null,
  risk_level text not null,
  block_number bigint,
  timestamp timestamptz not null default now()
);
create index if not exists risk_snapshots_pos_ts on risk_snapshots(position_id, timestamp desc);
create table if not exists alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wallet_address text not null,
  position_id uuid references loan_positions(id) on delete cascade, -- null = all positions of wallet
  trigger_type text not null, -- cr_below | btc_drop_pct | level_at_least | redemption | liquidation_price_within_pct
  threshold text not null,    -- decimal string; meaning depends on trigger_type (see docs/ALERT_SYSTEM.md)
  notification_channels text[] not null default '{in_app}', -- in_app | email | telegram | browser
  cooldown_minutes int not null default 60,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
-- per-rule edge state for threshold-crossing detection (armed=true means next crossing fires)
create table if not exists alert_rule_state (
  rule_id uuid not null references alert_rules(id) on delete cascade,
  position_id uuid not null references loan_positions(id) on delete cascade,
  armed boolean not null default true,
  last_fired_at timestamptz,
  last_value text,
  primary key (rule_id, position_id)
);
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  position_id uuid references loan_positions(id) on delete set null,
  rule_id uuid references alert_rules(id) on delete set null,
  alert_type text not null,
  severity text not null,            -- info | watch | high | critical
  message text not null,
  recommended_action text,
  payload jsonb not null default '{}', -- wallet, protocol, positionId, cr, price, liqPrice, level, link, timestamp
  dedupe_key text unique not null,   -- idempotency: rule+position+crossing epoch
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  resolved_at timestamptz
);
create table if not exists notification_deliveries (
  id bigserial primary key,
  notification_id uuid not null references notifications(id) on delete cascade,
  channel text not null,
  status text not null,              -- sent | failed | skipped
  provider_id text,
  error text,
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  unique (notification_id, channel)
);
create table if not exists protective_actions (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  position_id uuid references loan_positions(id) on delete set null,
  action_type text not null,         -- repay | add_collateral | close | automation_repay
  estimated_amount numeric(78,0) not null,
  transaction_hash text unique,
  status text not null,              -- prepared | submitted | confirmed | failed
  created_at timestamptz not null default now()
);
create table if not exists indexed_events (
  chain_id int not null,
  contract_address text not null,
  event_name text not null,
  transaction_hash text not null,
  block_number bigint not null,
  log_index int not null,
  args jsonb not null default '{}',
  processed_at timestamptz not null default now(),
  primary key (chain_id, transaction_hash, log_index)
);
create table if not exists indexer_cursors (
  key text primary key,
  block_number bigint not null,
  updated_at timestamptz not null default now()
);
create table if not exists worker_heartbeats (
  worker text primary key,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_status text,
  last_error text,
  runs bigint not null default 0
);
insert into protocols (id, name, adapter, chain_id) values
  ('mezo-musd-trove', 'Mezo MUSD Trove', 'MezoTroveAdapter', 31611),
  ('morpho-blue', 'Morpho Blue (Mezo)', 'MorphoMarketAdapter', 31611)
on conflict (id) do nothing;
