CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS flow_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  agent_id TEXT NOT NULL DEFAULT 'general',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flow_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES flow_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  agent_id TEXT,
  text TEXT NOT NULL DEFAULT '',
  cards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  display_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flow_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT,
  title TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  explorer_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flow_conversations_wallet_idx
  ON flow_conversations (LOWER(wallet), archived, updated_at DESC);
CREATE INDEX IF NOT EXISTS flow_messages_conversation_idx
  ON flow_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS flow_activity_wallet_idx
  ON flow_activity (LOWER(wallet), created_at DESC);
