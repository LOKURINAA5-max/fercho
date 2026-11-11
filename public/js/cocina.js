/* Fercho · cocina: una pantalla por zona (tablet), y pantalla de despacho */
let zSel=ls('zona')||'todas';
LOADERS.cocina=async()=>{D.k=await api('GET','/cocina');if(zSel!=='todas'&&!D.k.zonas.some(z=>String(z.id)===zSel)){zSel='todas';ls('zona',null)}};
LOADERS.desp=LOADERS.cocina;
const ztareas=(p,z)=>p.tareas.filter(t=>t.zona_id===z);
function zestado(ts){return ts.every(t=>t.estado==='lista')?'lista':ts.some(t=>t.estado!=='espera')?'preparando':'espera'}
const zres=(p,zs)=>[...new Set(p.tareas.map(t=>t.zona_id))].map(id=>({z:Z(id,zs),id,est:zestado(ztareas(p,id))}));
function otras(p,zid,zs){const o=zres(p,zs).filter(x=>x.id!==zid);if(!o.length)return '';
 return `<div class="otras">${o.map(x=>`<div><span class="zchip ${x.est}" style="--zc:${esc(x.z.color)}">${esc(x.z.nombre)}</span> ${x.est==='lista'?'<b style="color:var(--ok)">lista ✔</b>':x.est==='preparando'?'preparando…':'en espera'}</div>`).join('')}</div>`}
function badges(p){const b=[];if(p.complemento_num)b.push(`<span class="badge comp">+ COMPLEMENTO de #${p.complemento_num}</span>`);
 if(p.modificado_en&&now()-Date.parse(p.modificado_en)<15*60000)b.push(`<span class="badge mod">✏ MODIFICADO ${hora(p.modificado_en)}</span>`);return b.length?`<div class="badges">${b.join('')}</div>`:''}
function kcardZ(p,z,zs){const ts=ztareas(p,z.id),est=zestado(ts),base=Date.parse(p.confirmado_en||p.creado_en);
 return `<div class="kcard ok ${est==='espera'?'espera':''}" id="k${p.id}-${z.id}" style="--zc:${esc(z.color)}"><div class="khead"><span class="n">#${p.numero}</span><span class="dest">${destS(p)}</span><span class="crono" data-t="${base}"></span></div>${badges(p)}
 <div>${ts.map(t=>`<div class="kit ${t.estado==='lista'?'done':''}" onclick="tarea(${t.id},${t.estado!=='lista'})"><span class="cb">${t.estado==='lista'?'✔':''}</span><span class="tx"><span class="qty">${t.cantidad}×</span> ${esc(t.nombre)}${t.parte?`<small>${esc(t.parte)}${t.origen?' · de «'+esc(t.origen)+'»':''}</small>`:t.origen?`<small>de «${esc(t.origen)}»</small>`:''}${t.sin&&t.sin.length?`<span class="sin">SIN ${esc(t.sin.join(', '))}</span>`:''}${t.nota?`<span class="nota">📝 ${esc(t.nota)}</span>`:''}</span></div>`).join('')}</div>
 ${otras(p,z.id,zs)}
 ${est==='espera'?`<button class="btn zona xl" style="background:${esc(z.color)}" onclick="zonaAcc('${p.id}',${z.id},'empezar')">▶ EMPEZAR</button>`:`<button class="btn ok xl" onclick="zonaAcc('${p.id}',${z.id},'listo')">✔ ${esc(z.nombre).toUpperCase()} LISTA</button>`}</div>`}
function kcardEspera(p,z,zs){const ts=ztareas(p,z.id),t0=Math.max(...ts.map(t=>Date.parse(t.listo_en||p.confirmado_en)));
 return `<div class="kcard espero" id="e${p.id}-${z.id}" data-espera="${t0}" style="--zc:${esc(z.color)}"><div class="khead"><span class="n">#${p.numero}</span><span class="dest">${destS(p)}</span><span class="crono mini" data-t="${t0}"></span></div><div class="mut">✔ Tu parte está lista · esperando a las demás zonas</div>${otras(p,z.id,zs)}<button class="btn ghost sm" onclick="zonaAcc('${p.id}',${z.id},'reabrir')">↩ Reabrir mi zona</button></div>`}
function vCocina(){const k=D.k;if(!k)return '<div class="card vacio mut">Cargando…</div>';
 const zs=k.zonas;if(!zs.length)return '<div class="card vacio">No hay zonas activas. El administrador debe crear al menos una en Ajustes.</div>';
 const mostrar=zSel==='todas'?zs:zs.filter(z=>String(z.id)===zSel);
 const pend=z=>k.pedidos.filter(p=>ztareas(p,z.id).length&&!ztareas(p,z.id).every(t=>t.estado==='lista'));
 const tot=mostrar.reduce((a,z)=>a+pend(z).filter(p=>zestado(ztareas(p,z.id))==='espera').length,0);if(prevN!==null&&tot>prevN)beep();prevN=tot;
 const bar=`<div class="kbar"><button class="zb ${zSel==='todas'?'on':''}" style="--zc:#888" onclick="setZ('todas')">TODAS<small>${k.pedidos.length} pedidos</small></button>${zs.map(z=>`<button class="zb ${String(z.id)===zSel?'on':''}" style="--zc:${esc(z.color)}" onclick="setZ('${z.id}')">${esc(z.nombre)}<small>${pend(z).length} por hacer</small></button>`).join('')}</div>`;
 const bloque=z=>{const ps=k.pedidos.filter(p=>ztareas(p,z.id).length),act=ps.filter(p=>!ztareas(p,z.id).every(t=>t.estado==='lista')),esp=ps.filter(p=>ztareas(p,z.id).every(t=>t.estado==='lista')&&p.estado==='preparacion'&&!p.zonas_listas);
  return (zSel==='todas'?`<h3><span class="zdot" style="background:${esc(z.color)}"></span>${esc(z.nombre)} <span class="pill">${act.length}</span></h3>`:'')+
  (act.length?`<div class="kgrid">${act.map(p=>kcardZ(p,z,zs)).join('')}</div>`:`<div class="card vacio mut" style="font-size:22px">Sin pedidos para ${esc(z.nombre)} 🎉</div>`)+
  (esp.length?`<h3>⏳ Listos aquí, esperando a otra zona</h3><div class="kgrid">${esp.map(p=>kcardEspera(p,z,zs)).join('')}</div>`:'')};
 return bar+mostrar.map(bloque).join('')}
VIEWS.cocina=vCocina;
function setZ(v){zSel=v;ls('zona',v==='todas'?null:v);prevN=null;draw()}
async function tarea(id,hecho){try{await api('PATCH','/cocina/tareas/'+id,{hecho});render()}catch(e){fail(e)}}
async function zonaAcc(pid,zid,acc){try{await api('PATCH',`/cocina/${pid}/zonas/${zid}/${acc}`);render()}catch(e){fail(e)}}
/* ---------- Despacho (armar el pedido completo) ---------- */
function vDesp(){const k=D.k;if(!k)return '<div class="card vacio mut">Cargando…</div>';
 if(!k.despacho_activo)return '<div class="card vacio">El paso de despacho está desactivado. Los pedidos quedan listos apenas terminan todas las zonas.</div>';
 const arm=k.pedidos.filter(p=>p.estado==='preparacion'&&p.zonas_listas),cur=k.pedidos.filter(p=>!(p.estado==='preparacion'&&p.zonas_listas));
 if(prevN!==null&&arm.length>prevN)beep(660);prevN=arm.length;
 return `<h3>📦 Para armar y despachar <span class="pill">${arm.length}</span></h3>`+(arm.length?`<div class="kgrid">${arm.map(p=>`<div class="kcard ok dsp" id="d${p.id}" style="--zc:var(--ok)"><div class="khead"><span class="n">#${p.numero}</span><span class="dest">${destS(p)}</span><span class="crono" data-t="${Date.parse(p.zonas_listas_en||p.confirmado_en||p.creado_en)}"></span></div>${badges(p)}<div style="margin:8px 0">${p.items.map(i=>`<div class="it"><span style="color:var(--pri2)">${i.cantidad}×</span> ${esc(i.nombre)}${i.sin&&i.sin.length?` <span class="sin">SIN ${esc(i.sin.join(', '))}</span>`:''}${i.nota?` <span class="nota">📝 ${esc(i.nota)}</span>`:''}</div>`).join('')}</div><button class="btn ok xl" onclick="armar('${p.id}')">✔ ARMADO · LISTO PARA ENTREGAR</button></div>`).join('')}</div>`:'<div class="card vacio mut" style="font-size:22px">Nada por armar ahora</div>')+
 (cur.length?`<h3>🔥 Aún en las zonas</h3><div class="kgrid">${cur.map(p=>`<div class="kcard ok" style="--zc:#777"><div class="khead"><span class="n">#${p.numero}</span><span class="dest">${destS(p)}</span></div><div class="prog">${zres(p,k.zonas).map(x=>`<span class="zchip ${x.est}" style="--zc:${esc(x.z.color)}">${x.est==='lista'?'✔':x.est==='preparando'?'🔥':'⏳'} ${esc(x.z.nombre)}</span>`).join('')}</div></div>`).join('')}</div>`:'')}
VIEWS.desp=vDesp;
async function armar(id){try{await api('PATCH','/cocina/'+id+'/armar');render()}catch(e){fail(e)}}
