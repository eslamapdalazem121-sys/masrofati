import admin from 'firebase-admin';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('FIREBASE_SERVICE_ACCOUNT secret is missing'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const db = admin.firestore();
const fcm = admin.messaging();

const NOW = Date.now();
const WINDOW = 3 * 24 * 3600 * 1000;   // إشعار فات عليه أكتر من ٣ أيام ما بيتبعتش
const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

const users = await db.collection('users').listDocuments();
let sentCount = 0;
for (const u of users) {
  const ref = u.collection('data').doc('push');
  const snap = await ref.get();
  if (!snap.exists) continue;
  const d = snap.data() || {};
  const tokens = Array.isArray(d.tokens) ? d.tokens.filter(Boolean) : [];
  const events = Array.isArray(d.events) ? d.events : [];
  const sent = Array.isArray(d.sent) ? d.sent : [];
  const due = events.filter(e => e && e.id && e.b && Number(e.t) <= NOW && Number(e.t) >= NOW - WINDOW && !sent.includes(e.id));
  if (!due.length || !tokens.length) continue;

  const newSent = sent.slice();
  const bad = new Set();
  for (const e of due) {
    let res;
    try {
      res = await fcm.sendEachForMulticast({
        tokens,
        data: { title: 'مصروفاتي B', body: String(e.b), tag: String(e.id), id: String(e.id) },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } },
      });
    } catch (err) { console.error('send failed', err.message); continue; }   // مش هنعلّمه اتبعت، هيتعاد في التشغيل الجاي
    let ok = 0, transient = 0;
    res.responses.forEach((r, i) => {
      if (r.success) ok++;
      else if (r.error && DEAD.has(r.error.code)) bad.add(tokens[i]);
      else transient++;
    });
    if (ok > 0 || transient === 0) { newSent.push(e.id); sentCount += ok > 0 ? 1 : 0; }
    console.log(`event ${e.id}: ok=${ok} transient=${transient}`);
  }
  const upd = { sent: newSent.slice(-300) };
  if (bad.size) upd.tokens = tokens.filter(t => !bad.has(t));
  await ref.update(upd);
}
console.log(`done — sent ${sentCount} notification(s)`);
