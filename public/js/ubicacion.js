/* Fercho · ubicación para domicilios: GPS del celular o pin en el mapa (OpenStreetMap + Leaflet, sin claves ni costo) */
const BGA={lat:7.1193,lng:-73.1227};   // Bucaramanga (punto de partida del mapa)
const tgt=nm=>nm==='P'?P:F;
const refrescaLoc=nm=>{if(nm==='P')posDraw();else if(nm==='F')cartM()};
function enColombia(lat,lng){return lat>-4.5&&lat<13.5&&lng>-79.5&&lng<-66.5}
async function aplicaLoc(nm,lat,lng){const t=tgt(nm);try{const r=await api('POST','/domicilio/cotizar',{lat,lng});t.lat=lat;t.lng=lng;t.km=r.km;t.dcosto=r.modo==='km'?r.costo:null;if(nm==='P'&&P.dfee==='')P.dfee=''}catch(e){
  if(!/Marca tu ubicación|no configuró/i.test(e.message)){fail(e);return}   // modo km sin ubicación del local: se guarda el punto igual
  t.lat=lat;t.lng=lng;t.km=null;t.dcosto=null}
 refrescaLoc(nm)}
function quitaLoc(nm){const t=tgt(nm);t.lat=t.lng=t.km=t.dcosto=null;refrescaLoc(nm)}
function gpsLoc(nm){if(!navigator.geolocation)return toast('Tu navegador no permite ubicación. Usa «Marcar en el mapa»',true);
 toast('Buscando tu ubicación…');
 navigator.geolocation.getCurrentPosition(p=>{const la=Math.round(p.coords.latitude*1e6)/1e6,ln=Math.round(p.coords.longitude*1e6)/1e6;
  if(!enColombia(la,ln))return toast('Tu ubicación parece estar fuera de Colombia. Márcala en el mapa',true);
  if(p.coords.accuracy>300)toast('Ubicación aproximada: ajústala en el mapa si hace falta');
  pickLoc(nm,{lat:la,lng:ln})},()=>toast('No pudimos obtener tu ubicación. Permite el acceso o márcala en el mapa',true),{enableHighAccuracy:true,timeout:12000,maximumAge:30000})}
/* Selector genérico: pickMap(inicio, titulo, texto del botón, función(lat,lng)) */
let _mp=null;
async function pickMap(ini,titulo,boton,cb,cancel){await libMapa();
 modal(`<div class="box w"><h3>${esc(titulo)}</h3><div id="mapa" style="height:min(55vh,380px);border-radius:12px;overflow:hidden;background:#222"></div><p class="mut" id="mapaTx" style="margin:6px 0">Toca el mapa o arrastra el pin hasta la puerta de la casa.</p><div class="row"><button class="btn ghost" onclick="mapaCancel()">Cancelar</button><button class="btn ghost" onclick="mapaGps()">📍 Mi ubicación</button><button class="btn grow" id="mapaOk" onclick="mapaOk()" ${ini?'':'disabled'}>${esc(boton)}</button></div></div>`);
 _mp={cb,cancel,pt:ini?{lat:ini.lat,lng:ini.lng}:null,m:null,k:null};
 if(typeof L==='undefined'){$('#mapa').innerHTML='<div class="vacio mut">No se pudo cargar el mapa. Usa «📍 Mi ubicación».</div>';return}
 const c=ini||BGA,m=L.map('mapa',{zoomControl:true}).setView([c.lat,c.lng],ini?17:14);_mp.m=m;
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(m);
 const icon=L.divIcon({className:'',html:'<div style="font-size:38px;line-height:38px;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 3px #000a)">📍</div>',iconSize:[0,0]});
 const poner=(la,ln)=>{_mp.pt={lat:la,lng:ln};if(_mp.k)_mp.k.setLatLng([la,ln]);else{_mp.k=L.marker([la,ln],{icon,draggable:true}).addTo(m);_mp.k.on('dragend',()=>{const q=_mp.k.getLatLng();_mp.pt={lat:q.lat,lng:q.lng};txt()})}$('#mapaOk').disabled=false;txt()};
 const txt=()=>{const e=$('#mapaTx');if(e&&_mp.pt)e.innerHTML='Ubicación elegida ✔ <span class="mut">(puedes arrastrar el pin para ajustarla)</span>'};
 _mp.poner=poner;m.on('click',e=>poner(e.latlng.lat,e.latlng.lng));if(ini)poner(ini.lat,ini.lng);setTimeout(()=>m.invalidateSize(),150)}
function mapaGps(){if(!navigator.geolocation)return toast('Tu navegador no permite ubicación',true);
 navigator.geolocation.getCurrentPosition(p=>{if(!_mp)return;const la=p.coords.latitude,ln=p.coords.longitude;if(_mp.m){_mp.m.setView([la,ln],17);_mp.poner(la,ln)}else{_mp.pt={lat:la,lng:ln};$('#mapaOk').disabled=false;toast('Ubicación obtenida')}},()=>toast('No pudimos obtener tu ubicación',true),{enableHighAccuracy:true,timeout:12000})}
function mapaCancel(){const c=_mp&&_mp.cancel;closeM();if(c)c()}
function mapaOk(){if(!_mp||!_mp.pt)return;const{lat,lng}=_mp.pt,cb=_mp.cb;cb(Math.round(lat*1e6)/1e6,Math.round(lng*1e6)/1e6)}
function pickLoc(nm,ini){const t=tgt(nm);pickMap(ini||(t.lat?{lat:+t.lat,lng:+t.lng}:null),'Marca dónde entregamos','Confirmar ubicación',(la,ln)=>{closeM();aplicaLoc(nm,la,ln)},()=>refrescaLoc(nm))}
