import test from 'node:test';
import assert from 'node:assert/strict';
import {listFinanceSpaceMembers,removeFinanceSpaceMember} from '../src/finance-remote.ts';

test('member list uses the authenticated space RPC and maps only its returned members',async()=>{
  const calls=[];
  const client={rpc:async(name,args)=>{
    calls.push([name,args]);
    return {data:[{user_id:'dorian',display_name:'Dorian',role:'owner'},
      {user_id:'dani',display_name:'Dani',role:'member'}],error:null};
  }};
  assert.deepEqual(await listFinanceSpaceMembers(client,'shared'),[
    {userId:'dorian',displayName:'Dorian',role:'owner'},
    {userId:'dani',displayName:'Dani',role:'member'},
  ]);
  assert.deepEqual(calls,[['list_finance_space_members',{p_space_id:'shared'}]]);
});

test('removing a member calls the protected RPC without deleting an Auth user or financial row',async()=>{
  const calls=[];
  const client={rpc:async(name,args)=>{calls.push([name,args]);return {error:null}}};
  await removeFinanceSpaceMember(client,'shared','dani');
  assert.deepEqual(calls,[['remove_finance_space_member',
    {p_space_id:'shared',p_user_id:'dani'}]]);
});

test('member removal errors from the database are shown rather than treated as success',async()=>{
  const client={rpc:async()=>({error:{message:'Solo el propietario puede quitar a otro integrante'}})};
  await assert.rejects(removeFinanceSpaceMember(client,'shared','dani'),/Solo el propietario/);
});
