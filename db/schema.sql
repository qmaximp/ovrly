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
	obs_access text NOT NULL DEFAULT 'control' CHECK (obs_access IN ('none', 'control')),
	invited_at timestamptz NOT NULL DEFAULT now(),
	visited_at timestamptz,
	accepted_at timestamptz,
	PRIMARY KEY (owner, moderator)
);

ALTER TABLE invites ADD COLUMN IF NOT EXISTS obs_access text NOT NULL DEFAULT 'control';

CREATE INDEX IF NOT EXISTS invites_moderator_idx ON invites (moderator);

-- право на OBS появилось позже; у существующих модераторов оставляем доступ
ALTER TABLE invites ADD COLUMN IF NOT EXISTS obs_access text NOT NULL DEFAULT 'control';

CREATE TABLE IF NOT EXISTS rooms (
	key text PRIMARY KEY,
	owner text,
	state jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rooms_updated_at_idx ON rooms (updated_at);

-- Аккаунты Ovrly — отдельная таблица, не связанная с links (links — это
-- привязка Twitch-логина к комнате и токенам). Здесь хранится вход по почте
-- и/или Twitch, хэш пароля (scrypt), профиль и даты входов.
CREATE TABLE IF NOT EXISTS users (
	id uuid PRIMARY KEY,
	email text UNIQUE,
	password_hash text,
	twitch_login text UNIQUE,
	display_name text NOT NULL,
	avatar text,
	created_at timestamptz NOT NULL DEFAULT now(),
	last_login_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS users_twitch_lower_idx
	ON users (lower(twitch_login));

CREATE TABLE IF NOT EXISTS settings (
	key text PRIMARY KEY,
	value jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

-- Публичная библиотека кастомных виджетов. definition — снимок WidgetDefinition,
-- source_id — id виджета в личной библиотеке автора (для повторной публикации).
CREATE TABLE IF NOT EXISTS widget_library (
	id text PRIMARY KEY,
	owner text NOT NULL,
	source_id text NOT NULL,
	name text NOT NULL,
	definition jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (owner, source_id)
);

CREATE INDEX IF NOT EXISTS widget_library_updated_idx
	ON widget_library (updated_at DESC);

-- Ключи OBS-моста: одна комната = одна ссылка на пульт. В базе лежит только
-- sha256 ключа (для проверки) и ключ, зашифрованный секретом сайта (чтобы
-- владелец мог перечитать ссылку). Утечка дампа без секрета доступа не даёт.
CREATE TABLE IF NOT EXISTS obs_access (
	room text PRIMARY KEY,
	key_hash text NOT NULL,
	key_enc text,
	created_at timestamptz NOT NULL DEFAULT now()
);
