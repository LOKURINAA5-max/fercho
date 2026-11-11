/* Fercho · núcleo: utilidades, conexión con el servidor, estado, navegación, sesión y 2FA */
const $=s=>document.querySelector(s);
const ls=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);v===null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){return null}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'$'+Math.round(Number(n)||0).toLocaleString('es-CO');
const hora=t=>new Date(t).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'});
const fh=t=>new Date(t).toLocaleString('es-CO',{dateStyle:'short',timeStyle:'short'});
const sg=d=>(d>0?'+':d<0?'-':'')+money(Math.abs(d));
const mmss=ms=>{const s=Math.max(0,Math.floor(ms/1000));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
const nn=v=>Number(v)||0;
/* Campos de dinero (pesos colombianos): se escriben con puntos de miles, ej.: 100.000 */
const pv=v=>Number(String(v??'').replace(/\D/g,''))||0;
const pf=v=>{const d=String(v??'').replace(/\D/g,'');return d===''?'':String(Number(d)).replace(/\B(?=(\d{3})+(?!\d))/g,'.')};
document.addEventListener('input',e=>{const t=e.target;if(t&&t.classList&&t.classList.contains('plata')){const f=pf(t.value);if(t.value!==f)t.value=f}},true);
let OFF=0;const now=()=>Date.now()+OFF;
const BILLETES=[2000,5000,10000,20000,50000,100000];
const CAMBIO=[100000,50000,20000,10000,5000,2000,1000,500,200,100,50];
const desglose=v=>{const o=[];for(const d of CAMBIO){const n=Math.floor(v/d);if(n){o.push(n+' × '+money(d));v-=n*d}}return o.join(' + ')};
const LBL={espera:'En espera',preparacion:'En preparación',listo:'Listo',entregando:'Entregando',entregado:'Entregado',cancelado:'Cancelado'};
let tt;function toast(m,bad){const t=$('#toast');t.className=bad?'bad':'';t.textContent=m;t.style.display='block';clearTimeout(tt);tt=setTimeout(()=>{t.style.display='none'},bad?5200:2800)}
const fail=e=>toast(e.message||'Error',true);
const modal=h=>{$('#modal').innerHTML=`<div class="ov">${h}</div>`};
const closeM=()=>{$('#modal').innerHTML=''};
let _ac;function beep(f=880){try{_ac=_ac||new(window.AudioContext||window.webkitAudioContext)();const o=_ac.createOscillator(),g=_ac.createGain();o.connect(g);g.connect(_ac.destination);o.frequency.value=f;g.gain.value=.25;o.start();setTimeout(()=>o.stop(),350)}catch(e){}}
['click','touchstart'].forEach(e=>addEventListener(e,()=>{try{_ac=_ac||new(window.AudioContext||window.webkitAudioContext)();_ac.resume&&_ac.resume()}catch(x){}},{once:true,passive:true}));
async function api(m,u,b,form){const h={'X-Requested-With':'fercho'};let body;if(form)body=b;else if(b!==undefined){h['content-type']='application/json';body=JSON.stringify(b)}
 let r;try{r=await fetch('/api'+u,{method:m,headers:h,body,credentials:'same-origin'});netOk(true)}catch(e){netOk(false);throw new Error('Sin conexión con el servidor. Reintentando…')}
 const dh=r.headers&&r.headers.get&&r.headers.get('date');if(dh){const t=Date.parse(dh);if(t)OFF=t-Date.now()}
 const j=r.status===204?null:await r.json().catch(()=>null);
 if(!r.ok){if(r.status===401&&U&&!u.startsWith('/login')&&u!=='/cambiar-password')sesionVencida();if(j&&j.codigo==='2FA_REQUERIDA')setup2faM();throw new Error((j&&j.error)||'Error de conexión')}return j}
function netOk(v){const n=$('#net');if(n)n.style.display=v?'none':'flex'}
addEventListener('online',()=>{if(typeof render==='function')render()});
const Z=(id,zs)=>(zs||[]).find(z=>z.id===id)||{nombre:'?',color:'#888'};
/* ---------- Estado ---------- */
let U=null,view='menu',cart=[],M=[],C={abierto:false},D={},mio=ls('mio'),cat=0,busq='',AL=[],nMesas=12,sending=false;
const cont={rango:'mes',desde:'',hasta:'',tab:'res',per:'dia',vista:'utilidad'};
const staff=()=>U&&['caja','admin'].includes(U.rol);
const home=()=>!U?'menu':U.rol==='cocina'?'cocina':U.rol==='caja'?'caja':'cont';
let ed={},cob=null;const sinGuardar=()=>!Object.values(ed).some(v=>v===2)||confirm('Tienes cambios sin guardar. ¿Salir y descartarlos?');
let prevN=null,prevU=null;
const go=v=>{if(!sinGuardar())return;ed={};cob=null;view=v;prevN=null;prevU=null;render()};
/* Carga de datos según la pantalla (cada pantalla agrega lo suyo en LOADERS) */
const LOADERS={};const VIEWS={};
async function load(){D.err=null;try{
 const jobs=[api('GET','/config').then(x=>{C=x})];
 if(LOADERS[view])jobs.push(LOADERS[view]());
 await Promise.all(jobs)}catch(e){D.err=e.message}}
let _rd=0;async function render(){const k=++_rd;await load();if(k!==_rd)return;const imp=C.modo_cocina==='impresion';if(U&&imp&&(view==='cocina'||view==='desp')){view='imp';return render()}if(U&&!imp&&view==='imp'){view=home();return render()}draw()}
function nav(){const r=U&&U.rol,t=[];
 if(r!=='cocina')t.push(['menu',r==='caja'||r==='admin'?'🧾 Nuevo pedido':'🍔 Menú']);
 if(!U)t.push(['mio','📍 Mi pedido']);
 const imp=C.modo_cocina==='impresion';
 if(!imp&&(r==='admin'||r==='cocina'))t.push(['cocina','🔥 Cocina']);
 if(!imp&&(r==='admin'||r==='cocina')&&C.despacho_activo&&C.pantalla_despacho)t.push(['desp','📦 Despacho']);
 if(imp&&U)t.push(['imp','🖨 Comandas']);
 if(r==='admin'||r==='caja')t.push(['caja','💵 Caja'],['fact','🧾 Facturas']);
 if(r==='admin')t.push(['cont','📊 Contabilidad'],['tur','🕑 Turnos'],['inv','📦 Inventario'],['menuadm','🍽 Carta'],['ajus','⚙ Ajustes'],['usr','👥 Usuarios'],['qr','🔳 QR']);
 return t.map(([v,l])=>`<button class="tab ${view===v?'on':''}" onclick="go('${v}')">${l}</button>`).join('')}
function draw(){
 $('#nav').innerHTML=nav();
 $('#estado').innerHTML=`<span class="pill ${C.abierto?'ok':'bad'}">${C.abierto?'● Abierto':'● Cerrado'}</span>`;
 $('#who').innerHTML=U?`<span class="mut">${esc(U.u)}</span> ${U.totp?(U.ex?'':'<button class="btn sm ghost" onclick="desact2faM()" title="Desactivar verificación en dos pasos">🔓</button>'):'<button class="btn sm ghost" onclick="setup2faM()" title="Activar verificación en dos pasos">🔐</button>'} <button class="btn sm ghost" onclick="passM(0)" title="Cambiar contraseña">🔑</button> <button class="btn sm ghost" onclick="logout()">Salir</button>`:`<button class="btn sm ghost" onclick="loginM()">Personal</button>`;
 const wide=['cocina','desp','caja','imp'].includes(view)||(view==='menu'&&staff());$('#app').classList.toggle('wide',wide);
 const sy=window.scrollY,v=VIEWS[view]||VIEWS.menu;
 $('#app').innerHTML=(D.err?`<div class="aviso bad">${esc(D.err)}</div>`:'')+v();
 if(['cocina','desp','caja'].includes(view))window.scrollTo(0,sy);
 cartBar();AFTER[view]&&AFTER[view]();tick();altoCab()}
function altoCab(){const h=document.querySelector('.hd');if(h)document.documentElement.style.setProperty('--hh',h.offsetHeight+'px')}
addEventListener('resize',altoCab);
const AFTER={};
/* ---------- Cronómetros ---------- */
function tick(){const n=now(),meta=C.meta_min||10,al=C.alerta_min||15;
 document.querySelectorAll('.crono,.since').forEach(el=>{const t=+el.dataset.t;if(!t)return;const ms=n-t;el.textContent=mmss(ms);
  if(el.classList.contains('crono')&&!el.classList.contains('mini')){const c=el.closest('.kcard,.ocard');if(!c||c.classList.contains('espero'))return;const m=ms/60000,cl=m>=al?'late':m>=meta?'warn':'ok';
   if(!c.classList.contains(cl)){c.classList.remove('ok','warn','late');c.classList.add(cl);if(cl==='late'&&c.id&&!LATE.has(c.id)){LATE.add(c.id);if(view==='cocina')beep(520)}}}});
 document.querySelectorAll('[data-espera]').forEach(el=>{const t=+el.dataset.espera,lim=(C.alerta_espera_min||3)*60000;el.classList.toggle('alerta',n-t>=lim)})}
const LATE=new Set();setInterval(tick,1000);
/* ---------- Ventanas de sesión, contraseña y 2FA ---------- */
function loginM(){modal(`<div class="box"><h3>Ingreso del personal</h3><input id="lu" placeholder="Usuario" autocomplete="username"><input id="lp" type="password" placeholder="Contraseña" autocomplete="current-password" onkeydown="if(event.key==='Enter')login()"><div class="row"><button class="btn ghost" onclick="closeM()">Cancelar</button><button class="btn grow" onclick="login()">Entrar</button></div></div>`)}
let tmp2=null;
async function login(){try{const r=await api('POST','/login',{usuario:$('#lu').value,password:$('#lp').value});
 if(r.requiere_2fa){tmp2=r.temp;modal(`<div class="box"><h3>Verificación en dos pasos</h3><p class="mut">Cuenta: <b>${esc(r.usuario||'')}</b>. Escribe el código de 6 dígitos de la entrada <b>«Fercho · ${esc(r.usuario||'')}»</b> de tu app (o un código de recuperación). Si falla, espera a que cambie el número e inténtalo con el nuevo.</p><input id="lc" autocomplete="one-time-code" placeholder="Código" onkeydown="if(event.key==='Enter')login2()"><div class="row"><button class="btn ghost" onclick="closeM()">Cancelar</button><button class="btn grow" onclick="login2()">Verificar</button></div></div>`);return}
 await entrar(r)}catch(e){fail(e)}}
async function login2(){try{await entrar(await api('POST','/login/2fa',{temp:tmp2,codigo:$('#lc').value}))}catch(e){fail(e)}}
async function entrar(r){U={u:r.usuario,rol:r.rol,totp:r.totp,ex:r.exigida};closeM();view=home();await render();alertas();if(r.debe_configurar_2fa)setup2faM()}
function sesionVencida(){U=null;AL=[];pintaAl();view='menu';cart=[];render()}
async function logout(){try{await api('POST','/logout')}catch(e){}sesionVencida()}
function passM(id){modal(`<div class="box"><h3>${id?'Nueva contraseña del usuario':'Cambiar mi contraseña'}</h3>${id?'':'<input id="pa" type="password" placeholder="Contraseña actual">'}<input id="pn" type="password" placeholder="Nueva (mín. 10, letras y números)"><div class="row"><button class="btn ghost" onclick="closeM()">Cancelar</button><button class="btn grow" onclick="savePass(${id})">Guardar</button></div></div>`)}
async function savePass(id){try{id?await api('PATCH','/usuarios/'+id,{password:$('#pn').value}):await api('POST','/cambiar-password',{actual:$('#pa').value,nueva:$('#pn').value});closeM();toast('Contraseña actualizada')}catch(e){fail(e)}}
async function setup2faM(){try{const r=await api('POST','/2fa/preparar');modal(`<div class="box"><h3>Verificación en dos pasos</h3><p class="mut">Cuenta: <b>${esc(r.usuario)}</b>. 1) Instala Google Authenticator, Microsoft Authenticator o similar. 2) Escanea este código (aparecerá como «Fercho · ${esc(r.usuario)}»; borra entradas viejas del mismo nombre). 3) Escribe el código de 6 dígitos.</p><div id="q2" style="display:flex;justify-content:center;margin:8px;background:#fff;padding:8px;border-radius:10px"></div><p class="mut" style="word-break:break-all">Si no puedes escanear, escribe esta clave en la app: <b>${esc(r.secreto)}</b></p><input id="c2" inputmode="numeric" maxlength="7" placeholder="Código de 6 dígitos"><div class="row"><button class="btn ghost" onclick="closeM()">Después</button><button class="btn grow" onclick="activar2fa()">Activar</button></div></div>`);if(typeof QRCode!=='undefined')new QRCode($('#q2'),{text:r.uri,width:160,height:160})}catch(e){if(!/ya tienes/i.test(e.message))fail(e)}}
function desact2faM(){modal(`<div class="box"><h3>Desactivar verificación en dos pasos</h3><p class="mut">Tu cuenta quedará protegida solo por la contraseña. Confirma con tu contraseña y un código actual de la app (o de recuperación). Puedes volver a activarla cuando quieras.</p><input id="dp" type="password" placeholder="Contraseña" autocomplete="current-password"><input id="dc" autocomplete="one-time-code" placeholder="Código" onkeydown="if(event.key==='Enter')desact2fa()"><div class="row"><button class="btn ghost" onclick="closeM()">Cancelar</button><button class="btn grow" onclick="desact2fa()">Desactivar</button></div></div>`)}
async function desact2fa(){try{await api('POST','/2fa/desactivar',{password:$('#dp').value,codigo:$('#dc').value});U.totp=false;closeM();draw();toast('Verificación en dos pasos desactivada')}catch(e){fail(e)}}
async function activar2fa(){try{const r=await api('POST','/2fa/activar',{codigo:$('#c2').value});U.totp=true;modal(`<div class="box"><h3>¡Listo! Guarda estos códigos</h3><p class="mut">Sirven una sola vez si pierdes el celular. Anótalos en un lugar seguro; no se vuelven a mostrar.</p><p style="font-family:monospace;line-height:1.8">${r.recuperacion.map(c=>esc(c.slice(0,5)+'-'+c.slice(5))).join('<br>')}</p><button class="btn lg" onclick="closeM();draw()">Ya los guardé</button></div>`)}catch(e){fail(e)}}
/* ---------- Alertas del administrador ---------- */
const msgEv=e=>{const d=e.detalle||{},u=e.usuario||'el sistema';return({apertura:`Caja abierta por ${u} con ${money(d.monto)}`,cierre:`Caja cerrada por ${u}. Esperado ${money(d.esperado)}, contado ${money(d.contado)}, diferencia ${sg(Number(d.diferencia))}${d.alerta?' ⚠':''}`,retiro:`${u} retiró ${money(d.monto)}: ${d.motivo}`,ingreso:`${u} ingresó ${money(d.monto)} a la caja: ${d.motivo}`,retiro_alto:`⚠ Retiro alto de ${money(d.monto)} por ${u}: ${d.motivo}`,turno_largo:`⚠ La caja lleva más de ${d.horas} horas abierta`,acceso_nuevo:`${u} inició sesión desde una red o dispositivo nuevos (${d.ip})`,cuenta_bloqueada:`⚠ La cuenta de ${u} se bloqueó por intentos fallidos de ingreso`,reset_2fa:`Se quitó la verificación en dos pasos de ${u} (por ${d.por})`,gasto_anulado:`Se anuló un gasto de ${money(d.monto)}: ${d.descripcion}`,cancelado_en_preparacion:`⚠ ${u} canceló un pedido en preparación (${d.motivo||'sin motivo'}). Se registró como desperdicio`})[e.evento]||e.evento};
async function alertas(){if(!U||U.rol!=='admin')return;try{const k=ls('al'),r=await api('GET','/alertas'+(k!==null?'?desde='+k:''));ls('al',String(r.ultimo));if(k!==null&&r.items.length){AL=AL.concat(r.items).slice(-10);beep();pintaAl()}}catch(e){}}
function pintaAl(){$('#alertas').innerHTML=AL.map(a=>`<div class="al ${(a.detalle&&a.detalle.alerta)||['retiro_alto','turno_largo','cuenta_bloqueada','cancelado_en_preparacion'].includes(a.evento)?'bad':''}"><span>🔔 ${esc(msgEv(a))}</span><button class="btn sm ghost" onclick="AL=AL.filter(x=>String(x.id)!=='${a.id}');pintaAl()">✕</button></div>`).join('')}
/* ---------- Tiempo real, inactividad y arranque ---------- */
const VIVAS=['cocina','desp','caja','mio','tur','cont','fact','imp'];
const vivo=()=>VIVAS.includes(view)&&!$('#modal').innerHTML&&!document.activeElement?.matches?.('input,select,textarea');
try{const es=new EventSource('/api/eventos');let tm;es.onmessage=()=>{clearTimeout(tm);tm=setTimeout(()=>{alertas();if(typeof impTick==='function')impTick();if(vivo())render();else if(view==='menu'&&!$('#modal').innerHTML)api('GET','/config').then(x=>{const ch=x.abierto!==C.abierto;C=x;if(ch)render()}).catch(()=>{})},300)}}catch(e){}
let ult=Date.now();['click','keydown','touchstart'].forEach(e=>addEventListener(e,()=>{ult=Date.now()},{passive:true}));
setInterval(()=>{if(U&&['admin','caja'].includes(U.rol)&&Date.now()-ult>30*60*1000){logout();toast('Se cerró tu sesión por inactividad.',true)}},60000);
setInterval(()=>{alertas();if(vivo())render()},20000);
(async()=>{try{const y=await api('GET','/yo');U={u:y.usuario,rol:y.rol,totp:y.totp,ex:y.exigida};view=home();if(y.p2)setTimeout(setup2faM,300)}catch(e){}render();alertas()})();
