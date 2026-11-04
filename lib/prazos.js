// Lógica de prazos compartilhada entre o site (navegador) e o envio automático (servidor).
// Não depende de DOM nem de Node: só funções puras.

export const pad = n => String(n).padStart(2, "0");
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const br = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
export const brShort = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
export const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const daysBetween = (a, b) => Math.round((b - a) / 86400000);

/** "Hoje" no fuso de Cuiabá (ou outro), como Date local à meia-noite. */
export function todayIn(timeZone = "America/Cuiaba") {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return fromIso(p);
}

// Regras em vigor em nov/2026:
// eSocial dia 15 (antecipa) · Reinf dia 15 (prorroga) · FGTS Digital dia 20 (antecipa) · PIS/COFINS dia 25 (antecipa)
// DAR ICMS MT: dia 10 por padrão (varia por atividade; ajuste na aba Regras)
// PGDAS-D dia 20 (prorroga) · EFD ICMS/IPI MT dia 20 · DCTFWeb/MIT último dia útil (IN RFB 2.248/2025)
// EFD-Contribuições 10º dia útil do 2º mês
export const OBRIGS = [
  { id: "pgdas", col: "Simples Nacional", sigla: "Simples", nome: "Simples Nacional – PGDAS-D / DAS", tipo: "dia", dia: 20, meses: 1, ajuste: "prorroga" },
  { id: "daricms", col: "DAR ICMS", sigla: "DAR ICMS", nome: "DAR ICMS (SEFAZ-MT)", tipo: "dia", dia: 10, meses: 1, ajuste: "antecipa" },
  { id: "darfpis", col: "DARF PIS/COFINS", sigla: "PIS/COFINS", nome: "DARF PIS/COFINS", tipo: "dia", dia: 25, meses: 1, ajuste: "antecipa" },
  { id: "reinf", col: "Reinf", sigla: "Reinf", nome: "EFD-Reinf", tipo: "dia", dia: 15, meses: 1, ajuste: "prorroga" },
  { id: "mit", col: "MIT", sigla: "MIT", nome: "MIT – Módulo de Inclusão de Tributos (DCTFWeb)", tipo: "ultimoUtil", meses: 1 },
  { id: "efdicms", col: "EFD Fiscal", sigla: "EFD Fiscal", nome: "SPED Fiscal – EFD ICMS/IPI (SEFAZ-MT)", tipo: "dia", dia: 20, meses: 1, ajuste: "antecipa" },
  { id: "efdcontrib", col: "EFD Contrib.", sigla: "EFD Contrib.", nome: "SPED Contribuições – EFD PIS/COFINS", tipo: "nUtil", n: 10, meses: 2 },
];
export const OB = Object.fromEntries(OBRIGS.map(o => [o.id, o]));
export const REGIMES = { simples: "Simples Nacional", presumido: "Lucro Presumido", real: "Lucro Real" };
export const SEGMENTOS = { servico: "Serviço", comercio: "Comércio", industria: "Indústria", ambos: "Ambos" };
export const PADRAO = {
  simples: ["pgdas", "reinf"],
  presumido: ["darfpis", "reinf", "mit", "efdcontrib"],
  real: ["darfpis", "reinf", "mit", "efdcontrib"],
};
/** Obrigações padrão pelo regime; com inscrição estadual ativa entram DAR ICMS e EFD Fiscal (exceto Simples). */
export function padraoPara(regime, ie) {
  const base = [...(PADRAO[regime] || PADRAO.simples)];
  if (regime !== "simples" && /\d{5,}/.test(String(ie || ""))) base.push("daricms", "efdicms");
  return OBRIGS.map(o => o.id).filter(id => base.includes(id));
}
export const DEF_CFG = { whatsapp: "", email: "", diasAntes: 3, ajustes: {}, feriados: [] };

/** Converte a linha da tabela config (snake_case) para o formato usado aqui. */
export function cfgFromRow(row) {
  if (!row) return { ...DEF_CFG };
  return {
    whatsapp: row.whatsapp || "", email: row.email || "",
    diasAntes: row.dias_antes ?? 3, ajustes: row.ajustes || {}, feriados: row.feriados || [],
  };
}
export const cfgToRow = c => ({ whatsapp: c.whatsapp, email: c.email, dias_antes: c.diasAntes, ajustes: c.ajustes, feriados: c.feriados });

export const entregaKey = (empId, obrig, comp) => `${empId}__${obrig}__${comp}`;

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mo - 1, da);
}

/** Cria as funções de calendário para uma configuração (feriados extras e ajustes de regra). */
export function makeCalc(config) {
  const cfg = { ...DEF_CFG, ...(config || {}) };
  const cache = {};
  function holidays(y) {
    if (cache[y]) return cache[y];
    const map = {};
    [["01-01", "Confraternização Universal"], ["04-21", "Tiradentes"], ["05-01", "Dia do Trabalho"], ["09-07", "Independência"],
     ["10-12", "Nossa Senhora Aparecida"], ["11-02", "Finados"], ["11-15", "Proclamação da República"],
     ["11-20", "Consciência Negra"], ["12-25", "Natal"]].forEach(([md, n]) => (map[`${y}-${md}`] = n));
    const e = easter(y);
    const add = (off, n) => { const d = new Date(e); d.setDate(d.getDate() + off); map[iso(d)] = n; };
    add(-48, "Carnaval"); add(-47, "Carnaval"); add(-2, "Sexta-feira Santa"); add(60, "Corpus Christi");
    (cfg.feriados || []).forEach(f => { if (f.data && f.data.startsWith(y + "-")) map[f.data] = f.nome || "Feriado"; });
    return (cache[y] = map);
  }
  const holName = d => holidays(d.getFullYear())[iso(d)];
  const isBiz = d => d.getDay() !== 0 && d.getDay() !== 6 && !holName(d);
  const rule = id => ({ ...OB[id], ...((cfg.ajustes || {})[id] || {}) });
  function dueDate(r, y, m) {
    let d;
    if (r.tipo === "dia") {
      d = new Date(y, m, Math.min(r.dia, new Date(y, m + 1, 0).getDate()));
      const step = r.ajuste === "antecipa" ? -1 : 1;
      while (!isBiz(d)) d.setDate(d.getDate() + step);
    } else if (r.tipo === "ultimoUtil") {
      d = new Date(y, m + 1, 0);
      while (!isBiz(d)) d.setDate(d.getDate() - 1);
    } else {
      d = new Date(y, m, 1);
      let c = isBiz(d) ? 1 : 0;
      while (c < r.n) { d.setDate(d.getDate() + 1); if (isBiz(d)) c++; }
    }
    return d;
  }
  return { cfg, holidays, holName, isBiz, rule, dueDate };
}

export function ruleText(r) {
  const mes = r.meses === 1 ? "do mês seguinte" : "do 2º mês seguinte";
  if (r.tipo === "dia") return `dia ${r.dia} ${mes} · ${r.ajuste === "antecipa" ? "antecipa" : "prorroga"} se não for dia útil`;
  if (r.tipo === "ultimoUtil") return `último dia útil ${mes}`;
  return `${r.n}º dia útil ${mes}`;
}

export function countdown(today, due, done) {
  if (done) return { t: "tudo entregue", c: "ok" };
  const n = daysBetween(today, due);
  if (n < 0) return { t: `venceu há ${-n} dia${n === -1 ? "" : "s"}`, c: "late" };
  if (n === 0) return { t: "vence hoje", c: "late" };
  if (n === 1) return { t: "vence amanhã", c: "warn" };
  return { t: `faltam ${n} dias`, c: "warn" };
}

/**
 * Obrigações que vencem no mês de entrega y/m (m de 0 a 11).
 * ctx = { calc, empresas: [{id,nome,cnpj,regime,obrigs}], entregas: Map(key -> {entregue_em}), today }
 */
export function itemsFor(ctx, y, m) {
  const { calc, today } = ctx;
  const emps = [...ctx.empresas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return OBRIGS.map(o => {
    const r = calc.rule(o.id);
    const due = calc.dueDate(r, y, m);
    const c = new Date(y, m - r.meses, 1);
    const comp = `${c.getFullYear()}-${pad(c.getMonth() + 1)}`;
    const rows = emps.filter(e => (e.obrigs || []).includes(o.id)).map(e => {
      const key = entregaKey(e.id, o.id, comp);
      return { emp: e, key, ent: ctx.entregas.get(key) };
    });
    const feitos = rows.filter(x => x.ent).length;
    let st = "warn";
    if (!rows.length) st = "none"; else if (feitos === rows.length) st = "ok"; else if (due < today) st = "late";
    return { o, r, due, comp, compLabel: `${pad(c.getMonth() + 1)}/${c.getFullYear()}`, rows, feitos, st };
  }).sort((a, b) => a.due - b.due || a.o.sigla.localeCompare(b.o.sigla));
}

/** Pendências a partir de hoje: mês anterior (atrasadas), mês atual e o início do próximo dentro do aviso. */
export function pendencias(ctx) {
  const { today, calc } = ctx;
  const lim = Math.max(calc.cfg.diasAntes || 0, 0);
  const out = [];
  [-1, 0, 1].forEach(off => {
    const d = new Date(today.getFullYear(), today.getMonth() + off, 1);
    itemsFor(ctx, d.getFullYear(), d.getMonth()).forEach(it => {
      const falta = it.rows.filter(r => !r.ent);
      if (!falta.length) return;
      const n = daysBetween(today, it.due);
      if (off === 1 && n > lim) return;
      out.push({ ...it, falta, n });
    });
  });
  return out.sort((a, b) => a.due - b.due);
}

/** Texto do lembrete. rich=true usa negrito do WhatsApp (*texto*). */
export function buildMsg(ctx, rich, siteUrl) {
  const { today } = ctx;
  const pend = pendencias(ctx), b = s => (rich ? `*${s}*` : s);
  if (!ctx.empresas.length) return "Cadastre as empresas para gerar o lembrete.";
  if (!pend.length) return `${b("Obrigações em dia")}\nNenhuma entrega pendente até ${br(new Date(today.getFullYear(), today.getMonth() + 1, 0))}.`;
  const lines = [b("Lembrete de obrigações pendentes"), `Atualizado em ${br(today)}`, ""];
  const grp = (t, arr) => {
    if (!arr.length) return;
    lines.push(b(t));
    arr.forEach(p => {
      lines.push(`- ${p.o.nome} · comp. ${p.compLabel}`);
      lines.push(`  Último dia: ${br(p.due)} (${WD[p.due.getDay()]}) – ${countdown(today, p.due, false).t}`);
      lines.push(`  Falta entregar: ${p.falta.map(f => f.emp.nome).join(", ")}`);
    });
    lines.push("");
  };
  grp("ATRASADAS", pend.filter(p => p.n < 0));
  grp("A VENCER", pend.filter(p => p.n >= 0));
  if (siteUrl) lines.push(`Abrir agenda: ${siteUrl}`);
  return lines.join("\n").trim();
}

/** Deve enviar hoje? Só quando há atrasadas ou algo vencendo dentro do prazo de aviso. */
export function precisaAvisar(ctx) {
  const lim = Math.max(ctx.calc.cfg.diasAntes || 0, 0);
  return pendencias(ctx).some(p => p.n <= lim);
}
