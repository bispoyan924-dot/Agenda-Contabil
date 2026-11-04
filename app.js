import {
  OBRIGS, OB, REGIMES, PADRAO, SEGMENTOS, padraoPara, WD, MESES, DEF_CFG,
  pad, iso, fromIso, br, brShort, makeCalc, ruleText, countdown,
  itemsFor, pendencias, buildMsg, cfgFromRow, cfgToRow, entregaKey, todayIn,
} from "/lib/prazos.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = todayIn("America/Cuiaba");

const S = {
  empresas: new Map(), entregas: new Map(), config: { ...DEF_CFG }, calc: makeCalc(DEF_CFG),
  y: today.getFullYear(), m: today.getMonth(), filtro: "todas", emp: "", dia: null, editId: null, delId: null,
};
const ctx = () => ({ calc: S.calc, empresas: [...S.empresas.values()], entregas: S.entregas, today });
const show = v => ["loginView", "appView", "setupView"].forEach(id => ($("#" + id).hidden = id !== v));

let tt;
function toast(m) { const el = $("#toast"); el.textContent = m; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => (el.hidden = true), 2800); }
function setSync(mode) {
  const el = $("#sync"); el.dataset.s = mode;
  el.textContent = mode === "ok" ? "Salvo na nuvem" : mode === "err" ? "Sem conexão – não salvou" : "Salvando…";
}

/* ---------- Supabase ---------- */
let sb = null, session = null;
const EMP_COLS = "id,nome,cnpj,regime,segmento,ie,obrigs";
const CFG_COLS = "whatsapp,email,dias_antes,ajustes,feriados,ultimo_envio,gmail,senha_app,telegram_chat,telegram_bot,telegram_nome";
let synced = { emp: new Map(), ent: new Set(), cfg: "" };

async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}

async function boot() {
  let cfg = {};
  try { cfg = await (await fetch("/api/config")).json(); } catch {}
  if (!cfg.url || !cfg.anonKey || !window.supabase) { show("setupView"); return; }
  sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  sb.auth.onAuthStateChange((_ev, s) => {
    const antes = session?.user?.id; session = s;
    if (s && s.user.id !== antes) enterApp(); else if (!s) show("loginView");
  });
  const { data } = await sb.auth.getSession();
  if (!data.session) show("loginView");
}

async function enterApp() {
  show("appView"); $("#whoEmail").textContent = session.user.email || "";
  setSync("wait"); render();
  try {
    const [e, en, c] = await Promise.all([
      sb.from("empresas").select(EMP_COLS),
      sb.from("entregas").select("empresa_id,obrig,comp,entregue_em"),
      sb.from("config").select(CFG_COLS).maybeSingle(),
    ]);
    const err = e.error || en.error || c.error;
    if (err) throw err;
    S.empresas = new Map(e.data.map(r => [r.id, r]));
    S.entregas = new Map(en.data.map(r => [entregaKey(r.empresa_id, r.obrig, r.comp), { entregue_em: r.entregue_em }]));
    const row = c.data || {};
    setConfig(cfgFromRow(c.data));
    fillEnvio({ gmail: row.gmail, senhaSalva: !!row.senha_app, ultimo_envio: row.ultimo_envio,
      telegram: !!row.telegram_chat, telegramBot: row.telegram_bot, telegramNome: row.telegram_nome });
    snapshot(); setSync("ok");
  } catch (err) {
    console.error(err); setSync("err");
    if (/relation|does not exist|column/i.test(err.message || "")) toast("O banco ainda não tem as tabelas. Rode o schema.sql no Supabase (passo 1 do README).");
    else toast("Não foi possível carregar os dados.");
  }
  render();
}
function snapshot() {
  synced = { emp: new Map([...S.empresas].map(([k, v]) => [k, JSON.stringify(v)])), ent: new Set(S.entregas.keys()), cfg: JSON.stringify(cfgToRow(S.config)) };
}
function setConfig(c) { S.config = { ...DEF_CFG, ...c }; S.calc = makeCalc(S.config); }

// Grava só o que mudou desde a última gravação.
let saveTimer = null, saving = Promise.resolve();
function persist(msg) {
  setSync("wait"); render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saving = saving.then(() => sync(msg)); }, 300);
}
async function sync(msg) {
  const uid = session.user.id;
  const up = [...S.empresas.values()].filter(e => synced.emp.get(e.id) !== JSON.stringify(e))
    .map(e => ({ id: e.id, user_id: uid, nome: e.nome, cnpj: e.cnpj || "", regime: e.regime, segmento: e.segmento || "", ie: e.ie || "", obrigs: e.obrigs || [] }));
  const del = [...synced.emp.keys()].filter(id => !S.empresas.has(id));
  const entAdd = [...S.entregas.keys()].filter(k => !synced.ent.has(k)).map(k => {
    const [empresa_id, obrig, comp] = k.split("__"); return { user_id: uid, empresa_id, obrig, comp, entregue_em: S.entregas.get(k).entregue_em };
  }).filter(r => S.empresas.has(r.empresa_id));
  const entDel = [...synced.ent].filter(k => !S.entregas.has(k)).map(k => k.split("__")).filter(([e]) => S.empresas.has(e));
  const cfgRow = cfgToRow(S.config), cfgMudou = JSON.stringify(cfgRow) !== synced.cfg;
  try {
    const chk = r => { if (r.error) throw r.error; };
    if (up.length) chk(await sb.from("empresas").upsert(up));
    if (del.length) chk(await sb.from("empresas").delete().in("id", del));
    if (entAdd.length) chk(await sb.from("entregas").upsert(entAdd));
    for (const [empresa_id, obrig, comp] of entDel) chk(await sb.from("entregas").delete().match({ empresa_id, obrig, comp }));
    if (cfgMudou) chk(await sb.from("config").upsert({ user_id: uid, ...cfgRow }));
    snapshot(); setSync("ok"); if (msg) toast(msg);
  } catch (err) { console.error(err); setSync("err"); toast("Não foi possível salvar. Confira a internet e tente de novo."); }
}
const newId = () => crypto.randomUUID();

function saveEmpresa(e) {
  const id = e.id || newId();
  S.empresas.set(id, { ...(S.empresas.get(id) || {}), id, nome: e.nome, cnpj: e.cnpj, regime: e.regime, segmento: e.segmento, ie: e.ie, obrigs: e.obrigs });
  persist(e.id ? "Empresa atualizada" : "Empresa adicionada");
}
function delEmpresa(id) {
  S.empresas.delete(id);
  for (const k of [...S.entregas.keys()]) if (k.startsWith(id + "__")) { S.entregas.delete(k); synced.ent.delete(k); }
  persist("Empresa excluída");
}
function setEntrega(key, on) {
  if (on) S.entregas.set(key, { entregue_em: iso(today) }); else S.entregas.delete(key);
  persist();
}
function saveConfig(c, msg = "Salvo") { setConfig(c); persist(msg); }

/* ---------- Login ---------- */
const lErr = m => { $("#lErr").textContent = m; $("#lErr").hidden = !m; $("#lOk").hidden = true; };
const lOk = m => { $("#lOk").textContent = m; $("#lOk").hidden = !m; $("#lErr").hidden = true; };
const traduz = e => /Invalid login/i.test(e.message) ? "E-mail ou senha incorretos." :
  /not confirmed/i.test(e.message) ? "Confirme seu e-mail pelo link que enviamos antes de entrar." :
  /already registered/i.test(e.message) ? "Este e-mail já tem conta. Use Entrar." :
  /Signups not allowed/i.test(e.message) ? "Cadastro de novas contas está desativado." : e.message;
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault(); lErr("");
  const { error } = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
  if (error) lErr(traduz(error));
});
$("#lCriar").onclick = async () => {
  const email = $("#lEmail").value.trim(), password = $("#lPass").value;
  if (!email || password.length < 6) { lErr("Informe e-mail e uma senha com pelo menos 6 caracteres."); return; }
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
  if (error) lErr(traduz(error)); else if (!data.session) lOk("Conta criada. Abra o link de confirmação que chegou no seu e-mail.");
};
$("#lReset").onclick = async () => {
  const email = $("#lEmail").value.trim(); if (!email) { lErr("Digite seu e-mail primeiro."); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  error ? lErr(traduz(error)) : lOk("Enviamos um link para criar uma nova senha.");
};
$("#logout").onclick = () => sb.auth.signOut();

function fillEnvio(e) {
  $("#sGmail").value = e.gmail || "";
  $("#sSenha").value = ""; $("#sSenha").placeholder = e.senhaSalva ? "senha salva (digite para trocar)" : "16 letras";
  $("#sStatus").textContent = e.ultimo_envio ? `Último envio automático: ${br(fromIso(e.ultimo_envio))}` : "";
  $("#tgOff").hidden = !!e.telegram; $("#tgOn").hidden = !e.telegram;
  $("#tgInfo").innerHTML = e.telegram ? `ao robô <span class="mono">@${esc(e.telegramBot)}</span>${e.telegramNome ? `, enviando para ${esc(e.telegramNome)}` : ""}` : "";
}

/* ---------- Render: agenda (planilha + calendário) ---------- */
const norm = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function renderAgenda() {
  const C = ctx(), items = itemsFor(C, S.y, S.m);
  const byObrig = Object.fromEntries(items.map(it => [it.o.id, it]));
  $("#mtitle").textContent = `${MESES[S.m]} ${S.y}`;

  // calendário
  const first = new Date(S.y, S.m, 1), start = new Date(first); start.setDate(1 - first.getDay());
  const byDay = {};
  items.forEach(it => { if (it.st === "none" && S.empresas.size) return; (byDay[iso(it.due)] ||= []).push(it); });
  let h = WD.map(w => `<div class="dow">${w[0].toUpperCase()}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== S.m) break;
    const k = iso(d), its = byDay[k] || [], hn = S.calc.holName(d);
    const cls = ["day", d.getMonth() !== S.m ? "out" : "", (d.getDay() === 0 || d.getDay() === 6) ? "wkd" : "", hn ? "hol" : "",
      +d === +today ? "today" : "", its.length ? "has" : "", S.dia === k ? "sel" : ""].join(" ");
    const title = [hn, ...its.map(it => `${it.o.sigla}: ${it.feitos}/${it.rows.length}`)].filter(Boolean).join(" · ");
    h += `<button type="button" class="${cls}" data-day="${k}" ${its.length ? "" : 'tabindex="-1"'} title="${esc(title)}"><span class="n">${d.getDate()}</span>${its.map(it => `<span class="chip st-${it.st}">${esc(it.o.sigla)}</span>`).join("")}</button>`;
  }
  $("#cal").innerHTML = h;
  const lista = items.filter(it => it.rows.length || !S.empresas.size);
  $("#prazosMes").innerHTML = lista.map(it => `<li class="${S.dia === iso(it.due) ? "sel" : ""}" data-day="${iso(it.due)}">
      <span class="d">${brShort(it.due)} ${WD[it.due.getDay()]}</span><span>${esc(it.o.sigla)} <span class="muted small">comp. ${it.compLabel}</span></span>
      <span class="n st-${it.st}">${it.feitos}/${it.rows.length}</span></li>`).join("");
  $("#daySel").innerHTML = S.dia ? `Destacando o dia <span class="mono">${br(fromIso(S.dia))}</span> · <button class="btn sm" id="clearDay">limpar</button>` : "";

  // resumo e alerta
  let tot = 0, ok = 0, late = 0;
  items.forEach(it => { tot += it.rows.length; ok += it.feitos; if (it.due < today) late += it.rows.length - it.feitos; });
  const next = items.find(it => it.due >= today && it.feitos < it.rows.length);
  $("#summary").innerHTML = `
    <div class="stat late"><b>${late}</b><span class="muted">atrasadas</span></div>
    <div class="stat warn"><b>${tot - ok - late}</b><span class="muted">faltam fazer</span></div>
    <div class="stat ok"><b>${ok}</b><span class="muted">entregues de ${tot}</span></div>
    ${next ? `<div class="stat"><span class="muted">Próximo prazo:</span><span class="mono">${esc(next.o.sigla)} · ${brShort(next.due)} (${WD[next.due.getDay()]})</span></div>` : ""}`;
  const pend = pendencias(C), lim = S.config.diasAntes || 0;
  const atras = pend.filter(p => p.n < 0), perto = pend.filter(p => p.n >= 0 && p.n <= lim);
  if (atras.length || perto.length) {
    const txt = atras.length
      ? `<b>${atras.reduce((s, p) => s + p.falta.length, 0)} entrega(s) atrasada(s)</b> em ${atras.map(p => esc(p.o.sigla)).join(", ")}.`
      : `<b>Prazo chegando:</b> ${perto.map(p => `${esc(p.o.sigla)} até ${brShort(p.due)}`).join(", ")}.`;
    $("#banner").innerHTML = `<div class="banner ${atras.length ? "" : "warn"}"><span>${txt}</span><a class="btn sm" href="#avisos">Enviar lembrete</a></div>`;
  } else $("#banner").innerHTML = "";

  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === S.filtro)));
  $("#modoDisp").checked = !!S.disp;
  $("#dica").textContent = S.disp
    ? "Modo ⊘ ligado: clique numa célula para marcar ou desmarcar que a obrigação não se aplica a essa empresa (vale para todos os meses)."
    : "Clique na célula para marcar como entregue. Clique de novo para desfazer.";

  // planilha
  const hlCols = new Set(S.dia ? items.filter(it => iso(it.due) === S.dia).map(it => it.o.id) : []);
  const head = `<thead><tr><th class="emp">Empresa</th><th>CNPJ / CPF</th><th>Tributação</th><th>Segmento</th><th>IE</th>
    ${OBRIGS.map(o => { const it = byObrig[o.id];
      return `<th class="${hlCols.has(o.id) ? "hl" : ""}" title="${esc(o.nome)} · ${esc(ruleText(it.r))}">${esc(o.col)}<span class="due">até ${brShort(it.due)}</span></th>`; }).join("")}</tr></thead>`;
  let emps = C.empresas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const q = norm(S.busca).trim(), qd = q.replace(/\D/g, "");
  if (q) emps = emps.filter(e => norm(e.nome).includes(q) || (qd && String(e.cnpj || "").replace(/\D/g, "").includes(qd)));
  const estado = (e, o) => {
    if (!(e.obrigs || []).includes(o.id)) return "na";
    const it = byObrig[o.id], ent = S.entregas.get(entregaKey(e.id, o.id, it.comp));
    return ent ? "ok" : it.due < today ? "late" : "pend";
  };
  if (S.filtro !== "todas") emps = emps.filter(e => {
    const st = OBRIGS.map(o => estado(e, o)).filter(x => x !== "na");
    const temPend = st.some(x => x === "pend" || x === "late");
    return S.filtro === "pendentes" ? temPend : st.length && !temPend;
  });
  const body = emps.map(e => `<tr>
      <td class="txt emp" title="${esc(e.nome)}">${esc(e.nome)}</td>
      <td class="txt cnpj">${esc(e.cnpj || "")}</td>
      <td class="txt">${esc((REGIMES[e.regime] || "").toUpperCase())}</td>
      <td class="txt">${esc((SEGMENTOS[e.segmento] || "").toUpperCase())}</td>
      <td class="txt cnpj">${esc(e.ie || "")}</td>
      ${OBRIGS.map(o => { const st = estado(e, o), it = byObrig[o.id], key = entregaKey(e.id, o.id, it.comp);
        const ent = S.entregas.get(key);
        const inner = st === "na" ? "⊘" : st === "ok" ? `<b>✓</b>${ent.entregue_em ? brShort(fromIso(ent.entregue_em)) : ""}` : "";
        const tip = st === "na" ? "Não se aplica" : st === "ok" ? "Entregue" : st === "late" ? "Atrasada" : "Falta fazer";
        return `<td class="c ${hlCols.has(o.id) ? "hl" : ""}"><button type="button" class="cell ${st}" data-emp="${esc(e.id)}" data-ob="${o.id}" title="${esc(o.col)} · ${tip}" aria-label="${esc(e.nome)} – ${esc(o.col)}: ${tip}">${inner}</button></td>`;
      }).join("")}
    </tr>`).join("");
  const vazio = !S.empresas.size
    ? `<tr class="vazio"><td colspan="${5 + OBRIGS.length}">Nenhuma empresa cadastrada. <a href="#empresas">Cadastre ou importe sua planilha</a>.</td></tr>`
    : `<tr class="vazio"><td colspan="${5 + OBRIGS.length}">Nenhuma empresa com esse filtro.</td></tr>`;
  $("#grade").innerHTML = head + `<tbody>${body || vazio}</tbody>`;
}

function clicarCelula(empId, obId) {
  const e = S.empresas.get(empId); if (!e) return;
  if (S.disp) {
    const set = new Set(e.obrigs || []);
    set.has(obId) ? set.delete(obId) : set.add(obId);
    S.empresas.set(empId, { ...e, obrigs: OBRIGS.map(o => o.id).filter(id => set.has(id)) });
    persist(); return;
  }
  if (!(e.obrigs || []).includes(obId)) { toast("Não se aplica a esta empresa. Ligue \"Marcar ⊘\" para mudar."); return; }
  const it = itemsFor(ctx(), S.y, S.m).find(x => x.o.id === obId);
  const key = entregaKey(empId, obId, it.comp);
  setEntrega(key, !S.entregas.has(key));
}

/* ---------- Render: empresas ---------- */
function renderEmpresas() {
  const list = [...S.empresas.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  $("#empCount").textContent = `(${list.length})`;
  $("#empRows").innerHTML = list.length ? list.map(e => `<tr>
      <td><div>${esc(e.nome)}</div><div class="mono small muted">${esc(e.cnpj || "")}</div></td>
      <td>${esc(REGIMES[e.regime] || "")}${e.segmento ? `<div class="small muted">${esc(SEGMENTOS[e.segmento] || "")}</div>` : ""}</td>
      <td><div class="tags">${(e.obrigs || []).map(o => OB[o] ? `<span class="tag">${esc(OB[o].sigla)}</span>` : "").join("")}</div></td>
      <td style="white-space:nowrap">${S.delId === e.id
        ? `<span class="small">Excluir?</span> <button class="btn sm danger" data-delok="${esc(e.id)}">Sim</button> <button class="btn sm" data-delno>Não</button>`
        : `<button class="btn sm" data-edit="${esc(e.id)}">Editar</button> <button class="btn sm danger" data-del="${esc(e.id)}">Excluir</button>`}</td>
    </tr>`).join("") : `<tr><td colspan="4" class="muted">Nenhuma empresa ainda. Use o formulário ao lado.</td></tr>`;
}
const fillObsChecks = sel => ($("#eObs").innerHTML = OBRIGS.map(o => `<label><input type="checkbox" value="${o.id}" ${sel.includes(o.id) ? "checked" : ""}> ${esc(o.sigla)}</label>`).join(""));
function resetForm() { S.editId = null; $("#empForm").reset(); $("#empFormTitle").textContent = "Nova empresa"; $("#eSave").textContent = "Adicionar empresa"; $("#eCancel").hidden = true; fillObsChecks(padraoPara("simples")); }

/* ---------- Render: avisos ---------- */
function wppNumber() { let d = (S.config.whatsapp || "").replace(/\D/g, ""); if (d && d.length <= 11) d = "55" + d; return d; }
function renderAvisos() {
  const keep = (sel, v) => { const el = $(sel); if (el !== document.activeElement) el.value = v; };
  keep("#cWpp", S.config.whatsapp || ""); keep("#cMail", S.config.email || ""); keep("#cDias", S.config.diasAntes ?? 3);
  const txt = buildMsg(ctx(), true); $("#msg").textContent = txt;
  const n = wppNumber();
  $("#aWpp").href = `https://wa.me/${n}?text=${encodeURIComponent(txt)}`;
  $("#aMail").href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(S.config.email || "")}&su=${encodeURIComponent("Obrigações pendentes – " + br(today))}&body=${encodeURIComponent(buildMsg(ctx(), false))}`;
  $("#destNote").innerHTML = (n || S.config.email)
    ? `Destino: ${n ? `WhatsApp <span class="mono">+${esc(n)}</span>` : ""}${n && S.config.email ? " e " : ""}${S.config.email ? `e-mail <span class="mono">${esc(S.config.email)}</span>` : ""}`
    : "Salve um número ou e-mail ao lado para receber os avisos.";
}

/* ---------- Render: prazos ---------- */
function renderPrazos() {
  $("#ruleRows").innerHTML = OBRIGS.map(o => {
    const r = S.calc.rule(o.id);
    const ult = r.tipo === "dia"
      ? `dia <input type="number" min="1" max="31" value="${r.dia}" data-rdia="${o.id}" style="width:64px" aria-label="Dia do prazo ${esc(o.sigla)}">`
      : esc(r.tipo === "ultimoUtil" ? "último dia útil" : `${r.n}º dia útil`);
    const aj = r.tipo === "dia"
      ? `<select data-raj="${o.id}" aria-label="Ajuste ${esc(o.sigla)}"><option value="antecipa" ${r.ajuste === "antecipa" ? "selected" : ""}>antecipa</option><option value="prorroga" ${r.ajuste === "prorroga" ? "selected" : ""}>prorroga</option></select>`
      : `<span class="muted">—</span>`;
    return `<tr><td><b>${esc(o.sigla)}</b><div class="small muted">${esc(o.nome)}</div></td><td class="small">${r.meses === 1 ? "mês anterior" : "2 meses antes"}</td><td>${ult}</td><td>${aj}</td></tr>`;
  }).join("");
  $("#holYear").textContent = `(${S.y})`;
  const extras = new Set((S.config.feriados || []).map(f => f.data));
  $("#holRows").innerHTML = Object.entries(S.calc.holidays(S.y)).sort().map(([d, n]) =>
    `<tr><td class="mono">${br(fromIso(d))}</td><td>${WD[fromIso(d).getDay()]}</td><td>${esc(n)}</td><td>${extras.has(d) ? `<button class="btn sm danger" data-hdel="${d}">Remover</button>` : ""}</td></tr>`).join("");
}

/* ---------- Navegação ---------- */
const TABS = ["agenda", "empresas", "avisos", "prazos"];
const tab = () => { const t = (location.hash || "").slice(1); return TABS.includes(t) ? t : "agenda"; };
function render() {
  const t = tab();
  TABS.forEach(x => ($("#v-" + x).hidden = x !== t));
  document.querySelectorAll("nav.tabs a").forEach(a => a.dataset.tab === t ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  renderAgenda(); renderEmpresas(); renderAvisos(); renderPrazos();
}
window.addEventListener("hashchange", render);

/* ---------- Eventos ---------- */
const goMonth = off => { const d = new Date(S.y, S.m + off, 1); S.y = d.getFullYear(); S.m = d.getMonth(); S.dia = null; render(); };
$("#prev").onclick = () => goMonth(-1);
$("#next").onclick = () => goMonth(1);
$("#hoje").onclick = () => { S.y = today.getFullYear(); S.m = today.getMonth(); S.dia = null; render(); };
$("#cal").addEventListener("click", e => { const b = e.target.closest(".day.has"); if (!b) return; S.dia = S.dia === b.dataset.day ? null : b.dataset.day; render(); });
document.querySelector(".seg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.filtro = b.dataset.f; render(); });
$("#busca").addEventListener("input", e => { S.busca = e.target.value; renderAgenda(); });
$("#modoDisp").onchange = e => { S.disp = e.target.checked; renderAgenda(); };
document.addEventListener("click", e => { if (e.target.id === "clearDay") { S.dia = null; render(); } });
$("#grade").addEventListener("click", e => { const b = e.target.closest(".cell"); if (b) clicarCelula(b.dataset.emp, b.dataset.ob); });
$("#prazosMes").addEventListener("click", e => { const li = e.target.closest("li"); if (!li) return; S.dia = S.dia === li.dataset.day ? null : li.dataset.day; render(); });

$("#eReg").onchange = () => { if (!S.editId) fillObsChecks(padraoPara($("#eReg").value, $("#eIe").value)); };
$("#eIe").addEventListener("change", () => { if (!S.editId) fillObsChecks(padraoPara($("#eReg").value, $("#eIe").value)); });
$("#empForm").addEventListener("submit", e => {
  e.preventDefault();
  const nome = $("#eNome").value.trim(); if (!nome) { toast("Informe o nome da empresa"); return; }
  saveEmpresa({ id: S.editId, nome, cnpj: $("#eCnpj").value.trim(), regime: $("#eReg").value, segmento: $("#eSeg").value, ie: $("#eIe").value.trim(),
    obrigs: [...document.querySelectorAll("#eObs input:checked")].map(i => i.value) });
  resetForm();
});
$("#eCancel").onclick = resetForm;
$("#empRows").addEventListener("click", e => {
  const t = e.target;
  if (t.dataset.edit) {
    const emp = S.empresas.get(t.dataset.edit); if (!emp) return; S.editId = emp.id;
    $("#eNome").value = emp.nome; $("#eCnpj").value = emp.cnpj || ""; $("#eReg").value = emp.regime || "simples"; $("#eSeg").value = emp.segmento || ""; $("#eIe").value = emp.ie || ""; fillObsChecks(emp.obrigs || []);
    $("#empFormTitle").textContent = "Editar empresa"; $("#eSave").textContent = "Salvar alterações"; $("#eCancel").hidden = false; $("#eNome").focus();
  }
  if (t.dataset.del) { S.delId = t.dataset.del; renderEmpresas(); }
  if (t.hasAttribute("data-delno")) { S.delId = null; renderEmpresas(); }
  if (t.dataset.delok) { const id = t.dataset.delok; S.delId = null; delEmpresa(id); }
});
$("#eCnpj").addEventListener("input", e => {
  const d = e.target.value.replace(/\D/g, "").slice(0, 14);
  e.target.value = d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
});

$("#cfgForm").addEventListener("submit", e => {
  e.preventDefault();
  saveConfig({ ...S.config, whatsapp: $("#cWpp").value.trim(), email: $("#cMail").value.trim(),
    diasAntes: Math.max(0, Math.min(30, parseInt($("#cDias").value, 10) || 0)) }, "Contatos salvos");
});
$("#testSend").onclick = async () => {
  const out = $("#testResult"); out.textContent = "Enviando…";
  try {
    await saving;
    const j = await api("/api/lembrete?teste=1", {});
    const fmt = v => v === "ok" ? "enviado" : v ? v : "não configurado";
    out.textContent = `Telegram: ${fmt(j.telegram)} · E-mail: ${fmt(j.email)}` + (j.whatsapp ? ` · WhatsApp: ${fmt(j.whatsapp)}` : "");
  } catch (e) { out.textContent = e.message || "Não foi possível falar com o servidor."; }
};
$("#tgForm").addEventListener("submit", async e => {
  e.preventDefault();
  const token = $("#tgToken").value.trim(), msg = $("#tgMsg");
  if (!token) { msg.textContent = "Cole o código que o @BotFather mandou."; return; }
  msg.textContent = "Conectando…";
  try { fillEnvio({ ...(await api("/api/telegram", { token })), gmail: $("#sGmail").value }); $("#tgToken").value = ""; msg.textContent = "Telegram conectado. Uma mensagem de confirmação chegou no seu Telegram."; }
  catch (err) { msg.textContent = err.message; }
});
$("#tgOffBtn").onclick = async () => { try { fillEnvio({ ...(await api("/api/telegram", { desligar: true })), gmail: $("#sGmail").value }); $("#tgMsg").textContent = "Telegram desconectado."; } catch (err) { toast(err.message); } };
$("#envForm").addEventListener("submit", async e => {
  e.preventDefault();
  const row = { user_id: session.user.id, gmail: $("#sGmail").value.trim() };
  const senha = $("#sSenha").value.replace(/\s/g, "");
  if (senha) row.senha_app = senha;
  const { error } = await sb.from("config").upsert(row);
  if (error) { toast("Não foi possível salvar a conta de e-mail."); return; }
  $("#sSenha").value = ""; $("#sSenha").placeholder = (senha || $("#sSenha").placeholder.startsWith("senha salva")) ? "senha salva (digite para trocar)" : "16 letras";
  toast("Conta de e-mail salva");
});
$("#copy").onclick = () => {
  const txt = buildMsg(ctx(), true);
  const fallback = () => { const r = document.createRange(); r.selectNodeContents($("#msg")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Texto selecionado, use Ctrl+C"); };
  try { navigator.clipboard.writeText(txt).then(() => toast("Mensagem copiada"), fallback); } catch { fallback(); }
};
$("#saveRules").onclick = () => {
  const aj = {};
  OBRIGS.filter(o => o.tipo === "dia").forEach(o => {
    const d = parseInt(document.querySelector(`[data-rdia="${o.id}"]`).value, 10), a = document.querySelector(`[data-raj="${o.id}"]`).value;
    if ((d && d !== o.dia) || a !== o.ajuste) aj[o.id] = { dia: d || o.dia, ajuste: a };
  });
  saveConfig({ ...S.config, ajustes: aj }, "Regras salvas");
};
$("#hAdd").onclick = () => {
  const d = $("#hDate").value; if (!d) { toast("Escolha a data do feriado"); return; }
  const f = (S.config.feriados || []).filter(x => x.data !== d); f.push({ data: d, nome: $("#hName").value.trim() || "Feriado local" });
  $("#hDate").value = ""; $("#hName").value = ""; saveConfig({ ...S.config, feriados: f }, "Feriado adicionado");
};
$("#holRows").addEventListener("click", e => { const d = e.target.dataset.hdel; if (d) saveConfig({ ...S.config, feriados: (S.config.feriados || []).filter(x => x.data !== d) }, "Feriado removido"); });

/* ---------- Importar lista ---------- */
function regimeDe(t) {
  const x = (t || "").toLowerCase();
  if (x.includes("presumido")) return "presumido";
  if (/\breal\b/.test(x)) return "real";
  if (x.includes("simples") || x.includes("mei") || x.includes("me/epp")) return "simples";
  return null;
}
function segmentoDe(t) {
  const x = norm(t);
  if (x.includes("ambos")) return "ambos";
  if (x.includes("servic")) return "servico";
  if (x.includes("comerc")) return "comercio";
  if (x.includes("indust")) return "industria";
  return "";
}
const DOC_RE = /(\d{2})\.?(\d{3})\.?(\d{3})\/?(\d{4})-?(\d{2})|(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})/;
function fmtDoc(t) {
  const m = String(t || "").match(DOC_RE); if (!m) return "";
  return m[1] ? `${m[1]}.${m[2]}.${m[3]}/${m[4]}-${m[5]}` : `${m[6]}.${m[7]}.${m[8]}-${m[9]}`;
}
function lerLista(txt) {
  const out = [];
  for (const raw of (txt || "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = raw.split("\t").map(c => c.trim());
    let nome, cnpj = "", regTxt = "", seg = "", ie = "";
    if (cols.length >= 2 && DOC_RE.test(cols[1])) {
      // linhas copiadas da planilha: Empresa | CNPJ/CPF | Tributação | Segmento | IE | ...
      [nome, cnpj, regTxt = "", seg = "", ie = ""] = cols;
      cnpj = fmtDoc(cnpj);
    } else {
      const linha = raw.trim(), m = linha.match(DOC_RE);
      if (m) { nome = linha.slice(0, m.index); regTxt = linha.slice(m.index + m[0].length); cnpj = fmtDoc(m[0]); }
      else { const p = linha.split(/\t|;/); nome = p[0]; regTxt = p.slice(1).join(" "); }
    }
    nome = String(nome || "").replace(/[\t;|]+/g, " ").replace(/\s+/g, " ").trim();
    if (!nome || /^empresa$/i.test(nome)) continue;
    const regime = regimeDe(regTxt) || "simples";
    ie = /^[⊘\-–]+$/.test(ie) ? "" : ie;
    out.push({ nome, cnpj, regime, segmento: segmentoDe(seg), ie, regimeInformado: !!regimeDe(regTxt) });
  }
  return out;
}
function impPreview() {
  const l = lerLista($("#impTxt").value);
  const existentes = new Set([...S.empresas.values()].map(e => (e.cnpj || "").replace(/\D/g, "")).filter(Boolean));
  const novas = l.filter(e => !e.cnpj || !existentes.has(e.cnpj.replace(/\D/g, "")));
  const semReg = l.filter(e => !e.regimeInformado).length;
  $("#impPrev").textContent = l.length
    ? `${novas.length} empresa(s) para importar${l.length - novas.length ? `, ${l.length - novas.length} já cadastrada(s)` : ""}${semReg ? ` · ${semReg} sem regime: vão como Simples Nacional` : ""}.`
    : "";
  return novas;
}
$("#impTxt").addEventListener("input", impPreview);
$("#impForm").addEventListener("submit", e => {
  e.preventDefault();
  const novas = impPreview();
  if (!novas.length) { toast("Nada novo para importar"); return; }
  novas.forEach(n => { const id = newId(); S.empresas.set(id, { id, nome: n.nome, cnpj: n.cnpj, regime: n.regime, segmento: n.segmento, ie: n.ie, obrigs: padraoPara(n.regime, n.ie) }); });
  $("#impTxt").value = ""; $("#impPrev").textContent = "";
  persist(`${novas.length} empresa(s) importada(s)`);
});

fillObsChecks(padraoPara("simples"));
boot();
