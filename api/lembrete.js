// Envio dos lembretes pelo Telegram e por e-mail (Gmail).
// Chamado pela Vercel todo dia útil (vercel.json) e pelo botão "Enviar teste agora" do site.
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { makeCalc, cfgFromRow, entregaKey, buildMsg, precisaAvisar, todayIn, br, iso } from "../lib/prazos.js";

const env = k => (process.env[k] || "").trim();

async function enviarTelegram(row, texto) {
  if (!row.telegram_token) return null;
  if (!row.telegram_chat) return "Telegram ainda não conectado";
  for (let i = 0; i < texto.length || i === 0; i += 3900) {
    const r = await fetch(`https://api.telegram.org/bot${row.telegram_token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: row.telegram_chat, text: texto.slice(i, i + 3900) }),
    }).then(r => r.json()).catch(e => ({ ok: false, description: e.message }));
    if (!r.ok) return `Telegram recusou: ${r.description || "erro desconhecido"}`;
  }
  return "ok";
}

async function enviarEmail(row, assunto, texto) {
  if (!row.email) return null;
  if (!row.gmail || !row.senha_app) return "falta o Gmail e a senha de app";
  try {
    const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: row.gmail, pass: row.senha_app } });
    await t.sendMail({ from: row.gmail, to: row.email, subject: assunto, text: texto });
    return "ok";
  } catch (e) {
    return /Invalid login|BadCredentials|535/i.test(e.message) ? "Gmail recusou o login: confira o e-mail e a senha de app" : `erro no e-mail: ${e.message}`;
  }
}

export default async function handler(req, res) {
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY"))
    return res.status(500).json({ erro: "Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis da Vercel." });
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // Quem chama: o agendador da Vercel (CRON_SECRET) ou um usuário logado (botão de teste).
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const teste = req.query?.teste === "1";
  let soUsuario = null;
  if (!(env("CRON_SECRET") && token === env("CRON_SECRET"))) {
    if (!token || !teste) return res.status(401).json({ erro: "Não autorizado." });
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ erro: "Sessão expirada. Entre de novo no site." });
    soUsuario = data.user.id;
  }

  const hoje = todayIn("America/Cuiaba");
  const siteUrl = env("SITE_URL") || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  let q = admin.from("config").select("*");
  if (soUsuario) q = q.eq("user_id", soUsuario);
  const { data: configs, error } = await q;
  if (error) return res.status(500).json({ erro: error.message });
  if (soUsuario && !(configs[0]?.telegram_chat || configs[0]?.email))
    return res.status(400).json({ erro: "Conecte o Telegram ou salve um e-mail em Para onde enviar primeiro." });

  const resultados = [];
  for (const row of configs) {
    if (!row.telegram_chat && !row.email) continue;
    const calc = makeCalc(cfgFromRow(row));
    if (!teste && (!calc.isBiz(hoje) || row.ultimo_envio === iso(hoje))) continue;
    const [{ data: empresas }, { data: entregas }] = await Promise.all([
      admin.from("empresas").select("*").eq("user_id", row.user_id),
      admin.from("entregas").select("*").eq("user_id", row.user_id),
    ]);
    const ctx = { calc, today: hoje, empresas: empresas || [],
      entregas: new Map((entregas || []).map(e => [entregaKey(e.empresa_id, e.obrig, e.comp), e])) };
    if (!teste && !precisaAvisar(ctx)) continue;
    const texto = buildMsg(ctx, false, siteUrl);
    const r = {
      telegram: await enviarTelegram(row, texto),
      email: await enviarEmail(row, `Obrigações pendentes – ${br(hoje)}`, texto),
    };
    if (!teste && (r.telegram === "ok" || r.email === "ok"))
      await admin.from("config").update({ ultimo_envio: iso(hoje) }).eq("user_id", row.user_id);
    resultados.push(r);
  }
  if (soUsuario) return res.status(200).json(resultados[0] || {});
  return res.status(200).json({ data: iso(hoje), enviados: resultados.length });
}
