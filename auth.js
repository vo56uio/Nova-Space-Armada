import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCXKzk_xRHIVERrzrg3WV9h0p3iNhtSCbw',
  authDomain: 'novaspacearmada.firebaseapp.com',
  databaseURL: 'https://novaspacearmada-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'novaspacearmada',
  storageBucket: 'novaspacearmada.appspot.com'
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const USERS = uid => doc(db, 'artifacts', 'discord-chat-v2', 'public', 'data', 'users', uid);
let mode = 'register';

const oldScreen = document.getElementById('auth-screen');
if (!oldScreen) throw new Error('auth-screen not found');

oldScreen.innerHTML = `
  <style>
    #auth-screen.auth-new{background:radial-gradient(circle at 15% 20%,rgba(88,101,242,.22),transparent 28%),radial-gradient(circle at 85% 80%,rgba(124,58,237,.2),transparent 30%),linear-gradient(135deg,#080a12,#12152a 50%,#070810);overflow:hidden}
    #auth-screen.auth-new:before{content:"";position:absolute;inset:0;opacity:.25;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:42px 42px;transform:perspective(700px) rotateX(58deg) scale(1.6) translateY(20%);animation:authGrid 18s linear infinite}
    #auth-screen.auth-new:after{content:"";position:absolute;width:42rem;height:42rem;border-radius:50%;background:rgba(88,101,242,.11);filter:blur(75px);top:-20rem;right:-14rem;animation:authFloat 9s ease-in-out infinite alternate}
    @keyframes authGrid{to{transform:perspective(700px) rotateX(58deg) scale(1.6) translateY(24%)}}
    @keyframes authFloat{to{transform:translate3d(-70px,45px,0) scale(1.08)}}
    @keyframes authIn{from{opacity:0;transform:translateY(22px) scale(.97)}to{opacity:1;transform:none}}
    @keyframes authPulse{50%{box-shadow:0 0 0 10px rgba(88,101,242,.05),0 0 55px rgba(88,101,242,.34)}}
    @keyframes authStar{50%{opacity:1;transform:scale(1.3)}}
    .auth-star{position:absolute;width:3px;height:3px;border-radius:50%;background:#fff;opacity:.3;animation:authStar 3s ease-in-out infinite}
    .auth-card-new{animation:authIn .65s cubic-bezier(.2,.8,.2,1);background:rgba(31,34,47,.8);border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 90px rgba(0,0,0,.45),inset 0 1px rgba(255,255,255,.05);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}
    .auth-logo-new{animation:authPulse 3.2s ease-in-out infinite}
    .auth-input-new{background:rgba(10,12,20,.58);border:1px solid rgba(148,155,164,.2);transition:.2s}
    .auth-input-new:focus{border-color:#5865f2;box-shadow:0 0 0 3px rgba(88,101,242,.15),0 0 24px rgba(88,101,242,.1);outline:0}
    .auth-tab-new{transition:.2s}
    .auth-tab-new.active{color:#fff;background:rgba(88,101,242,.16);box-shadow:inset 0 -2px #5865f2}
    .auth-submit-new{background:linear-gradient(135deg,#5865f2,#7c5cff);box-shadow:0 10px 28px rgba(88,101,242,.25);transition:.2s}
    .auth-submit-new:hover{transform:translateY(-1px);box-shadow:0 14px 34px rgba(88,101,242,.36)}
    .auth-strength-new{height:4px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}.auth-strength-new span{display:block;height:100%;width:0;background:#5865f2;transition:.25s}
  </style>
  ${Array.from({length:12},(_,i)=>`<i class="auth-star" style="left:${8+i*7}%;top:${12+(i*17)%78}%;animation-delay:${(i*.37).toFixed(2)}s"></i>`).join('')}
  <div class="auth-card-new relative z-10 w-full max-w-md rounded-3xl p-7 sm:p-8 text-center">
    <div class="auth-logo-new mx-auto mb-5 w-16 h-16 rounded-2xl bg-gradient-to-br from-discord-accent to-violet-500 flex items-center justify-center text-3xl shadow-xl">✦</div>
    <h1 class="text-2xl sm:text-3xl font-bold text-white">Nova Space Armada</h1>
    <p id="auth-subtitle-new" class="text-discord-muted text-sm mt-2">Создайте аккаунт и присоединяйтесь к чату.</p>
    <div class="mt-6 grid grid-cols-2 rounded-xl bg-black/20 p-1 border border-white/5">
      <button id="auth-register-new" type="button" class="auth-tab-new active rounded-lg py-2.5 text-sm font-semibold">Регистрация</button>
      <button id="auth-login-new" type="button" class="auth-tab-new rounded-lg py-2.5 text-sm font-semibold text-discord-muted">Вход</button>
    </div>
    <form id="auth-form-new" class="mt-6 space-y-4 text-left">
      <div id="auth-nick-wrap-new"><label class="block text-[11px] font-bold text-discord-muted uppercase tracking-wider mb-2">Никнейм</label><input id="auth-nick-new" maxlength="24" placeholder="Например: vo56" autocomplete="nickname" class="auth-input-new w-full rounded-xl px-4 py-3 text-white placeholder-gray-600"></div>
      <div><label class="block text-[11px] font-bold text-discord-muted uppercase tracking-wider mb-2">Электронная почта</label><div class="relative"><span class="absolute left-4 top-1/2 -translate-y-1/2 text-discord-muted">@</span><input id="auth-email-new" type="email" required placeholder="you@example.com" autocomplete="email" class="auth-input-new w-full rounded-xl pl-10 pr-4 py-3 text-white placeholder-gray-600"></div></div>
      <div><div class="flex justify-between mb-2"><label class="block text-[11px] font-bold text-discord-muted uppercase tracking-wider">Пароль</label><span class="text-[10px] text-discord-muted">минимум 6 символов</span></div><div class="relative"><input id="auth-pass-new" type="password" minlength="6" required placeholder="Введите пароль" class="auth-input-new w-full rounded-xl px-4 py-3 text-white placeholder-gray-600"><button id="auth-eye-new" type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-discord-muted hover:text-white">◉</button></div><div id="auth-strength-new" class="auth-strength-new mt-2"><span></span></div></div>
      <div id="auth-confirm-new"><label class="block text-[11px] font-bold text-discord-muted uppercase tracking-wider mb-2">Повторите пароль</label><input id="auth-pass2-new" type="password" minlength="6" placeholder="Повторите пароль" class="auth-input-new w-full rounded-xl px-4 py-3 text-white placeholder-gray-600"></div>
      <p id="auth-error-new" class="hidden text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2"></p>
      <button id="auth-submit-new" type="submit" class="auth-submit-new w-full text-white font-bold py-3.5 rounded-xl">Создать аккаунт</button>
    </form>
    <div class="mt-5 flex items-center gap-3 text-[10px] text-discord-muted"><span class="h-px flex-1 bg-white/10"></span><span>Без Google. Только почта и пароль.</span><span class="h-px flex-1 bg-white/10"></span></div>
    <p class="mt-3 text-[10px] text-discord-muted/80">Почта — для входа. Никнейм — ваше имя в чате.</p>
  </div>`;
oldScreen.className = 'auth-screen auth-new fixed inset-0 z-50 flex items-center justify-center p-4';

const $ = id => document.getElementById(id);
function error(msg){$('auth-error-new').textContent=msg;$('auth-error-new').classList.remove('hidden')}
function clearError(){$('auth-error-new').classList.add('hidden')}
function setMode(next){mode=next;$('auth-register-new').classList.toggle('active',mode==='register');$('auth-login-new').classList.toggle('active',mode==='login');$('auth-nick-wrap-new').classList.toggle('hidden',mode==='login');$('auth-confirm-new').classList.toggle('hidden',mode==='login');$('auth-strength-new').classList.toggle('hidden',mode==='login');$('auth-submit-new').textContent=mode==='register'?'Создать аккаунт':'Войти в аккаунт';$('auth-subtitle-new').textContent=mode==='register'?'Создайте аккаунт и присоединяйтесь к чату.':'Введите почту и пароль, чтобы продолжить.';clearError()}
function strength(){const v=$('auth-pass-new').value,b=$('auth-strength-new').firstElementChild;let s=0;if(v.length>=6)s++;if(v.length>=10)s++;if(/[A-ZА-Я]/.test(v)&&/[a-zа-я]/.test(v))s++;if(/\d/.test(v))s++;if(/[^A-Za-zА-Яа-я0-9]/.test(v))s++;b.style.width=Math.min(100,s*20)+'%'}
function msg(code){return ({'auth/email-already-in-use':'Эта почта уже зарегистрирована. Нажмите «Вход».','auth/invalid-email':'Проверьте адрес электронной почты.','auth/weak-password':'Пароль слишком простой. Используйте минимум 6 символов.','auth/invalid-credential':'Почта или пароль указаны неверно.','auth/user-not-found':'Аккаунт с такой почтой не найден.','auth/wrong-password':'Неверный пароль.','auth/operation-not-allowed':'В Firebase не включён вход по почте и паролю.','auth/network-request-failed':'Не удалось связаться с сервером авторизации.','auth/too-many-requests':'Слишком много попыток. Попробуйте позже.'}[code]||'Не удалось выполнить авторизацию. Попробуйте ещё раз.')}
async function saveProfile(uid,email,nick){await setDoc(USERS(uid),{uid,email,nickname:nick,status:'online',customStatus:'',lastSeen:Date.now()},{merge:true})}

$('auth-register-new').onclick=()=>setMode('register');
$('auth-login-new').onclick=()=>setMode('login');
$('auth-eye-new').onclick=()=>{$('auth-pass-new').type=$('auth-pass-new').type==='password'?'text':'password'};
$('auth-pass-new').oninput=strength;

$('auth-form-new').onsubmit=async e=>{
  e.preventDefault();clearError();
  const email=$('auth-email-new').value.trim(),pass=$('auth-pass-new').value,nick=$('auth-nick-new').value.trim(),pass2=$('auth-pass2-new').value;
  if(mode==='register'&&(!nick||pass.length<6||pass!==pass2)){if(!nick)error('Придумайте никнейм.');else if(pass.length<6)error('Пароль должен содержать минимум 6 символов.');else error('Пароли не совпадают.');return}
  const btn=$('auth-submit-new');btn.disabled=true;btn.classList.add('opacity-70','cursor-wait');
  try{
    if(mode==='register'){
      const c=await createUserWithEmailAndPassword(auth,email,pass);await saveProfile(c.user.uid,email,nick);
      localStorage.setItem('chat_uid',c.user.uid);localStorage.setItem('chat_nickname',nick);localStorage.setItem('chat_status','online');
      location.reload();
    }else{
      const c=await signInWithEmailAndPassword(auth,email,pass);const snap=await getDoc(USERS(c.user.uid));
      if(!snap.exists()||!snap.data().nickname){setMode('register');$('auth-email-new').value=email;error('Аккаунт найден, но никнейм ещё не настроен.');return}
      const d=snap.data();localStorage.setItem('chat_uid',c.user.uid);localStorage.setItem('chat_nickname',d.nickname);localStorage.setItem('chat_status',d.status||'online');localStorage.setItem('chat_custom_status',d.customStatus||'');location.reload();
    }
  }catch(err){console.error(err);error(msg(err.code))}finally{btn.disabled=false;btn.classList.remove('opacity-70','cursor-wait')}
};

window.handleLogin = e => { e?.preventDefault(); return false; };
const logout=document.getElementById('btn-logout');
if(logout)logout.onclick=async()=>{try{await signOut(auth)}catch(e){}['chat_nickname','chat_status','chat_custom_status','chat_uid'].forEach(k=>localStorage.removeItem(k));location.reload()};
setMode('register');
