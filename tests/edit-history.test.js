import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditHistory} from '../src/edit-history.js';
const doc=(x,sceneId='a')=>({sceneId,scenes:[{id:'a',doc:{x}},{id:'b',doc:{x:0}}]});
test('rapid discrete edits are separate steps, with redo and new-edit invalidation',()=>{
 const h=new EditHistory();h.reset(doc(0));h.record(doc(1),null,1);h.record(doc(2),null,2);
 assert.equal(h.undo.length,2);assert.deepEqual(h.destination(-1),doc(1));h.accept(-1,h.destination(-1));
 assert.deepEqual(h.destination(1),doc(2));h.accept(1,h.destination(1));assert.equal(h.cur.scenes[0].doc.x,2);
 h.accept(-1,h.destination(-1));h.record(doc(3));assert.equal(h.redo.length,0);
});
test('typing merges only within the same input; slow typing and different controls stay separate',()=>{
 const h=new EditHistory(),a={},b={};h.reset(doc(0));h.record(doc(1),a,1);h.record(doc(2),a,400);
 assert.equal(h.undo.length,1);h.record(doc(3),b,401);h.record(doc(4),b,1500);assert.equal(h.undo.length,3);
});
test('scene navigation is not an edit, snapshots are isolated and history stays bounded',()=>{
 const h=new EditHistory(2),a=doc(0);h.reset(a);a.scenes[0].doc.x=100;assert.equal(h.cur.scenes[0].doc.x,0);
 h.record(doc(0,'b'));assert.equal(h.undo.length,0);h.record(doc(1,'b'));assert.equal(h.destination(-1).sceneId,'b');
 h.record(doc(2));h.record(doc(3));assert.equal(h.undo.length,2);
 const target=h.destination(-1);target.scenes[0].doc.x=9;assert.equal(h.destination(-1).scenes[0].doc.x,2);
});
