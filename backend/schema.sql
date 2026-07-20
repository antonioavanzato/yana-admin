-- Схема YDB для записи YanaPro.
-- Выполнить в консоли Yandex Cloud: YDB -> база -> Навигация -> Запрос (режим YQL).

CREATE TABLE bookings (
    slot_id    Utf8,   -- "YYYY-MM-DD_HH:MM" — первичный ключ = атомарная защита слота
    name       Utf8,
    phone      Utf8,
    comment    Utf8,
    date       Utf8,   -- "YYYY-MM-DD"
    time       Utf8,   -- "HH:MM"
    status     Utf8,   -- new | confirmed | done | cancelled
    created_at Utf8,   -- ISO 8601
    PRIMARY KEY (slot_id)
);

CREATE TABLE schedule (
    id   Utf8,  -- всегда 'weekly'
    data Utf8,  -- JSON: { "0": [], "1": ["09:00", ...], ... }
    PRIMARY KEY (id)
);

CREATE TABLE push_subscriptions (
    endpoint Utf8,
    data     Utf8,  -- JSON-подписка PushSubscription целиком
    PRIMARY KEY (endpoint)
);
