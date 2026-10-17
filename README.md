# Ovrly — OBS управление оверлеем

Панель управления стримом для модератора.

## Возможности

- Картинки (с ПК или по URL) + перетаскивание в реальном времени
- Видео (с ПК или по URL) + перетаскивание в реальном времени
- GIF (с ПК или по URL) + перетаскивание в реальном времени
- Рабочее поле с буферной зоной вокруг экрана: паркуйте элементы за пределами кадра
  и выводите их на экран перетаскиванием (за кадром они остаются загруженными)
- Сайты и YouTube через iframe (YouTube-ссылки автоматически конвертируются в embed)
- Текст + перетаскивание
- Таймер (обратный/прямой отсчёт, пауза/возобновление)
- Управление сценами и источниками OBS (вкл/выкл, перемещение, папки)

## Локальный запуск

```bash
cd ovrly
npm install
npm run dev
```

Панель: http://localhost:3000/panel (только по ссылке из кабинета, с токеном комнаты)
Оверлей: http://localhost:3000/overlay

Для «боевого» режима (меньше памяти и CPU, чем у dev-сборки):

```bash
npm run build
npm start
```

(работает и на Windows: режим переключается флагом `--prod`, а не переменной окружения)

## Добавление оверлея в OBS

1. Источник → Browser Source
2. URL: http://localhost:3000/overlay
3. Размер: 1920×1080

## OBS WebSocket

1. OBS → Tools → WebSocket Server Settings → Enable
2. Порт: 4455
3. В панели: вкладка "Управление OBS" → подключиться

## Авторизация через Twitch

Главная страница — вход через Twitch OAuth. После входа открывается личный кабинет
с генератором личных ссылок на панель и оверлей.

Настройка (один раз):

1. Зайдите на https://dev.twitch.tv/console → **Register Your Application**:
   - Name — любое;
   - OAuth Redirect URLs — `http://localhost:3000/api/auth/twitch/callback`
     (для Render добавьте отдельной строкой `https://ваш-домен.onrender.com/api/auth/twitch/callback`);
   - Category — **Website Integration**, Client Type — **Confidential**.
2. Скопируйте **Client ID** и сгенерируйте **Client Secret**.
3. Впишите в `.env.local`:
   ```
   TWITCH_CLIENT_ID=ваш_client_id
   TWITCH_CLIENT_SECRET=ваш_client_secret
   # если порт отличается от 3000 — укажите redirect URL явно:
   # TWITCH_REDIRECT_URI=http://localhost:3001/api/auth/twitch/callback
   ```
4. Перезапустите сервер.

## Деплой

⚠️ **Vercel не подходит.** Проект — это постоянный Node-сервер (`server.js`) + Socket.io,
состояние оверлея живёт в памяти сервера. Vercel — serverless: постоянных процессов и
WebSocket-соединений там нет, панель и оверлей не смогут синхронизироваться.

### Railway (рекомендуется — работает без изменений кода):

1. Загрузите код в GitHub-репозиторий:
   ```bash
   git init && git add -A && git commit -m "init"
   git remote add origin https://github.com/<вы>/ovrly.git
   git push -u origin main
   ```
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → выберите репозиторий.
3. Railway сам определит Node и выполнит `npm install && npm build && npm start`. Порт подхватится из `process.env.PORT` автоматически.
4. В сервисе: **Settings → Networking → Generate Domain** — получите публичный URL вида `https://xxx.up.railway.app`.
5. Панель: `https://xxx.up.railway.app/panel`, оверлей: `https://xxx.up.railway.app/overlay`.
6. В OBS: источник **Browser Source** → URL оверлея, размер 1920×1080.

### Ограничения медиа «с ПК» (актуально для любого хостинга):

- Файлы с ПК превращаются в base64 data-URL и хранятся **в памяти сервера**: при рестарте
  или новом деплое все элементы сбрасываются.
- Лимит Socket.io — 50 МБ на сообщение; base64 раздувает файл в ~1.37 раза, поэтому видео
  с ПК больше **~36 МБ** не отправится. Надёжнее добавлять медиа по URL.
- Весь стейт передаётся каждому клиенту при подключении (`state:init`) — много тяжёлых
  файлов с ПК замедлит загрузку оверлея и съест RAM (на бесплатном Railway её 512 МБ).

### Данные (ссылки, инвайты, токены смайликов)

Всё это лежит в JSON-файлах в каталоге `data/`. На хостинге с эфемерной файловой системой
(Railway/Render без тома) они исчезают при каждом рестарте и деплое: модераторов придётся
приглашать заново, ссылки восстановятся только после нового входа через Twitch.

Чтобы этого не было — смонтируйте том и укажите каталог явно:

```
DATA_DIR=/data
```

Каталог используется и API-роутами, и сокет-сервером (файлы читаются/пишутся атомарно).

### Домен для SEO

В production задайте публичный адрес сайта — от него строятся canonical, `sitemap.xml`,
`robots.txt` и Open Graph:

```
NEXT_PUBLIC_SITE_URL=https://ваш-домен
```

Для Railway и Render есть автоматический fallback на их публичный домен. Без переменной
на других хостингах в индекс может попасть `http://localhost:3000`.

### Память
По умолчанию лимиты рассчитаны на хостинг ~2 ГБ:

- до 128 МБ состояния на одну комнату;
- до 768 МБ суммарно на все комнаты;
- до 200 комнат в памяти одновременно;
- комнаты без подключений выгружаются через 15 минут (состояние сохраняется на диск
  и поднимается при следующем входе).

Для хостинга на 512 МБ уменьшите `MAX_ROOM_BYTES` до 64 МБ, `MAX_TOTAL_ROOM_BYTES`
до 192 МБ и `MAX_ROOMS` до 100 в начале `server.js`.

### PostgreSQL
В `.env.local` задайте строку подключения:

```
DATABASE_URL=postgresql://ovrly:пароль@127.0.0.1:5433/ovrly
```

Схема и перенос данных:

```bash
# 1. Бэкап JSON
tar czf ~/ovrly-data-$(date +%F-%H%M).tar.gz -C ~/ovrly data

# 2. Драйвер (после git pull)
su - ovrly -c 'cd ~/ovrly && npm install'

# 3. Проверка без записи в базу
su - ovrly -c 'cd ~/ovrly && node --env-file=.env.local scripts/migrate-json-to-db.mjs --dry-run'

# 4. Создание таблиц и перенос
su - ovrly -c 'cd ~/ovrly && node --env-file=.env.local scripts/migrate-json-to-db.mjs'
```

Скрипт создаёт таблицы `links`, `invites`, `rooms`, `settings` из `db/schema.sql`
и заполняет их данными из `data/`. Повторный запуск безопасен — записи обновляются.
Приложение продолжает работать с JSON до переключения слоя хранения.

⚠️ После переключения ссылок и инвайтов на Postgres **не запускайте полную
миграцию повторно**: она перезапишет свежие ссылки/инвайты старыми JSON-данными.
Для синхронизации только комнат есть отдельный режим:

```bash
su - ovrly -c 'cd ~/ovrly && node --env-file=.env.local scripts/migrate-json-to-db.mjs --rooms-only'
```

#### Cutover комнат

1. Остановите приложение: `systemctl stop ovrly`.
2. Сделайте бэкап `data/` и `pg_dump`.
3. Проверьте: `--dry-run --rooms-only`.
4. Перенесите комнаты: `--rooms-only` (при больших комнатах добавьте
   `--max-old-space-size=1200`).
5. Запустите `systemctl start ovrly` и проверьте панели.
6. После проверки можно выставить `ROOMS_JSON_FALLBACK=0` и перезапустить:
   JSON больше не будет подстраховывать комнаты, источник — Postgres.

### Vercel — только если переделать архитектуру:

1. Вынести Socket.io-сервер на отдельный хостинг (Railway/Render) и прописать его URL в PanelClient/OverlayClient.
2. Либо переписать синхронизацию на REST API + базу (например, Upstash Redis / Supabase) с поллингом — тогда Vercel заработает, но это рефакторинг.

## Авторы

Ovrly создан и поддерживается **jettle\_** и **nezory_1**.

- jettle\_ — https://www.twitch.tv/jettle\_
- nezory_1 — https://www.twitch.tv/nezory_1
- Исходный код: https://github.com/qmaximp/ovrly
- Связь и поддержка: https://t.me/ovrly_control

## Лицензия

Проект распространяется по лицензии **GNU Affero General Public License v3.0**
(SPDX: `AGPL-3.0-only`). Полный текст — в файле [LICENSE](LICENSE), сведения об
авторах — в [NOTICE](NOTICE).

```
Ovrly — панель управления оверлеем OBS
Copyright (C) 2026 jettle_, nezory_1
```

Если вы запускаете изменённую версию Ovrly как публичный сетевой сервис, AGPL
требует предоставить пользователям этого сервиса исходный код соответствующей
версии. Ссылка на исходники: https://github.com/qmaximp/ovrly.

Twitch, YouTube, 7TV, BetterTTV и FrankerFaceZ, их API, смайлики и бренды не
входят в лицензию проекта; используйте их по их собственным правилам.
