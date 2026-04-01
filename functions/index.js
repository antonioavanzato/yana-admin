const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { google } = require('googleapis');

admin.initializeApp();

// === НАСТРОЙКИ КАЛЕНДАРЯ ===
const calendarId = 'yana.trener.uno@gmail.com';   // замените на ваш
const timeZone = 'Europe/Moscow';                 // замените при необходимости

// Сервисный аккаунт берём из переменной окружения
const serviceAccount = functions.config().google.service_account;
if (!serviceAccount) {
  console.error('Ошибка: не найден service account.');
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(serviceAccount),
  scopes: ['https://www.googleapis.com/auth/calendar']
});

const calendar = google.calendar({ version: 'v3', auth });

exports.onBookingCreated = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const { firstName, lastName, phone, date, time } = data;

    const startDateTime = new Date(`${date}T${time}:00`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000);

    const event = {
      summary: `Тренировка с ${firstName} ${lastName}`,
      description: `Телефон: ${phone}\nЗапись с сайта`,
      start: { dateTime: startDateTime.toISOString(), timeZone },
      end: { dateTime: endDateTime.toISOString(), timeZone },
    };

    try {
      const response = await calendar.events.insert({ calendarId, resource: event });
      console.log(`✅ Событие создано: ${response.data.htmlLink}`);
    } catch (error) {
      console.error('❌ Ошибка добавления в календарь:', error);
    }
    return null;
  });
