/* Cloud Function: шлёт push-уведомление администратору при создании новой заявки.
   Деплой:
     cd functions && npm install
     firebase deploy --only functions
   FCM бесплатен; Cloud Functions используют свободную квоту Firebase. */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.notifyNewBooking = functions.firestore
  .document('bookings/{id}')
  .onCreate(async (snap) => {
    const b = snap.data() || {};
    const when = `${(b.date || '').toString().substring(0, 10)}${b.time ? ' ' + b.time : ''}`;

    // собираем все сохранённые токены админских устройств
    const tokensSnap = await admin.firestore().collection('adminTokens').get();
    const tokens = tokensSnap.docs.map(d => d.id).filter(Boolean);
    if (!tokens.length) return null;

    const message = {
      notification: {
        title: 'Новая заявка 📅',
        body: `${b.name || 'Клиент'} · ${when}`
      },
      data: { url: '/admin.html' },
      tokens
    };

    const res = await admin.messaging().sendEachForMulticast(message);

    // чистим протухшие токены
    const dead = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token') dead.push(tokens[i]);
      }
    });
    await Promise.all(dead.map(t => admin.firestore().collection('adminTokens').doc(t).delete()));
    return null;
  });

