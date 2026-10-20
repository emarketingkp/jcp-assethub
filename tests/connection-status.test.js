const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../public/connection-status.js');
test('a successful API request cannot hide an AI failure or claim every service is healthy',()=>{
 const health=create();health.update('api',{state:'ok'});assert.equal(health.summary().text,'API online');
 health.update('ai',{state:'error',message:'Rate limited',evidence:'scan',checked_at:new Date().toISOString()});health.update('api',{state:'ok'});assert.equal(health.summary().status,'issues');
 health.update('ai',{state:'not_tested',evidence:'configuration',configured:true});assert.equal(health.snapshot().components.ai.state,'error');
 health.update('ai',{state:'disabled',evidence:'configuration',configured:false});assert.equal(health.snapshot().components.ai.state,'disabled');
});
test('old verified results become stale and can be replaced by configuration-only results',()=>{
 let now=0;const health=create({now:()=>now});health.update('api',{state:'ok',checked_at:new Date(0).toISOString()});health.update('ai',{state:'ok',evidence:'scan',checked_at:new Date(0).toISOString()});now=300001;
 assert(health.snapshot().components.ai.stale);assert.equal(health.summary().status,'warning');health.update('ai',{state:'not_tested',evidence:'configuration'});assert.equal(health.snapshot().components.ai.state,'not_tested');
});
test('late checks cannot overwrite a newer check or a cancelled panel',async()=>{
 const health=create();let release;const first=health.run('ai',()=>new Promise(resolve=>{release=resolve;}));await Promise.resolve();
 await health.run('ai',async()=>({state:'error',message:'new failure'}));release({state:'ok'});await first;assert.equal(health.snapshot().components.ai.message,'new failure');
 let finish;const second=health.run('drive',()=>new Promise(resolve=>{finish=resolve;}));await Promise.resolve();health.cancel();finish({state:'ok'});await second;assert.equal(health.snapshot().components.drive.state,'not_tested');
});
test('one stalled check has a deadline while other checks finish independently',async()=>{
 const health=create();const stalled=health.run('drive',()=>new Promise(()=>{}),{timeoutMs:10});await health.run('sheets',async()=>({state:'ok'}));assert.equal(health.snapshot().components.sheets.state,'ok');await stalled;assert.equal(health.snapshot().components.drive.state,'error');
});
test('a real scan failure wins over a diagnostic test that started earlier',async()=>{
 const health=create();let release;const probe=health.run('ai',()=>new Promise(resolve=>{release=resolve;}));await Promise.resolve();
 health.record('ai',{state:'error',message:'latest scan failed',evidence:'scan'});release({state:'ok'});await probe;assert.equal(health.snapshot().components.ai.message,'latest scan failed');
});
