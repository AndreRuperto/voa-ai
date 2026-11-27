import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostDePushValido, lerPushSubscription } from '../server/push.js';

// Endpoint de push de outro host faria o servidor mandar POST para qualquer lugar (docs/revisao: Web Push).
test('só aceita os serviços de push dos navegadores', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QW',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
  ]) assert.equal(hostDePushValido(ok), true, ok);
  for (const ruim of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://exemplo.com/push',
    'https://fcm.googleapis.com.ataque.com/x',
    'https://user:senha@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://169.254.169.254/latest',
    'não é url',
  ]) assert.equal(hostDePushValido(ruim), false, ruim);
  assert.equal(lerPushSubscription({ endpoint: 'https://exemplo.com/push', keys: { p256dh: 'p', auth: 'a' } }), null);
});
