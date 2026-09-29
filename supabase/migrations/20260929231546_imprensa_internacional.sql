-- Grandes veículos internacionais (candidatos testados pela própria coleta em 29/09/2026).
-- Quem não publica RSS público entra pela busca do Google Notícias restrita ao site.
insert into sources (name, feed_url, default_topic, reputation, longform, lang) values
('Associated Press (via Google Notícias)', 'https://news.google.com/rss/search?q=site:apnews.com+when:1d&hl=en-US&gl=US&ceid=US:en', 'geopolitica', 0.9, false, 'en'),
('Bloomberg (via Google Notícias)', 'https://news.google.com/rss/search?q=site:bloomberg.com+when:1d&hl=en-US&gl=US&ceid=US:en', 'financas', 0.9, false, 'en'),
('The New York Times — World', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'geopolitica', 0.95, false, 'en'),
('The Washington Post — World', 'https://feeds.washingtonpost.com/rss/world', 'geopolitica', 0.9, false, 'en'),
('The Wall Street Journal — World', 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', 'financas', 0.9, false, 'en'),
('Financial Times', 'https://www.ft.com/rss/home', 'financas', 0.95, false, 'en'),
('Le Monde (English)', 'https://www.lemonde.fr/en/rss/une.xml', 'geopolitica', 0.9, false, 'en'),
('El País (English)', 'https://feeds.elpais.com/mrss-s/pages/ep/site/english.elpais.com/portada', 'geopolitica', 0.85, false, 'en'),
('Der Spiegel International', 'https://www.spiegel.de/international/index.rss', 'geopolitica', 0.9, true, 'en'),
('CNN World', 'http://rss.cnn.com/rss/edition_world.rss', 'geopolitica', 0.8, false, 'en'),
('France 24', 'https://www.france24.com/en/rss', 'geopolitica', 0.85, false, 'en'),
('RFI Brasil', 'https://www.rfi.fr/br/rss', 'geopolitica', 0.85, false, 'pt'),
('Time', 'https://time.com/feed/', 'geopolitica', 0.8, false, 'en'),
('NHK World (via Google Notícias)', 'https://news.google.com/rss/search?q=site:www3.nhk.or.jp/nhkworld+when:2d&hl=en-US&gl=US&ceid=US:en', 'geopolitica', 0.85, false, 'en'),
('South China Morning Post', 'https://www.scmp.com/rss/91/feed', 'geopolitica', 0.8, false, 'en'),
('The Times of India — World', 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', 'geopolitica', 0.7, false, 'en'),
('DW Brasil (XML)', 'https://rss.dw.com/xml/rss-br-all', 'geopolitica', 0.85, false, 'pt')
on conflict (feed_url) do nothing;
