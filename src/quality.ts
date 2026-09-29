// Filtros de qualidade: clickbait, patrocinado, profundidade.

const CLICKBAIT_PATTERNS: RegExp[] = [
  /você não vai acreditar/i,
  /you won'?t believe/i,
  /\b(chocante|shocking|bombástico|imperdível)\b/i,
  /o que aconteceu (depois|em seguida)/i,
  /what happened next/i,
  /\bveja (como|o que|quem)\b/i,
  /^\d+\s+(coisas|motivos|razões|segredos|things|reasons|ways|secrets)\b/i,
  /(vai|will) (mudar|change) (sua|your) vida/i,
  /this one (weird )?(trick|thing)/i,
  /\b(viraliza|viralizou|goes viral)\b/i,
];

const SPONSORED = /\b(patrocinado|publieditorial|conteúdo de marca|sponsored|paid (post|content)|partner content|advertorial)\b|\[ad\]/i;

/** 0 = título informativo, 1 = clickbait evidente */
export function clickbaitScore(title: string): number {
  let s = 0;
  for (const re of CLICKBAIT_PATTERNS) if (re.test(title)) s += 0.4;
  if (/[!?]{2,}/.test(title)) s += 0.3;
  else if (title.trim().endsWith('?')) s += 0.15;
  const letters = title.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, '').length;
  if (letters.length > 10 && upper / letters.length > 0.5) s += 0.3;
  if (title.trim().length < 25) s += 0.1;
  return Math.min(1, s);
}

export const isSponsored = (title: string, text: string) => SPONSORED.test(title) || SPONSORED.test(text.slice(0, 400));

/** Premia veículos de análise e textos longos (quando o feed traz o conteúdo). */
export function depthScore(words: number, longform: boolean): number {
  return 0.5 * (longform ? 1 : 0) + 0.5 * Math.min(1, words / 1200);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export const wordCount = (text: string) => (text.match(/\S+/g) ?? []).length;

/** Remove parâmetros de rastreamento para a deduplicação por URL funcionar. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|cmpid|CMP)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return raw;
  }
}
