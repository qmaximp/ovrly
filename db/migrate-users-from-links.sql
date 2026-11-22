-- Одноразовая миграция: существующие Twitch-привязки из links становятся
-- аккаунтами в отдельной таблице users. Повторный запуск безопасен.
--
-- Запуск:
--   psql "$DATABASE_URL" -f db/migrate-users-from-links.sql
--
-- Пароля у таких аккаунтов нет: вход остаётся через Twitch. При следующем
-- OAuth-входе приложение найдёт запись по twitch_login и обновит профиль.

INSERT INTO users (id, twitch_login, display_name, created_at)
SELECT gen_random_uuid(), lower(l.login), l.login, l.updated_at
FROM links l
WHERE l.login IS NOT NULL
  AND btrim(l.login) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM users u
    WHERE lower(u.twitch_login) = lower(l.login)
  )
ON CONFLICT DO NOTHING;
