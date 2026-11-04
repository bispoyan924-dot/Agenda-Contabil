// Conecta (ou desconecta) o robô do Telegram do usuário logado.
import { createClient } from "@supabase/supabase-js";

const env = k => (process.env[k] || "").trim();

async function tg(token, metodo, params) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params || {}),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: `sem conexão com o Telegram (${e.message})` };
  }
}

export const publico = row => ({
  telegram: !!(row?.telegram_token && row?.telegram_chat),
  telegramBot: row?.telegram_bot || "", telegramNome: row?.telegram_nome || "",
  senhaSalva: !!row?.senha_app, ultimo_envio: row?.ultimo_envio || "",
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });
  if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY"))
    return res.status(500).json({ erro: "Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis da Vercel." });
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const jwt = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = jwt ? await admin.auth.getUser(jwt) : { data: null, error: true };
  if (ue || !u?.user) return res.status(401).json({ erro: "Sessão expirada. Entre de novo no site." });
  const uid = u.user.id;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

  if (body.desligar) {
    const { data, error } = await admin.from("config")
      .upsert({ user_id: uid, telegram_token: null, telegram_chat: null, telegram_bot: null, telegram_nome: null }).select().single();
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json(publico(data));
  }

  const token = String(body.token || "").trim();
  const eu = await tg(token, "getMe");
  if (!eu.ok) return res.status(400).json({ erro: "Código do robô inválido. Copie de novo a mensagem do @BotFather (o trecho com dois-pontos)." });
  const up = await tg(token, "getUpdates", { limit: 100 });
  const chats = (up.result || []).map(x => x.message?.chat).filter(c => c && c.type === "private");
  if (!chats.length)
    return res.status(400).json({ erro: `Abra o seu robô @${eu.result.username} no Telegram, toque em Começar (ou mande /start) e clique em Conectar de novo.` });
  const chat = chats[chats.length - 1];
  await tg(token, "sendMessage", { chat_id: chat.id, text: "Pronto! A Agenda de Obrigações vai mandar os lembretes aqui." });
  const { data, error } = await admin.from("config").upsert({
    user_id: uid, telegram_token: token, telegram_chat: String(chat.id),
    telegram_bot: eu.result.username || "", telegram_nome: chat.first_name || chat.username || "",
  }).select().single();
  if (error) return res.status(500).json({ erro: error.message });
  return res.status(200).json(publico(data));
}
