import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {FIELDS_ADDED_SINCE_PREVIOUS_RELEASE,preserveWireTypes,relaxAddedFields,verifySource} from '../../../scripts/schema-contract.mjs';

test('generation verifies exact source provenance bytes',()=>{
 const source=Buffer.from('{"openapi":"3.0.3"}');
 const manifest={sha256:createHash('sha256').update(source).digest('hex')};
 assert.doesNotThrow(()=>verifySource(source,manifest));
 assert.throws(()=>verifySource(Buffer.concat([source,Buffer.from('\n')]),manifest),/provenance mismatch/);
 // Other manifest fields (a note that the commit is unmerged) do not take part in verification.
 assert.doesNotThrow(()=>verifySource(source,{...manifest,commit:'x',note:'Pins an unmerged branch commit.'}));
});
test('wire overlay keeps signedness and existing stricter patterns',()=>{
 const signed={type:'string',format:'int64'};
 const unsigned={type:'string',format:'uint64'};
 const constrained={type:'string',format:'uint64',pattern:'^[1-9][0-9]{2}$'};
 preserveWireTypes({signed,unsigned,constrained});
 assert.match('-1',new RegExp(signed.pattern));
 assert.doesNotMatch('-1',new RegExp(unsigned.pattern));
 assert.match('0',new RegExp(unsigned.pattern));
 assert.equal(constrained.pattern,'^[1-9][0-9]{2}$');
 assert.equal('format' in signed,false);
});
test('fields added since the previous release are generated optional, and the list cannot go stale',()=>{
 const doc=()=>({components:{schemas:{A:{type:'object',required:['old','fresh'],properties:{old:{type:'string'},fresh:{type:'integer'}}},B:{type:'object',required:['only'],properties:{only:{type:'string'}}}}}});
 const relaxed=doc();relaxAddedFields(relaxed,['A.fresh','B.only']);
 assert.deepEqual(relaxed.components.schemas.A.required,['old']);assert.equal('required' in relaxed.components.schemas.B,false);
 assert.deepEqual(relaxed.components.schemas.A.properties,doc().components.schemas.A.properties,'the property itself is untouched');
 for(const stale of ['A.gone','Missing.fresh','A.fresh.deeper'])assert.throws(()=>relaxAddedFields(doc(),[stale]),/remove or correct the entry/);
 const twice=doc();relaxAddedFields(twice,['A.fresh']);assert.throws(()=>relaxAddedFields(twice,['A.fresh']),/not a required property/);
 // The real list names properties of the real snapshot (prepare-schema would have failed otherwise).
 const spec=JSON.parse(readFileSync(new URL('../../../schema/openapi.json',import.meta.url),'utf8'));
 assert.doesNotThrow(()=>relaxAddedFields(spec));assert(FIELDS_ADDED_SINCE_PREVIOUS_RELEASE.length<=12,'keep the list short: remove fields every supported server sends');
});
