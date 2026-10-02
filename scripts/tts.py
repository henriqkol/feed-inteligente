"""Gera áudio com as vozes neurais do Edge TTS (gratuito, sem chave).

  python3 scripts/tts.py vozes                -> JSON com as vozes pt-BR / en-US / en-GB
  python3 scripts/tts.py gerar tarefas.json   -> gera cada {"texto","voz","arquivo"}; imprime JSON com o resultado
"""
import asyncio
import json
import sys

import edge_tts

IDIOMAS = ("pt-BR", "en-US", "en-GB")


async def vozes():
    lista = await edge_tts.list_voices()
    out = [
        {"nome": v["ShortName"], "idioma": v["Locale"], "genero": v.get("Gender", "")}
        for v in lista
        if v["Locale"] in IDIOMAS
    ]
    print(json.dumps(sorted(out, key=lambda v: (v["idioma"], v["nome"]))))


async def gerar_uma(t, sem):
    async with sem:
        for tentativa in range(3):
            try:
                await edge_tts.Communicate(t["texto"], t["voz"]).save(t["arquivo"])
                return {"arquivo": t["arquivo"], "ok": True}
            except Exception as e:  # rede instável: tenta de novo
                erro = f"{type(e).__name__}: {e}"
                await asyncio.sleep(2 * (tentativa + 1))
        return {"arquivo": t["arquivo"], "ok": False, "erro": erro}


async def gerar(caminho):
    tarefas = json.load(open(caminho, encoding="utf-8"))
    sem = asyncio.Semaphore(4)
    res = await asyncio.gather(*(gerar_uma(t, sem) for t in tarefas))
    print(json.dumps(res))


if __name__ == "__main__":
    if sys.argv[1] == "vozes":
        asyncio.run(vozes())
    else:
        asyncio.run(gerar(sys.argv[2]))
