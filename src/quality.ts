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

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', deg: '°', euro: '€', pound: '£', shy: '',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', acirc: 'â', ecirc: 'ê', ocirc: 'ô',
  atilde: 'ã', otilde: 'õ', ccedil: 'ç', uuml: 'ü', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  Agrave: 'À', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç', ntilde: 'ñ', Ntilde: 'Ñ',
};
/** Decodifica entidades HTML (nomeadas e numéricas, decimais e hexadecimais). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+[0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}
const TEM_HTML = /<\/?[a-z_][a-z0-9_:]*(\s[^<>]*)?\/?>|&(#x?[0-9a-f]+|[a-z]+);/i;

/** Uma passada: remove blocos inúteis, transforma blocos em quebras de linha, tira as tags e decodifica. */
function passada(html: string, paragrafos: boolean): string {
  let t = html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|figure|figcaption|iframe|noscript|media:[a-z]+)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  if (paragrafos) {
    t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h[1-6]|li|blockquote|div|section|ul|ol|tr)>/gi, '\n\n');
  }
  return decodeEntities(t.replace(/<\/?[a-z_][a-z0-9_:]*(\s[^<>]*)?\/?>/gi, ' '));
}
/**
 * Limpa HTML até não sobrar tag nem entidade. Alguns feeds (ex.: Nexo) escapam o HTML duas vezes:
 * depois de decodificar "&lt;p&gt;" aparece "<p>", que precisa de uma segunda passada.
 */
function limparHtml(html: string, paragrafos: boolean): string {
  let t = html;
  for (let i = 0; i < 4; i++) {
    const antes = t;
    t = passada(t, paragrafos);
    if (t === antes || !TEM_HTML.test(t)) break;
  }
  return t;
}

export function stripHtml(html: string): string {
  return limparHtml(html, false).replace(/\s+/g, ' ').trim();
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

/** HTML → texto em parágrafos (para ler dentro do app). */
export function htmlToParagraphs(html: string): string {
  return limparHtml(html, true)
    .split('\n')
    .map((l) => l.replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Midia = { $?: { url?: string; medium?: string; type?: string; width?: string } } | undefined;

/** Escolhe a imagem de capa: media:content / media:thumbnail / enclosure / primeira <img> do HTML. */
export function pickImage(item: { mediaContent?: Midia[] | Midia; mediaThumbnail?: Midia[] | Midia; enclosure?: { url?: string; type?: string } }, html: string): string | null {
  const lista = (x: Midia[] | Midia) => (Array.isArray(x) ? x : x ? [x] : []);
  const candidatos: string[] = [];
  for (const m of lista(item.mediaContent)) {
    const a = m?.$ ?? {};
    if (a.url && (a.medium === 'image' || /^image\//.test(a.type ?? '') || /\.(jpe?g|png|webp)(\?|$)/i.test(a.url))) candidatos.push(a.url);
  }
  for (const m of lista(item.mediaThumbnail)) if (m?.$?.url) candidatos.push(m.$.url);
  if (item.enclosure?.url && /^image\//.test(item.enclosure.type ?? 'image/')) candidatos.push(item.enclosure.url);
  for (const m of [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].slice(0, 5)) candidatos.push(m[1].replace(/&amp;/g, '&'));
  const boa = candidatos.find((u) => /^https:\/\//.test(u) && !/(pixel|tracking|spacer|1x1|feedburner|gravatar|\.gif(\?|$))/i.test(u));
  return boa ?? null;
}
