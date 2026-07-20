# Бэкенд записи YanaPro (Yandex Cloud Function + YDB)

Единая Cloud Function обслуживает и форму записи (booking.yanapro.ru), и админку.
Данные хранятся в Serverless YDB в России (152-ФЗ).

## Деплой с нуля (когда создан аккаунт Yandex Cloud)

### 1. База данных YDB
1. Консоль Yandex Cloud → **Managed Service for YDB** → «Создать базу данных».
2. Тип: **Serverless** (бесплатный уровень покрывает такие объёмы с запасом).
3. Открыть базу → вкладка **Запрос** → выполнить `schema.sql` из этой папки.
4. Записать `Эндпоинт` (grpcs://ydb.serverless.yandexcloud.net:2135) и `Размещение базы данных` (`/ru-central1/.../...`).

### 2. Сервисный аккаунт
1. Каталог → **Сервисные аккаунты** → создать, например `booking-fn`.
2. Роли: `ydb.editor`.

### 3. Секреты (сгенерировать локально)
```bash
# JWT_SECRET и FORM_API_KEY — любые случайные строки:
openssl rand -hex 32
# SHA-256 хэш пароля админки:
echo -n 'ПАРОЛЬ_ЯНЫ' | shasum -a 256
# VAPID-ключи для push-уведомлений:
npx web-push generate-vapid-keys
```

### 4. Cloud Function
1. Консоль → **Cloud Functions** → «Создать функцию», среда **Node.js 18+**.
2. Загрузить `index.js` и `package.json` из этой папки (редактор кода или ZIP).
3. Точка входа: `index.handler`. Таймаут: 10 c. Память: 128 МБ.
4. Сервисный аккаунт: `booking-fn`.
5. Переменные окружения:

| Переменная | Значение |
|---|---|
| `YDB_ENDPOINT` | `grpcs://ydb.serverless.yandexcloud.net:2135` |
| `YDB_DATABASE` | размещение базы (`/ru-central1/...`) |
| `JWT_SECRET` | случайная строка |
| `ADMIN_EMAIL` | email для входа в админку |
| `ADMIN_PASS_SHA256` | sha256-хэш пароля |
| `FORM_API_KEY` | случайная строка (та же — в форме) |
| `VAPID_PUBLIC` | публичный VAPID-ключ |
| `VAPID_PRIVATE` | приватный VAPID-ключ |

6. Сделать функцию **публичной** (флаг «Публичная функция»).
7. Скопировать URL вида `https://functions.yandexcloud.net/<id>`.

### 5. Прописать URL во фронтендах
- **Админка** (`yana-admin/index.html`): константа `API_URL` + `VAPID_KEY` (= `VAPID_PUBLIC`).
- **Форма** (`booking.yanapro.ru/index.html`): константы `API_URL` и `API_KEY` (= `FORM_API_KEY`).

### 6. Перенос данных из Firebase
Экспортировать коллекцию заявок из Firestore и загрузить в YDB
(скрипт миграции — по запросу; формат строк см. `schema.sql`).

## Контракт API
См. комментарий в шапке `index.js`.
