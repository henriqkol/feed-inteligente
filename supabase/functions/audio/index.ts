// Função "audio": recebe os MP3 gerados pelo robô e guarda no bucket público "audios".
//   POST /audio/enviar?nome=123-pt-br-franciscaneural.mp3   (corpo = MP3)
//   POST /audio/limpar   {"manter": ["123-....mp3", ...]}   (apaga da raiz o que não está na lista)
// Autenticação: cabeçalho x-chave = app_segredos.audio_chave (o robô lê do banco; ninguém mais tem).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const BUCKET = "audios";
let chave: string | null = null;

async function autorizado(recebida: string | null): Promise<boolean> {
  if (!recebida) return false;
  if (!chave) {
    const { data } = await sb.from("app_segredos").select("valor").eq("chave", "audio_chave").maybeSingle();
    chave = data?.valor ?? null;
  }
  if (!chave || recebida.length !== chave.length) return false;
  let dif = 0;
  for (let i = 0; i < chave.length; i++) dif |= chave.charCodeAt(i) ^ recebida.charCodeAt(i);
  return dif === 0;
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "use POST" }, 405);
  if (!(await autorizado(req.headers.get("x-chave")))) return json({ erro: "não autorizado" }, 401);
  const url = new URL(req.url);
  const rota = url.pathname.split("/").filter(Boolean).pop();

  if (rota === "enviar") {
    const nome = url.searchParams.get("nome") ?? "";
    if (!/^(amostras\/)?[a-z0-9._-]{3,120}\.mp3$/.test(nome)) return json({ erro: "nome inválido" }, 400);
    const corpo = new Uint8Array(await req.arrayBuffer());
    if (corpo.length < 500 || corpo.length > 20 * 1024 * 1024) return json({ erro: "tamanho inválido" }, 400);
    const { error } = await sb.storage.from(BUCKET).upload(nome, corpo, {
      contentType: "audio/mpeg", upsert: true, cacheControl: "604800",
    });
    if (error) return json({ erro: error.message }, 500);
    return json({ ok: true, nome, bytes: corpo.length });
  }

  if (rota === "limpar") {
    const { manter } = await req.json().catch(() => ({ manter: null }));
    if (!Array.isArray(manter)) return json({ erro: "manter deve ser uma lista" }, 400);
    const ficar = new Set(manter);
    const apagar: string[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await sb.storage.from(BUCKET).list("", { limit: 1000, offset: de });
      if (error) return json({ erro: error.message }, 500);
      for (const o of data) if (o.id && !ficar.has(o.name)) apagar.push(o.name); // pastas (amostras/) têm id nulo
      if (data.length < 1000) break;
    }
    for (let i = 0; i < apagar.length; i += 100) await sb.storage.from(BUCKET).remove(apagar.slice(i, i + 100));
    return json({ ok: true, apagados: apagar.length });
  }

  return json({ erro: "rota desconhecida" }, 404);
});
