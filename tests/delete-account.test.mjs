import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteFinanceAccount, DELETE_CONFIRMATION } from '../server/delete-account.mjs';
import route from '../api/delete-account.mjs';

function fixture({ user = { id: 'user-a', email: 'a@example.test' }, passwordMatches = true,
  member = null, members = [], deleteError = null } = {}) {
  const deleted = [];
  const userClient = { auth: { getUser: async () => ({ data: { user }, error: null }) } };
  const verificationClient = { auth: { signInWithPassword: async () => ({
    data: { user: passwordMatches ? user : { id: 'other' } }, error: null,
  }) } };
  const adminClient = {
    from(table) {
      assert.equal(table, 'finance_space_members');
      return { select: () => ({ eq(column, value) {
        if (column === 'user_id') {
          assert.equal(value, user.id);
          return { maybeSingle: async () => ({ data: member, error: null }) };
        }
        assert.equal(column, 'space_id');
        assert.equal(value, member.space_id);
        return Promise.resolve({ data: members, error: null });
      } }) };
    },
    auth: { admin: { async deleteUser(id, soft) {
      deleted.push([id, soft]);
      return { error: deleteError };
    } } },
  };
  const run = (confirmation = DELETE_CONFIRMATION, password = 'correcta') =>
    deleteFinanceAccount({ userClient, verificationClient, adminClient, token: 'jwt', password, confirmation });
  return { run, deleted };
}

test('confirmation and password are required before any deletion', async () => {
  const { run, deleted } = fixture();
  assert.equal((await run('NO')).status, 400);
  assert.equal((await run(DELETE_CONFIRMATION, '')).status, 400);
  assert.deepEqual(deleted, []);
});

test('a wrong password cannot delete an account', async () => {
  const { run, deleted } = fixture({ passwordMatches: false });
  assert.equal((await run()).status, 401);
  assert.deepEqual(deleted, []);
});

test('a shared owner must transfer administration before deletion', async () => {
  const { run, deleted } = fixture({ member: { space_id: 'space-a', role: 'owner' },
    members: [{ user_id: 'user-a' }, { user_id: 'user-b' }] });
  assert.equal((await run()).status, 409);
  assert.deepEqual(deleted, []);
});

test('a member can delete only their own Auth user', async () => {
  const { run, deleted } = fixture({ member: { space_id: 'space-a', role: 'member' },
    members: [{ user_id: 'user-a' }, { user_id: 'user-b' }] });
  assert.equal((await run()).status, 200);
  assert.deepEqual(deleted, [['user-a', false]]);
});

test('a sole owner deletes their Auth user; the database trigger controls the space cascade', async () => {
  const { run, deleted } = fixture({ member: { space_id: 'space-a', role: 'owner' },
    members: [{ user_id: 'user-a' }] });
  assert.equal((await run()).status, 200);
  assert.deepEqual(deleted, [['user-a', false]]);
});

test('the public route refuses cross-origin and disabled deletion', async () => {
  const foreign = new Request('https://duo.example.test/api/delete-account', {
    method: 'POST', headers: { origin: 'https://elsewhere.example.test', 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal((await route.fetch(foreign)).status, 403);
  const local = new Request('https://duo.example.test/api/delete-account', {
    method: 'POST', headers: { origin: 'https://duo.example.test', 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal((await route.fetch(local)).status, 503);
});
