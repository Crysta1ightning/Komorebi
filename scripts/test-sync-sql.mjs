import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    insert into auth.users values ('${a}'), ('${b}');`);
  const sql = await readFile('supabase/study-sync.sql', 'utf8');
  await db.exec(sql); await db.exec(sql); // Setup can be safely run again.
  const asUser = async user => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  };
  const exchange = async (revision, document) => (await db.query('select public.sync_study_library($1, $2::jsonb) as result', [revision, JSON.stringify(document)])).rows[0].result;
  await asUser(a);
  const first = await exchange(0, { version: 1, cards: [] });
  assert.equal(first.applied, true); assert.equal(first.revision, 1);
  const conflict = await exchange(0, { version: 1, cards: [{ word: 'not applied' }] });
  assert.equal(conflict.applied, false); assert.equal(conflict.revision, 1);
  assert.deepEqual(conflict.document.cards, []);
  await assert.rejects(db.exec('update public.study_libraries set revision = 99'), /permission denied/);
  await assert.rejects(db.query('insert into public.study_libraries(user_id) values ($1)', [b]), /permission denied/);
  await assert.rejects(db.exec('delete from public.study_libraries'), /permission denied/);
  await assert.rejects(exchange(1, { version: 1, cards: null }), /Invalid study document/);
  await asUser(b);
  assert.deepEqual((await db.query('select * from public.study_libraries')).rows, [], 'RLS hides the other account');
  const second = await exchange(0, { version: 1, cards: [] });
  assert.equal(second.applied, true); assert.equal(second.revision, 1);
  assert.equal((await db.query('select * from public.study_libraries')).rows[0].user_id, b);
  await db.exec('reset role');
  const accountA = (await db.query('select revision, document from public.study_libraries where user_id = $1', [a])).rows[0];
  assert.equal(accountA.revision, 1, 'Account B RPC cannot update account A');
  assert.deepEqual(accountA.document, { version: 1, cards: [] });
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from public.study_libraries'), /permission denied/);
  await assert.rejects(exchange(0, { version: 1, cards: [] }), /permission denied/);
  await db.exec("reset role; set role authenticated; select set_config('request.jwt.claim.sub', '', false)");
  await assert.rejects(exchange(0, { version: 1, cards: [] }), /Authentication required/);
  console.log('PostgreSQL sync SQL passed: RLS isolation, authentication, restricted writes, idempotent setup and atomic revision conflicts.');
} finally { await db.close(); }
