-- Схема Ovrly для PostgreSQL.
-- Состояние комнат пока хранится как JSONB: позже медиа переедет в R2,
-- а в state останутся только ссылки и настройки элементов.
CREATE TABLE IF NOT EXISTS links (
	login text PRIMARY KEY,
	token text NOT NULL UNIQUE,
	updated_at timestamptz NOT NULL DEFAULT now(),
	user_token text,
	user_token_expires bigint,
	refresh_token text
);

CREATE TABLE IF NOT EXISTS invites (
	owner text NOT NULL,
	moderator text NOT NULL,
	status text NOT NULL CHECK (status IN ('pending', 'accepted')),
	suspended boolean NOT NULL DEFAULT false,
	invited_at timestamptz NOT NULL DEFAULT now(),
	visited_at timestamptz,
	accepted_at timestamptz,
	PRIMARY KEY (owner, moderator)
);

CREATE INDEX IF NOT EXISTS invites_moderator_idx ON invites (moderator);

CREATE TABLE IF NOT EXISTS rooms (
	key text PRIMARY KEY,
	owner text,
	state jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rooms_updated_at_idx ON rooms (updated_at);

CREATE TABLE IF NOT EXISTS settings (
	key text PRIMARY KEY,
	value jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);
