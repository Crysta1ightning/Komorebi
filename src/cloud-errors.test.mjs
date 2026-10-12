import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudErrorMessage } from './cloud-errors.mjs';

test('sync errors distinguish incomplete SQL, permissions and authentication', () => {
  assert.match(cloudErrorMessage({ code: 'PGRST202' }), /同步函式/);
  assert.match(cloudErrorMessage({ code: 'PGRST205' }), /資料表/);
  assert.match(cloudErrorMessage({ code: '42501' }), /權限/);
  assert.match(cloudErrorMessage({ code: 'email_not_confirmed' }), /尚未確認/);
  assert.match(cloudErrorMessage({ code: 'invalid_credentials' }), /Dashboard/);
});

test('untrusted provider messages and credentials are not displayed', () => {
  const message = cloudErrorMessage({ code: 'NETWORK_ERROR', message: 'token=private-user-secret' });
  assert.match(message, /NETWORK_ERROR/);
  assert.ok(!message.includes('private-user-secret'));
  assert.ok(!cloudErrorMessage({ code: '<script>bad</script>' }).includes('<script>'));
});
