const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),crypto=require('crypto');
const db=new Pool({connectionString:process.env.DATABASE_URL});
const {JWT_SECRET,ADMIN_KEY,PAYSTACK_SECRET}=process.env;
const AD_SECS=10,AD_MIN=30;
const PLANS={daily:{m:1440,p:200},weekly:{m:10080,p:1000},monthly:{m:43200,p:3500}};
const app=express();
app.use(express.json({verify:(q,_s,b)=>{q.raw=b}}));
app.use(express.static('public'));
const wrap=f=>(q,s)=>f(q,s).catch(e=>{console.error(e);s.status(500).json({error:'Server error'})});
const sign=o=>jwt.sign(o,JWT_SECRET,{expiresIn:'30d'});
const auth=kind=>(q,s,n)=>{try{const t=jwt.verify((q.headers.authorization||'').slice(7),JWT_SECRET);if(t.kind!==kind)throw 0;q.auth=t;n()}catch{s.status(401).json({error:'Sign in first'})}};
const admin=(q,s,n)=>q.headers['x-admin-key']===ADMIN_KEY&&ADMIN_KEY?n():s.status(401).json({error:'Admin key required'});

// Extend a user's access and sync it to FreeRADIUS. Returns the one-time hotspot password.
async function grant(phone,minutes,cx=db){
  const {rows:[u]}=await cx.query(`UPDATE users SET access_until=GREATEST(now(),COALESCE(access_until,now()))+($2||' minutes')::interval WHERE phone=$1 RETURNING access_until`,[phone,String(minutes)]);
  const secs=Math.floor((u.access_until-Date.now())/1000),secret=crypto.randomBytes(6).toString('hex');
  await cx.query('DELETE FROM radcheck WHERE username=$1',[phone]);await cx.query('DELETE FROM radreply WHERE username=$1',[phone]);
  await cx.query(`INSERT INTO radcheck(username,attribute,op,value) VALUES($1,'Cleartext-Password',':=',$2)`,[phone,secret]);
  await cx.query(`INSERT INTO radreply(username,attribute,op,value) VALUES($1,'Session-Timeout',':=',$2)`,[phone,String(secs)]);
  return {username:phone,password:secret,seconds:secs};
}

// ---- Users
app.post('/api/login',wrap(async(q,s)=>{const p=String(q.body.phone||'').replace(/\s/g,'');
  if(!/^\+?\d{10,14}$/.test(p))return s.status(400).json({error:'Enter a valid phone number'});
  await db.query('INSERT INTO users(phone) VALUES($1) ON CONFLICT DO NOTHING',[p]);s.json({token:sign({kind:'user',phone:p})})}));
app.post('/api/ad/start',auth('user'),wrap(async(q,s)=>{
  const {rows:[c]}=await db.query('SELECT id,brand,msg,video_url,cpv FROM campaigns WHERE active AND budget>=cpv ORDER BY views,random() LIMIT 1');
  if(!c)return s.status(404).json({error:'No sponsored ads right now. Try a voucher or paid plan.'});
  const token=crypto.randomBytes(16).toString('hex');
  await db.query('INSERT INTO ad_sessions(token,phone,campaign_id,cpv) VALUES($1,$2,$3,$4)',[token,q.auth.phone,c.id,c.cpv]);
  s.json({token,seconds:AD_SECS,brand:c.brand,msg:c.msg,video_url:c.video_url})}));
app.post('/api/ad/claim',auth('user'),wrap(async(q,s)=>{
  const cx=await db.connect();try{await cx.query('BEGIN');
    const {rows:[a]}=await cx.query('SELECT * FROM ad_sessions WHERE token=$1 AND phone=$2 AND NOT claimed FOR UPDATE',[q.body.token,q.auth.phone]);
    if(!a||Date.now()-a.started_at<AD_SECS*1000){await cx.query('ROLLBACK');return s.status(400).json({error:'Watch the full ad first'})}
    await cx.query('UPDATE campaigns SET budget=budget-cpv,views=views+1 WHERE id=$1 AND budget>=cpv',[a.campaign_id]);
    await cx.query('UPDATE ad_sessions SET claimed=true WHERE token=$1',[a.token]);
    const g=await grant(q.auth.phone,AD_MIN,cx);await cx.query('COMMIT');s.json(g)}
  catch(e){await cx.query('ROLLBACK');throw e}finally{cx.release()}}));
app.post('/api/voucher/redeem',auth('user'),wrap(async(q,s)=>{
  const {rows:[v]}=await db.query('UPDATE vouchers SET used=true WHERE code=$1 AND NOT used RETURNING minutes',[String(q.body.code||'').trim().toUpperCase()]);
  if(!v)return s.status(400).json({error:'Code not found or already used'});s.json(await grant(q.auth.phone,v.minutes))}));
app.post('/api/pay/init',auth('user'),wrap(async(q,s)=>{const pl=PLANS[q.body.plan];if(!pl)return s.status(400).json({error:'Unknown plan'});
  s.json(await paystack(q.auth.phone+'@freenet.app',pl.p,{kind:'plan',phone:q.auth.phone,plan:q.body.plan}))}));

// ---- Sponsors
app.post('/api/sponsor/register',wrap(async(q,s)=>{const {email,password,name}=q.body;
  if(!email||!name||String(password||'').length<8)return s.status(400).json({error:'Name, email and an 8+ character password are required'});
  try{const {rows:[r]}=await db.query('INSERT INTO sponsors(email,pass_hash,name) VALUES($1,$2,$3) RETURNING id',[email.toLowerCase(),await bcrypt.hash(password,10),name]);
    s.json({token:sign({kind:'sponsor',id:r.id})})}catch{s.status(409).json({error:'Email already registered'})}}));
app.post('/api/sponsor/login',wrap(async(q,s)=>{const {rows:[r]}=await db.query('SELECT * FROM sponsors WHERE email=$1',[String(q.body.email||'').toLowerCase()]);
  if(!r||!await bcrypt.compare(String(q.body.password||''),r.pass_hash))return s.status(401).json({error:'Wrong email or password'});s.json({token:sign({kind:'sponsor',id:r.id})})}));
app.get('/api/sponsor/campaigns',auth('sponsor'),wrap(async(q,s)=>s.json((await db.query('SELECT * FROM campaigns WHERE sponsor_id=$1 ORDER BY id DESC',[q.auth.id])).rows)));
app.post('/api/sponsor/campaigns',auth('sponsor'),wrap(async(q,s)=>{const {brand,msg,video_url,cpv}=q.body;
  if(!brand||!msg||!(cpv>=20))return s.status(400).json({error:'Brand, message and a cost per view of ₦20+ are required'});
  if(video_url&&!/^https:\/\//.test(video_url))return s.status(400).json({error:'Video link must start with https://'});
  const {rows:[c]}=await db.query('INSERT INTO campaigns(sponsor_id,brand,msg,video_url,cpv) VALUES($1,$2,$3,$4,$5) RETURNING *',[q.auth.id,brand,msg,video_url||null,cpv]);s.json(c)}));
app.post('/api/sponsor/topup',auth('sponsor'),wrap(async(q,s)=>{const amt=+q.body.amount;if(!(amt>=500))return s.status(400).json({error:'Minimum top-up is ₦500'});
  const {rows:[c]}=await db.query('SELECT id FROM campaigns WHERE id=$1 AND sponsor_id=$2',[q.body.campaign_id,q.auth.id]);if(!c)return s.status(404).json({error:'Campaign not found'});
  const {rows:[r]}=await db.query('SELECT email FROM sponsors WHERE id=$1',[q.auth.id]);
  s.json(await paystack(r.email,amt,{kind:'topup',campaign_id:c.id}))}));

// ---- Paystack
async function paystack(email,naira,metadata){
  const r=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:'Bearer '+PAYSTACK_SECRET,'Content-Type':'application/json'},body:JSON.stringify({email,amount:naira*100,metadata})});
  const j=await r.json();return {url:j.data&&j.data.authorization_url,error:j.status?undefined:j.message}}
app.post('/api/pay/webhook',wrap(async(q,s)=>{
  const sig=crypto.createHmac('sha512',PAYSTACK_SECRET).update(q.raw).digest('hex');
  if(sig!==q.headers['x-paystack-signature'])return s.sendStatus(401);
  const e=q.body;if(e.event!=='charge.success')return s.sendStatus(200);
  const d=e.data,m=d.metadata||{},ins=await db.query('INSERT INTO payments(reference,kind,amount) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[d.reference,m.kind,d.amount/100]);
  if(ins.rowCount){if(m.kind==='plan'&&PLANS[m.plan])await grant(m.phone,PLANS[m.plan].m);
    if(m.kind==='topup')await db.query('UPDATE campaigns SET budget=budget+$2 WHERE id=$1',[m.campaign_id,Math.floor(d.amount/100)])}
  s.sendStatus(200)}));

// ---- Admin
app.get('/api/admin/stats',admin,wrap(async(q,s)=>{const r=await db.query(`SELECT
 (SELECT count(*) FROM users) users,(SELECT count(*) FROM ad_sessions WHERE claimed) ad_views,
 (SELECT coalesce(sum(cpv),0) FROM ad_sessions WHERE claimed) sponsor_revenue,
 (SELECT coalesce(sum(amount),0) FROM payments WHERE kind='plan') plan_revenue,
 (SELECT count(*) FROM vouchers WHERE NOT used) open_vouchers`);s.json(r.rows[0])}));
app.post('/api/admin/vouchers',admin,wrap(async(q,s)=>{const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',out=[];
  for(let i=0;i<Math.min(200,+q.body.count||1);i++){let c='FN-';for(let j=0;j<6;j++)c+=A[crypto.randomInt(A.length)];out.push(c);
    await db.query('INSERT INTO vouchers(code,minutes) VALUES($1,$2)',[c,+q.body.minutes||60])}s.json({codes:out})}));
app.listen(process.env.PORT||3000);
