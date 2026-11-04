// Entrega ao navegador a URL e a chave pública (anon) do Supabase.
// A chave anon é pública por natureza; os dados ficam protegidos pelas regras (RLS) do schema.sql.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json({ url: process.env.SUPABASE_URL || "", anonKey: process.env.SUPABASE_ANON_KEY || "" });
}
