# Agenda de Obrigações – versão online

Site com link seu (ex.: `https://agenda-bmb.vercel.app`), login com e-mail e senha, dados guardados no banco do **Supabase** e lembrete automático pelo **Telegram** e por **e-mail (Gmail)** todo dia útil, mesmo com o computador desligado.

Tudo grátis. São só **2 contas**: Supabase (banco de dados) e Vercel (site). Leva uns 20 minutos, uma vez só.

---

## Passo 1 – Criar o banco de dados (Supabase)

1. Acesse **supabase.com**, clique em **Start your project** e entre com sua conta do GitHub ou com e-mail.
2. Clique em **New project**:
   - **Name:** `agenda`
   - **Database Password:** clique em *Generate a password* (não vai precisar dela depois)
   - **Region:** *South America (São Paulo)*
   - Clique em **Create new project** e espere uns 2 minutos até terminar.
3. No menu da esquerda, clique em **SQL Editor** (ícone `>_`).
4. Abra o arquivo `supabase/schema.sql` desta pasta no Bloco de Notas, copie **tudo**, cole no SQL Editor e clique em **Run** (canto inferior direito).
   Tem que aparecer **Success. No rows returned**. Pronto: as tabelas foram criadas.

## Passo 2 – Copiar as 3 chaves do Supabase

No menu da esquerda, clique na engrenagem **Project Settings**:

| O que copiar | Onde fica | Vai virar |
|---|---|---|
| **Project URL** (`https://xxxx.supabase.co`) | **Data API** (ou **API**) | `SUPABASE_URL` |
| chave **anon public** | **API Keys** → aba **Legacy API keys** | `SUPABASE_ANON_KEY` |
| chave **service_role** (clique em *Reveal*) | **API Keys** → aba **Legacy API keys** | `SUPABASE_SERVICE_ROLE_KEY` |

> As chaves "legacy" começam com `eyJ...`. Se o seu painel mostrar só chaves novas (`sb_publishable_...` e `sb_secret_...`), pode usar essas: a publishable no lugar da anon e a secret no lugar da service_role.
>
> A **service_role / secret** dá acesso total ao banco: só cole ela na Vercel, nunca em outro lugar.

Cole as três num bloco de notas por enquanto.

## Passo 3 – Publicar o site (GitHub + Vercel)

1. Crie uma conta em **github.com**. Clique em **+ → New repository**, nome `agenda-obrigacoes`, marque **Private** e clique em **Create repository**.
2. Na página que abrir, clique em **uploading an existing file**. Arraste **todos os arquivos e pastas desta pasta** (`api`, `lib`, `supabase`, `index.html`, `app.js`, `style.css`, `favicon.svg`, `package.json`, `vercel.json`…) e clique em **Commit changes**.
   Confira se as pastas `api` e `lib` apareceram na lista do repositório.
3. Acesse **vercel.com** → **Sign Up** → **Continue with GitHub**.
4. Clique em **Add New… → Project**, ache `agenda-obrigacoes` e clique em **Import**.
5. **Project Name:** é o nome do seu link. Ex.: `agenda-bmb` → `https://agenda-bmb.vercel.app`.
6. **Framework Preset:** deixe **Other**.
7. Abra **Environment Variables** e cadastre estas 4 (nome à esquerda, valor à direita, clique em **Add** em cada):

   | Nome | Valor |
   |---|---|
   | `SUPABASE_URL` | Project URL do passo 2 |
   | `SUPABASE_ANON_KEY` | chave anon public (ou publishable) |
   | `SUPABASE_SERVICE_ROLE_KEY` | chave service_role (ou secret) |
   | `CRON_SECRET` | invente uma senha longa, ex.: `agenda-bmb-2026-lembrete-diario` |

8. Clique em **Deploy**. Em 1 minuto aparece **Congratulations** e o link do site.

## Passo 4 – Primeiro acesso

1. No Supabase: **Authentication → URL Configuration** → em **Site URL** cole o link da Vercel e clique em **Save**.
2. Abra o seu link, digite e-mail e senha e clique em **Criar conta**.
3. Abra o e-mail de confirmação que chegou e clique no link. Depois entre no site com e-mail e senha.
4. Para ninguém mais criar conta no seu site: Supabase → **Authentication → Sign In / Providers** → desligue **Allow new users to sign up** → **Save**.

## Passo 5 – Usar

- **Empresas → Importar várias empresas:** cole as colunas Empresa, CNPJ/CPF, Tributação, Segmento e IE da sua planilha.
- **Agenda:** clique na célula para marcar entregue. Ligue **Marcar ⊘** para dizer o que não se aplica a cada empresa.
- **Avisos:**
  - **Telegram:** siga os 4 passos do quadro (BotFather → código do robô → Começar → Conectar).
  - **E-mail:** salve seu e-mail em *Para onde enviar* e, em *Envio por e-mail*, o Gmail e a senha de app (gere em myaccount.google.com/apppasswords).
  - Clique em **Enviar teste agora**.

Todo dia útil, entre 8h e 9h (Cuiabá), o site manda o lembrete se houver obrigação atrasada ou vencendo nos próximos dias.

---

## Se der erro

| O que aparece | O que fazer |
|---|---|
| Tela **"Falta configurar"** | As variáveis `SUPABASE_URL` e `SUPABASE_ANON_KEY` não estão na Vercel. Vercel → seu projeto → **Settings → Environment Variables**, cadastre e depois **Deployments → ⋯ → Redeploy**. |
| **"O banco ainda não tem as tabelas"** | Rode o `schema.sql` no SQL Editor (passo 1.4). |
| **404 NOT_FOUND** ao abrir o link | Os arquivos não foram para a raiz do repositório. No GitHub, o `index.html` precisa aparecer direto na lista, não dentro de outra pasta. |
| **"E-mail ou senha incorretos"** logo depois de criar a conta | Falta clicar no link de confirmação do e-mail. |
| Link de confirmação abre **localhost** | Faltou o passo 4.1 (Site URL). |
| Teste diz **"Sessão expirada"** | Clique em **Sair** e entre de novo. |
| Lembrete diário não chega | Confira se `CRON_SECRET` está cadastrada. Vercel → **Settings → Cron Jobs** mostra as execuções e tem botão **Run** para testar. |

Mudou alguma variável na Vercel? Sempre faça **Redeploy** depois.
