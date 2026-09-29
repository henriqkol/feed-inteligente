-- Temas: descrições em PT + EN para o protótipo semântico multilíngue.
-- tau_hours: quanto tempo a notícia "vale". Política ~18h; literatura ~30 dias.
insert into topics (slug, label, description, tau_hours, max_share) values
('ti',           'TI',                          'tecnologia da informação, engenharia de software, programação, arquitetura de sistemas, cloud, DevOps, bancos de dados, segurança da informação, inteligência artificial aplicada / software engineering, programming, cloud infrastructure, cybersecurity, databases, machine learning', 48, 0.30),
('tecnologia',   'Tecnologia',                  'indústria de tecnologia, big techs, gadgets, semicondutores, regulação de tecnologia, internet / tech industry, big tech companies, chips, devices, tech policy', 36, 0.25),
('negocios_tech','Tecnologia nos negócios',     'transformação digital, estratégia de tecnologia nas empresas, startups, produtividade, automação, IA nos negócios / digital transformation, enterprise technology strategy, startups, automation, AI in business', 72, 0.25),
('financas',     'Finanças e investimentos',    'mercado financeiro, juros, inflação, bolsa de valores, renda fixa, câmbio, economia, bancos centrais, investimentos / financial markets, interest rates, inflation, stocks, bonds, central banks, investing', 24, 0.25),
('politica',     'Política',                    'política brasileira, congresso, eleições, governo, políticas públicas, judiciário / politics, elections, government, public policy, legislation', 18, 0.20),
('geopolitica',  'Geopolítica',                 'relações internacionais, conflitos, diplomacia, comércio global, sanções, defesa / international relations, geopolitics, war, diplomacy, global trade, sanctions', 24, 0.25),
('ciencia',      'Ciência',                     'pesquisa científica, física, biologia, medicina, espaço, astronomia, matemática, descobertas / scientific research, physics, biology, medicine, space, mathematics, discoveries', 336, 0.25),
('curiosidades', 'Curiosidades',                'história curiosa, fatos surpreendentes, ideias, filosofia, cultura, lugares incomuns / surprising facts, history, ideas, philosophy, unusual places', 720, 0.15),
('natureza',     'Natureza',                    'meio ambiente, clima, biodiversidade, animais, florestas, oceanos, Amazônia / environment, climate, biodiversity, wildlife, forests, oceans', 240, 0.20),
('social',       'Projetos sociais',            'projetos sociais, impacto social, educação, desigualdade, saúde pública, desenvolvimento, ONGs / social impact, education, inequality, public health, development, nonprofits', 336, 0.15),
('literatura',   'Literatura',                  'livros, escritores, crítica literária, poesia, lançamentos editoriais / books, authors, literary criticism, publishing', 720, 0.15),
('artes',        'Artistas e artes',            'artistas, artes visuais, exposições, museus, cinema, arquitetura, design / artists, visual arts, exhibitions, museums, film, design', 504, 0.15),
('musica',       'Música',                      'música, álbuns, músicos, compositores, crítica musical, história da música / music, albums, musicians, composers, music criticism', 336, 0.15)
on conflict (slug) do nothing;

-- Fontes iniciais. Reputação é uma nota editorial sua: ajuste à vontade.
-- Feeds que falharem 5 vezes seguidas são desativados automaticamente pela coleta.
insert into sources (name, feed_url, default_topic, reputation, longform, lang) values
-- TI e tecnologia
('Ars Technica',            'https://feeds.arstechnica.com/arstechnica/index',            'ti',            0.85, false, 'en'),
('InfoQ',                   'https://feed.infoq.com/',                                     'ti',            0.85, true,  'en'),
('The Register',            'https://www.theregister.com/headlines.atom',                  'ti',            0.75, false, 'en'),
('BBC Technology',          'https://feeds.bbci.co.uk/news/technology/rss.xml',            'tecnologia',    0.85, false, 'en'),
('The Guardian Technology', 'https://www.theguardian.com/technology/rss',                  'tecnologia',    0.85, false, 'en'),
('Wired',                   'https://www.wired.com/feed/rss',                              'tecnologia',    0.80, false, 'en'),
('The Verge',               'https://www.theverge.com/rss/index.xml',                      'tecnologia',    0.75, false, 'en'),
('MIT Technology Review',   'https://www.technologyreview.com/feed/',                      'negocios_tech', 0.90, true,  'en'),
-- Finanças
('BBC Business',            'https://feeds.bbci.co.uk/news/business/rss.xml',              'financas',      0.85, false, 'en'),
('The Economist — Finance', 'https://www.economist.com/finance-and-economics/rss.xml',     'financas',      0.95, true,  'en'),
('Folha — Mercado',         'https://feeds.folha.uol.com.br/mercado/rss091.xml',           'financas',      0.80, false, 'pt'),
('InfoMoney',               'https://www.infomoney.com.br/feed/',                          'financas',      0.70, false, 'pt'),
-- Política e geopolítica
('Agência Brasil',          'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml','politica',     0.80, false, 'pt'),
('Folha — Poder',           'https://feeds.folha.uol.com.br/poder/rss091.xml',             'politica',      0.80, false, 'pt'),
('BBC World',               'https://feeds.bbci.co.uk/news/world/rss.xml',                 'geopolitica',   0.90, false, 'en'),
('The Guardian World',      'https://www.theguardian.com/world/rss',                       'geopolitica',   0.85, false, 'en'),
('The Economist — International','https://www.economist.com/international/rss.xml',        'geopolitica',   0.95, true,  'en'),
('Foreign Policy',          'https://foreignpolicy.com/feed/',                             'geopolitica',   0.85, true,  'en'),
-- Ciência
('Nature',                  'https://www.nature.com/nature.rss',                           'ciencia',       0.95, false, 'en'),
('Quanta Magazine',         'https://www.quantamagazine.org/feed/',                        'ciencia',       0.95, true,  'en'),
('Revista Pesquisa FAPESP', 'https://revistapesquisa.fapesp.br/feed/',                     'ciencia',       0.90, true,  'pt'),
('BBC Science',             'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml','ciencia',      0.85, false, 'en'),
('The Guardian Science',    'https://www.theguardian.com/science/rss',                     'ciencia',       0.85, false, 'en'),
('NASA',                    'https://www.nasa.gov/feed/',                                  'ciencia',       0.90, false, 'en'),
-- Curiosidades
('Aeon',                    'https://aeon.co/feed.rss',                                    'curiosidades',  0.85, true,  'en'),
('Smithsonian Magazine',    'https://www.smithsonianmag.com/rss/latest_articles/',         'curiosidades',  0.85, true,  'en'),
('Atlas Obscura',           'https://www.atlasobscura.com/feeds/latest',                   'curiosidades',  0.75, false, 'en'),
-- Natureza
('Mongabay Brasil',         'https://brasil.mongabay.com/feed/',                           'natureza',      0.80, true,  'pt'),
('The Guardian Environment','https://www.theguardian.com/environment/rss',                 'natureza',      0.85, false, 'en'),
-- Projetos sociais
('The Guardian Global Development','https://www.theguardian.com/global-development/rss',   'social',        0.85, false, 'en'),
-- Literatura, artes, música
('The Guardian Books',      'https://www.theguardian.com/books/rss',                       'literatura',    0.85, false, 'en'),
('The Guardian Art & Design','https://www.theguardian.com/artanddesign/rss',               'artes',         0.85, false, 'en'),
('The Guardian Music',      'https://www.theguardian.com/music/rss',                       'musica',        0.85, false, 'en'),
('NPR Music',               'https://feeds.npr.org/1039/rss.xml',                          'musica',        0.85, false, 'en')
on conflict (feed_url) do nothing;
