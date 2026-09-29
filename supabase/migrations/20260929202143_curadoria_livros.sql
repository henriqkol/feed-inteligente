-- Curadoria de livros (feeds verificados em 29/09/2026)
insert into sources (name, feed_url, default_topic, reputation, longform, lang) values
('Quatro Cinco Um', 'https://quatrocincoum.com.br/feed/', 'literatura', 0.9, true, 'pt'),   -- revista de livros, texto completo
('The Marginalian', 'https://www.themarginalian.org/feed/', 'literatura', 0.85, true, 'en'), -- ensaios sobre livros e ideias
('Five Books', 'https://fivebooks.com/feed/', 'literatura', 0.85, false, 'en')              -- especialistas indicam 5 livros sobre um tema
on conflict (feed_url) do nothing;
