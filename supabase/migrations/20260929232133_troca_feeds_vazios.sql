-- WSJ e DW Brasil: os feeds oficiais respondem, mas vieram vazios/parados no teste de 29/09/2026.
-- Saem (nenhum artigo associado) e entram pela busca do Google Notícias restrita ao site.
delete from sources
 where feed_url in ('https://feeds.a.dj.com/rss/RSSWorldNews.xml', 'https://rss.dw.com/rdf/rss-br-all', 'https://rss.dw.com/xml/rss-br-all')
   and not exists (select 1 from articles a where a.source_id = sources.id);

insert into sources (name, feed_url, default_topic, reputation, longform, lang) values
('The Wall Street Journal (via Google Notícias)', 'https://news.google.com/rss/search?q=site:wsj.com+when:1d&hl=en-US&gl=US&ceid=US:en', 'financas', 0.9, false, 'en'),
('DW Brasil (via Google Notícias)', 'https://news.google.com/rss/search?q=site:dw.com/pt-br+when:2d&hl=pt-BR&gl=BR&ceid=BR:pt-419', 'geopolitica', 0.85, false, 'pt')
on conflict (feed_url) do nothing;
