import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),tokens=new Map();
const auth={verifyIdToken:async token=>{if(!tokens.has(token))throw Error('bad token');return tokens.get(token);},getUser:async uid=>({uid,metadata:{creationTime:new Date(Date.now()-1000).toISOString()}})};
mock.module('../server/firebase-admin.js',{namedExports:{services:()=>({db,auth})}});
const {default:handler}=await import('../api/affiliates.js');
const admin='affiliate_admin_123456';db.data.set(`securitySessions/${admin}`,{sid:'affiliate-session',expiresAt:Date.now()+120000,revoked:false});db.data.set(`securityAdmins/${admin}`,{enabled:true});
tokens.set('admin-token',{uid:admin,sid:'affiliate-session',email:'admin@example.com',email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'custom'}});
const user='affiliate_user_123456',partnerUser='affiliate_owner_123456';
for (const [uid,sid,email,token] of [[user,'affiliate-user-session','referred@example.com','user-token'],[partnerUser,'affiliate-owner-session','asha@example.com','partner-token']]) {db.data.set(`securitySessions/${uid}`,{sid,expiresAt:Date.now()+120000,revoked:false});tokens.set(token,{uid,sid,email,email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'custom'}});}
async function call(body,token,ip='203.0.113.9'){const res=response();await handler({method:'POST',headers:{...(token?{authorization:'Bearer '+token}:{}),'x-forwarded-for':ip,origin:'https://site.example'},body},res);return res;}
const form={action:'submit',name:'Asha Creator',email:'asha@example.com',phone:'+91 98765 43210',company:'Asha Studio',platform:'YouTube',audience:'25,001-50,000',profile:'https://youtube.com/@asha',message:'Interested in referrals',consent:true};
test('affiliate application collects consented contact data and is admin-only in dashboard',async()=>{
 const submitted=await call(form);assert.equal(submitted.statusCode,201);
 const id=submitted.body.id,record=db.data.get(`affiliatePartners/${id}`);
 assert.equal(record.name,form.name);assert.equal(record.email,form.email);assert.equal(record.phone,form.phone);assert.equal(record.status,'new');assert.equal(record.consentAt>0,true);
 assert.equal((await call({action:'adminList'})).statusCode,401);
 assert.equal((await call({action:'adminList'},'user-token')).statusCode,403);
 const listing=await call({action:'adminList'},'admin-token');assert.equal(listing.statusCode,200);assert.equal(listing.body.affiliates[0].id,id);
 const approved=await call({action:'adminStatus',id,status:'approved'},'admin-token');assert.equal(approved.statusCode,200);
 assert.equal(db.data.get(`affiliatePartners/${id}`).status,'approved');
 const code=approved.body.referralCode;assert.match(code,/^[A-Z0-9]{10}$/);
 assert.equal((await call({action:'click',code},null)).body.tracked,true);
 await call({action:'click',code},null);
 assert.equal(db.data.get(`affiliatePartners/${id}/tracking/summary`).clicks,1);
 assert.equal((await call({action:'attribute',code},'user-token')).body.attributed,true);
 assert.equal((await call({action:'attribute',code},'user-token')).body.reason,'already_attributed');
 const dashboard=await call({action:'dashboard'},'partner-token');assert.equal(dashboard.statusCode,200);assert.equal(dashboard.body.partner.referralCode,code);assert.equal(dashboard.body.clicks,1);assert.equal(dashboard.body.referrals,1);
 const commissionPath=`affiliatePartners/${id}/commissions/order_afftest123`;db.data.set(commissionPath,{orderId:'order_afftest123',planName:'Starter',amountPaise:45000,commissionPercent:10,commissionPaise:4500,payoutStatus:'pending',createdAt:Date.now()});
 const report=await call({action:'adminList'},'admin-token');assert.equal(report.body.affiliates[0].stats.pendingPaise,4500);
 assert.equal((await call({action:'adminPayout',id,commissionId:'order_afftest123',status:'paid',payoutReference:'bank-ref-123'},'admin-token')).statusCode,200);
 assert.equal(db.data.get(commissionPath).payoutStatus,'paid');assert.equal(db.data.get(commissionPath).payoutReference,'bank-ref-123');
 assert.equal((await call({action:'adminPayout',id,commissionId:'order_afftest123',status:'paid',payoutReference:'second-ref'},'admin-token')).statusCode,409);
 const updatedDashboard=await call({action:'dashboard'},'partner-token');assert.equal(updatedDashboard.body.paidPaise,4500);assert.equal(updatedDashboard.body.pendingPaise,0);
 assert.equal((await call({action:'adminSettings',save:true,commissionPercent:25},'admin-token')).body.commissionPercent,25);
 assert.equal((await call({...form,email:'bad',consent:false})).statusCode,400);
 const spam=await call({...form,website:'spam bot'});assert.equal(spam.statusCode,200);assert.equal(spam.body.submitted,true);
 assert.equal((await call({...form,email:'asha+2@example.com'},null,'203.0.113.10')).statusCode,201);
 assert.equal((await call({...form,email:'asha+3@example.com'},null,'203.0.113.10')).statusCode,201);
 assert.equal((await call({...form,email:'asha+4@example.com'},null,'203.0.113.10')).statusCode,201);
 assert.equal((await call({...form,email:'asha+5@example.com'},null,'203.0.113.10')).statusCode,429);
});
test('a partner can withdraw only what they have earned, and the admin approves or rejects the request',async()=>{
 const uid='wallet_partner_123456',pid='11111111-2222-3333-4444-555555555555';
 db.data.set(`securitySessions/${uid}`,{sid:'wallet-session',expiresAt:Date.now()+120000,revoked:false});
 tokens.set('wallet-token',{uid,sid:'wallet-session',email:'wallet@example.com',email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'custom'}});
 db.data.set(`affiliatePartners/${pid}`,{id:pid,name:'Wallet Partner',email:'wallet@example.com',status:'approved',referralCode:'WALLET1234',createdAt:Date.now()});
 const earn=(order,commissionPaise,payoutStatus='pending')=>db.data.set(`affiliatePartners/${pid}/commissions/${order}`,{orderId:order,planName:'Pack',amountPaise:commissionPaise*10,commissionPercent:10,commissionPaise,payoutStatus,createdAt:Date.now()});
 earn('order_wallet1',10000);earn('order_wallet2',5000);earn('order_walletold',2000,'paid');            // ₹150 still owed, ₹20 already paid by hand
 const upi={method:'upi',upiId:'partner@okbank'};
 const ask=(amountPaise,payout=upi)=>call({action:'withdraw',amountPaise,payout},'wallet-token');
 let dash=await call({action:'dashboard'},'wallet-token');
 assert.equal(dash.body.wallet.availablePaise,15000);assert.equal(dash.body.wallet.earnedPaise,17000);
 // validation: nothing, more than earned, bad payout details, and someone who is not a partner
 assert.equal((await ask(0)).statusCode,400);
 const tooMuch=await ask(15001);assert.equal(tooMuch.statusCode,400);assert.equal(tooMuch.body.code,'amount_exceeds_balance');assert.match(tooMuch.body.error,/up to ₹150\.00/);
 assert.equal((await ask(1000.5)).statusCode,400);
 assert.equal((await ask(5000,{method:'upi',upiId:'not a upi'})).body.code,'invalid_upi');
 assert.equal((await ask(5000,{method:'bank',accountName:'A B',accountNumber:'123',ifsc:'HDFC0001234'})).body.code,'invalid_account_number');
 assert.equal((await ask(5000,{method:'bank',accountName:'A B',accountNumber:'123456789012',ifsc:'BAD'})).body.code,'invalid_ifsc');
 assert.equal((await call({action:'withdraw',amountPaise:5000,payout:upi},'user-token')).statusCode,403);          // not a partner
 assert.equal(db.data.get(`affiliatePartners/${pid}/tracking/wallet`),undefined);
 // a valid request holds the money back at once and only one can wait at a time
 const first=await ask(6000);assert.equal(first.statusCode,201);
 dash=await call({action:'dashboard'},'wallet-token');
 assert.equal(dash.body.wallet.reservedPaise,6000);assert.equal(dash.body.wallet.availablePaise,9000);assert.equal(dash.body.withdrawals[0].status,'pending');
 assert.equal((await ask(100)).body.code,'withdrawal_pending');
 assert.equal(JSON.stringify(dash.body).includes('123456789012'),false);
 // admin only; reject frees the money again
 assert.equal((await call({action:'adminWithdrawal',id:pid,withdrawalId:first.body.id,decision:'rejected'},'wallet-token')).statusCode,403);
 assert.equal((await call({action:'adminWithdrawal',id:pid,withdrawalId:first.body.id,decision:'rejected',note:'Details did not match'},'admin-token')).statusCode,200);
 dash=await call({action:'dashboard'},'wallet-token');
 assert.equal(dash.body.wallet.availablePaise,15000);assert.equal(dash.body.withdrawals[0].status,'rejected');assert.equal(dash.body.withdrawals[0].reason,'Details did not match');
 assert.equal((await call({action:'adminWithdrawal',id:pid,withdrawalId:first.body.id,decision:'approved'},'admin-token')).statusCode,409);
 // approve takes the amount out of the partner's balance for good
 const bank={method:'bank',accountName:'Wallet Partner',accountNumber:'123456789012',ifsc:'hdfc0001234'};
 const second=await ask(15000,bank);assert.equal(second.statusCode,201);
 assert.equal(db.data.get(`affiliatePartners/${pid}/withdrawals/${second.body.id}`).payout.ifsc,'HDFC0001234');
 const listing=await call({action:'adminList'},'admin-token'),row=listing.body.affiliates.find(a=>a.id===pid);
 assert.equal(row.withdrawals.find(w=>w.id===second.body.id).payout.accountNumber,'123456789012');assert.equal(row.wallet.reservedPaise,15000);
 assert.equal((await call({action:'adminWithdrawal',id:pid,withdrawalId:second.body.id,decision:'approved',payoutReference:'UTR123'},'admin-token')).statusCode,200);
 dash=await call({action:'dashboard'},'wallet-token');
 assert.equal(dash.body.wallet.withdrawnPaise,15000);assert.equal(dash.body.wallet.reservedPaise,0);assert.equal(dash.body.wallet.availablePaise,0);
 assert.equal(dash.body.paidPaise,17000);assert.equal(dash.body.pendingPaise,0);assert.equal(dash.body.withdrawals.find(w=>w.id===second.body.id).payoutReference,'UTR123');          // the fake database ignores orderBy
 const empty=await ask(100);assert.equal(empty.body.code,'amount_exceeds_balance');assert.match(empty.body.error,/no commission available/);
 // new earnings become withdrawable again
 earn('order_wallet3',2500);assert.equal((await call({action:'dashboard'},'wallet-token')).body.wallet.availablePaise,2500);
});

test('the audience size must be one of the listed ranges, or left empty',async()=>{
 const typed=await call({...form,email:'typed@example.com',audience:'5000000000000000000'},undefined,'203.0.113.41');
 assert.equal(typed.statusCode,400);assert.equal(typed.body.code,'invalid_audience');
 const empty=await call({...form,email:'empty@example.com',audience:''},undefined,'203.0.113.42');
 assert.equal(empty.statusCode,201);
 const listed=await call({...form,email:'listed@example.com',audience:'Over 10M'},undefined,'203.0.113.43');
 assert.equal(listed.statusCode,201);
});
