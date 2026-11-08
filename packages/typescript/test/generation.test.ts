import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {preserveWireTypes,verifySource} from '../../../scripts/schema-contract.mjs';

test('generation verifies exact source provenance bytes',()=>{
 const source=Buffer.from('{"openapi":"3.0.3"}');
 const manifest={sha256:createHash('sha256').update(source).digest('hex')};
 assert.doesNotThrow(()=>verifySource(source,manifest));
 assert.throws(()=>verifySource(Buffer.concat([source,Buffer.from('\n')]),manifest),/provenance mismatch/);
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
