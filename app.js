const $ = s => document.querySelector(s);
let me = null;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
async function api(url, options={}) {
  const r = await fetch(url, { credentials:"same-origin", headers:{ "Content-Type":"application/json", ...(options.headers||{}) }, ...options });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "Something went wrong");
  return data;
}
function toast(msg){ const t=$("#toast");t.textContent=msg;t.style.display="block";setTimeout(()=>t.style.display="none",3200); }
function showTab(tab){
  $("#loginForm").classList.toggle("hidden",tab!=="login");
  $("#registerForm").classList.toggle("hidden",tab!=="register");
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  $("#authMessage").textContent="";
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault(); const f=new FormData(e.target);
  try{await api("/api/login",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});e.target.reset();await refresh();}
  catch(err){$("#authMessage").textContent=err.message;}
});
$("#registerForm").addEventListener("submit",async e=>{
  e.preventDefault(); const f=new FormData(e.target);
  try{const d=await api("/api/register",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});e.target.reset();$("#authMessage").textContent=d.message;showTab("login");}
  catch(err){$("#authMessage").textContent=err.message;}
});
$("#logout").addEventListener("click",async()=>{await api("/api/logout",{method:"POST",body:"{}"});await refresh();});
$("#requestForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.target);
  try{await api("/api/requests",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});e.target.reset();toast("Request sent!");await loadRequests();}
  catch(err){toast(err.message);}
});
async function refresh(){
  const d=await api("/api/me");me=d.user;
  $("#auth").classList.toggle("hidden",!!me);
  $("#app").classList.toggle("hidden",!me);
  $("#account").textContent=me?`${me.name} · ${me.role}`:"";
  if(me){await loadLibrary();await loadRequests();$("#admin").classList.toggle("hidden",me.role!=="admin");if(me.role==="admin")await loadAdmin();}
}
async function loadLibrary(){
  const d=await api("/api/library");const el=$("#library");
  if(!d.items.length){el.innerHTML='<div class="empty">Your library is empty. Add authorised video or image files to the configured media folder, then refresh this page.</div>';return;}
  el.innerHTML=d.items.map(x=>`<article class="media-card"><div><span class="type">${x.type.toUpperCase()}</span><h3>${esc(x.name)}</h3><small class="muted">${(x.size/1048576).toFixed(1)} MB</small></div><button class="primary" data-media="${esc(x.id)}">${x.type==="video"?"Play":"View"}</button></article>`).join("");
  el.querySelectorAll("[data-media]").forEach(b=>b.addEventListener("click",()=>openMedia(b.dataset.media,b.textContent)));
}
function openMedia(id,title){
  const player=$("#player"),video=$("#video");
  video.src="/api/media/"+encodeURIComponent(id);
  $("#playingTitle").textContent=title;
  player.classList.remove("hidden");
  video.play().catch(()=>{});
}
$("#closePlayer").addEventListener("click",()=>{const v=$("#video");v.pause();v.removeAttribute("src");v.load();$("#player").classList.add("hidden");});
async function loadRequests(){
  const d=await api("/api/requests");$("#requests").innerHTML="<h3>Your requests</h3>"+(d.requests.length?d.requests.map(r=>`<div class="request-item"><div><strong>${esc(r.title)}</strong><small>${new Date(r.createdAt).toLocaleDateString()}</small></div><span class="type">${esc(r.status)}</span></div>`).join(""):'<p class="muted">No requests yet.</p>');
}
async function loadAdmin(){
  const [u,r]=await Promise.all([api("/api/admin/users"),api("/api/requests")]);
  $("#users").innerHTML="<h3>Accounts</h3>"+u.users.map(x=>`<div class="user-item"><div><strong>${esc(x.name)}</strong><small>${esc(x.email)} · ${x.approved?"Approved":"Pending"}</small></div>${x.role==="admin"?"":`<button class="ghost" data-user="${x.id}" data-approved="${!x.approved}">${x.approved?"Revoke":"Approve"}</button>`}</div>`).join("");
  $("#users").querySelectorAll("[data-user]").forEach(b=>b.addEventListener("click",async()=>{await api("/api/admin/users",{method:"POST",body:JSON.stringify({id:b.dataset.user,approved:b.dataset.approved==="true"})});await loadAdmin();}));
  $("#adminRequests").innerHTML=r.requests.length?r.requests.map(x=>`<div class="request-item"><div><strong>${esc(x.title)}</strong><small>From ${esc(x.userName)} · ${esc(x.details)}</small></div><select data-request="${x.id}">${["Pending","Approved","Added","Rejected"].map(s=>`<option ${x.status===s?"selected":""}>${s}</option>`).join("")}</select></div>`).join(""):'<p class="muted">No requests.</p>';
  $("#adminRequests").querySelectorAll("select").forEach(s=>s.addEventListener("change",async()=>{await api("/api/admin/requests",{method:"POST",body:JSON.stringify({id:s.dataset.request,status:s.value})});toast("Status updated.");}));
}
refresh().catch(e=>toast(e.message));
