-- Inovação Tecnológica: notícias de ciência e tecnologia em português (RSS oficial, testado em 05/10/2026).
insert into sources (name, feed_url, default_topic, reputation, longform, lang) values
('Inovação Tecnológica', 'https://www.inovacaotecnologica.com.br/boletim/rss.xml', 'tecnologia', 0.8, false, 'pt')
on conflict (feed_url) do nothing;
