/* Yandex Cloud Function: единый бэкенд записи YanaPro.
   Обслуживает и публичную форму (booking.yanapro.ru), и админку (admin).
   Данные — в Serverless YDB (РФ, 152-ФЗ).

   Публичные действия (без токена):
     GET  ?action=slots  -> { busy:[{date,time}], schedule }
     GET  ?action=ics&date&time -> файл .ics
     POST (без action) { name, phone, comment, date, time, key } -> создать заявку
          409 если слот занят (атомарно, PK = slot_id "YYYY-MM-DD_HH:MM")

   Действия админки (заголовок X-Yana-Token с JWT):
     POST ?action=login        { email, password } -> { token }
     POST ?action=bookings     -> { bookings:[...] }
     POST ?action=schedule_get -> { schedule }
     POST ?action=schedule_set { schedule } -> { ok }
     POST ?action=status       { slot_id, status } -> { ok }
     POST ?action=delete       { slot_id } -> { ok }
     POST ?action=subscribe    { subscription } -> { ok }

   Переменные окружения функции:
     YDB_ENDPOINT   grpcs://ydb.serverless.yandexcloud.net:2135
     YDB_DATABASE   /ru-central1/<...>/<...>
     JWT_SECRET     длинная случайная строка
     ADMIN_EMAIL    email для входа в админку
     ADMIN_PASS_SHA256  sha256-hex от пароля админки
     FORM_API_KEY   ключ, зашитый в форму (простая защита от спама)
     VAPID_PUBLIC / VAPID_PRIVATE  ключи Web Push (npx web-push generate-vapid-keys)
   Функции нужен сервисный аккаунт с ролью ydb.editor. */
'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const { Driver, MetadataAuthService, TypedValues } = require('ydb-sdk');

const {
  YDB_ENDPOINT = 'grpcs://ydb.serverless.yandexcloud.net:2135',
  YDB_DATABASE,
  JWT_SECRET,
  ADMIN_EMAIL,
  ADMIN_PASS_SHA256,
  FORM_API_KEY,
  VAPID_PUBLIC,
  VAPID_PRIVATE,
} = process.env;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:admin@yanapro.ru', VAPID_PUBLIC, VAPID_PRIVATE);
}

let driver = null;
async function getDriver() {
  if (!driver) {
    driver = new Driver({
      endpoint: YDB_ENDPOINT,
      database: YDB_DATABASE,
      authService: new MetadataAuthService(),
    });
    if (!(await driver.ready(8000))) throw new Error('YDB driver not ready');
  }
  return driver;
}

async function query(text, params = {}) {
  const d = await getDriver();
  return d.tableClient.withSession(async (session) => {
    const prepared = await session.prepareQuery(text);
    return session.executeQuery(prepared, params);
  });
}

function rows(result, idx = 0) {
  const rs = result.resultSets[idx];
  if (!rs) return [];
  const cols = rs.columns.map((c) => c.name);
  return rs.rows.map((r) => {
    const o = {};
    r.items.forEach((item, i) => {
      o[cols[i]] = item.textValue !== undefined && item.textValue !== null
        ? item.textValue
        : (item.uint64Value ?? item.int64Value ?? null);
    });
    return o;
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Yana-Token',
};
const resp = (code, body, extra = {}) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  body: JSON.stringify(body),
});

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function checkToken(event) {
  const h = event.headers || {};
  const token = h['X-Yana-Token'] || h['x-yana-token'] || '';
  try { jwt.verify(token, JWT_SECRET); return true; } catch (e) { return false; }
}

async function getSchedule() {
  const r = await query(
    'DECLARE $id AS Utf8; SELECT data FROM schedule WHERE id = $id;',
    { $id: TypedValues.utf8('weekly') },
  );
  const list = rows(r);
  return list.length ? JSON.parse(list[0].data) : null;
}

async function notifyAdmins(booking) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  try {
    const r = await query('SELECT endpoint, data FROM push_subscriptions;');
    const subs = rows(r);
    await Promise.allSettled(subs.map(async (s) => {
      try {
        await webpush.sendNotification(JSON.parse(s.data), JSON.stringify({
          title: 'Новая запись 📅',
          body: `${booking.name || 'Клиент'} · ${booking.date} ${booking.time}`,
        }));
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await query(
            'DECLARE $ep AS Utf8; DELETE FROM push_subscriptions WHERE endpoint = $ep;',
            { $ep: TypedValues.utf8(s.endpoint) },
          );
        }
      }
    }));
  } catch (e) { console.warn('push error', e); }
}

function icsResponse(date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (Y, M, D, H, Mi) => `${Y}${pad(M)}${pad(D)}T${pad(H)}${pad(Mi)}00`;
  const endH = h + 1;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//YanaPro//Booking//RU',
    'BEGIN:VEVENT',
    `UID:${date}_${time}@yanapro.ru`,
    `DTSTART;TZID=Europe/Moscow:${fmt(y, mo, d, h, mi)}`,
    `DTEND;TZID=Europe/Moscow:${fmt(y, mo, d, endH, mi)}`,
    'SUMMARY:Тренировка с Яной Самойловой',
    'DESCRIPTION:Онлайн-запись yanapro.ru',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="trenirovka.ics"',
      ...CORS,
    },
    body: ics,
  };
}

module.exports.handler = async function (event) {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const q = event.queryStringParameters || {};
  const action = q.action || '';
  let body = {};
  if (event.body) {
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
      body = JSON.parse(raw);
    } catch (e) { /* пустое или не-JSON тело */ }
  }

  try {
    /* ── публичные ── */
    if (action === 'slots') {
      const r = await query("SELECT date, time FROM bookings WHERE status != 'cancelled';");
      const schedule = await getSchedule();
      return resp(200, { busy: rows(r), schedule });
    }

    if (action === 'ics') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date || '') || !/^\d{2}:\d{2}$/.test(q.time || '')) {
        return resp(400, { error: 'bad_params' });
      }
      return icsResponse(q.date, q.time);
    }

    if (action === 'login') {
      const { email, password } = body;
      if (
        email && password &&
        email.trim().toLowerCase() === String(ADMIN_EMAIL).toLowerCase() &&
        sha256(password) === ADMIN_PASS_SHA256
      ) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '30d' });
        return resp(200, { token });
      }
      return resp(401, { error: 'bad_credentials' });
    }

    if (!action && method === 'POST') {
      /* создание заявки с формы */
      if (FORM_API_KEY && body.key !== FORM_API_KEY) return resp(403, { error: 'forbidden' });
      const { name, phone, comment, date, time } = body;
      if (!name || !phone || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) {
        return resp(400, { error: 'bad_params' });
      }
      const slotId = `${date}_${time}`;
      try {
        /* INSERT падает на дубликате PK -> атомарная защита от двойной брони */
        await query(
          `DECLARE $slot_id AS Utf8; DECLARE $name AS Utf8; DECLARE $phone AS Utf8;
           DECLARE $comment AS Utf8; DECLARE $date AS Utf8; DECLARE $time AS Utf8;
           DECLARE $created AS Utf8;
           INSERT INTO bookings (slot_id, name, phone, comment, date, time, status, created_at)
           VALUES ($slot_id, $name, $phone, $comment, $date, $time, 'new', $created);`,
          {
            $slot_id: TypedValues.utf8(slotId),
            $name: TypedValues.utf8(String(name).slice(0, 200)),
            $phone: TypedValues.utf8(String(phone).slice(0, 100)),
            $comment: TypedValues.utf8(String(comment || '').slice(0, 1000)),
            $date: TypedValues.utf8(date),
            $time: TypedValues.utf8(time),
            $created: TypedValues.utf8(new Date().toISOString()),
          },
        );
      } catch (e) {
        if (String(e).includes('PRECONDITION') || String(e).includes('Duplicate') || String(e).includes('Conflict')) {
          return resp(409, { error: 'SLOT_TAKEN' });
        }
        throw e;
      }
      await notifyAdmins({ name, date, time });
      return resp(200, { ok: true, slot_id: slotId });
    }

    /* ── админка (JWT) ── */
    if (!checkToken(event)) return resp(401, { error: 'unauthorized' });

    if (action === 'bookings') {
      const r = await query('SELECT slot_id, name, phone, comment, date, time, status, created_at FROM bookings;');
      return resp(200, { bookings: rows(r) });
    }

    if (action === 'schedule_get') {
      return resp(200, { schedule: await getSchedule() });
    }

    if (action === 'schedule_set') {
      if (!body.schedule || typeof body.schedule !== 'object') return resp(400, { error: 'bad_params' });
      await query(
        `DECLARE $id AS Utf8; DECLARE $data AS Utf8;
         UPSERT INTO schedule (id, data) VALUES ($id, $data);`,
        { $id: TypedValues.utf8('weekly'), $data: TypedValues.utf8(JSON.stringify(body.schedule)) },
      );
      return resp(200, { ok: true });
    }

    if (action === 'status') {
      const { slot_id, status } = body;
      if (!slot_id || !['new', 'confirmed', 'done', 'cancelled'].includes(status)) {
        return resp(400, { error: 'bad_params' });
      }
      await query(
        'DECLARE $slot_id AS Utf8; DECLARE $status AS Utf8; UPDATE bookings SET status = $status WHERE slot_id = $slot_id;',
        { $slot_id: TypedValues.utf8(slot_id), $status: TypedValues.utf8(status) },
      );
      return resp(200, { ok: true });
    }

    if (action === 'delete') {
      if (!body.slot_id) return resp(400, { error: 'bad_params' });
      await query(
        'DECLARE $slot_id AS Utf8; DELETE FROM bookings WHERE slot_id = $slot_id;',
        { $slot_id: TypedValues.utf8(body.slot_id) },
      );
      return resp(200, { ok: true });
    }

    if (action === 'subscribe') {
      const sub = body.subscription;
      if (!sub || !sub.endpoint) return resp(400, { error: 'bad_params' });
      await query(
        `DECLARE $ep AS Utf8; DECLARE $data AS Utf8;
         UPSERT INTO push_subscriptions (endpoint, data) VALUES ($ep, $data);`,
        { $ep: TypedValues.utf8(sub.endpoint), $data: TypedValues.utf8(JSON.stringify(sub)) },
      );
      return resp(200, { ok: true });
    }

    return resp(404, { error: 'unknown_action' });
  } catch (e) {
    console.error('handler error', e);
    return resp(500, { error: 'internal' });
  }
};
