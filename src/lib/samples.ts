export const SEED_SQL: string[] = [
  `CREATE TABLE cities (
    city VARCHAR,
    country VARCHAR,
    continent VARCHAR,
    population INTEGER,
    latitude DOUBLE,
    longitude DOUBLE
  )`,
  `INSERT INTO cities VALUES
    ('Tokyo','Japan','Asia',13960000,35.6762,139.6503),
    ('Delhi','India','Asia',16780000,28.6139,77.2090),
    ('Shanghai','China','Asia',24870000,31.2304,121.4737),
    ('Sao Paulo','Brazil','Americas',12330000,-23.5558,-46.6396),
    ('Mexico City','Mexico','Americas',9200000,19.4326,-99.1332),
    ('Cairo','Egypt','Africa',10230000,30.0444,31.2357),
    ('Lagos','Nigeria','Africa',15390000,6.5244,3.3792),
    ('New York','United States','Americas',8336000,40.7128,-74.0060),
    ('London','United Kingdom','Europe',8982000,51.5072,-0.1276),
    ('Paris','France','Europe',2161000,48.8566,2.3522),
    ('Berlin','Germany','Europe',3645000,52.5200,13.4050),
    ('Nairobi','Kenya','Africa',4397000,-1.2921,36.8219),
    ('Sydney','Australia','Oceania',5312000,-33.8688,151.2093),
    ('Istanbul','Turkey','Europe',15840000,41.0082,28.9784),
    ('Singapore','Singapore','Asia',5917000,1.3521,103.8198),
    ('Cape Town','South Africa','Africa',4618000,-33.9249,18.4241),
    ('Los Angeles','United States','Americas',3898000,34.0522,-118.2437),
    ('Toronto','Canada','Americas',2794000,43.6532,-79.3832)`,
  `CREATE TABLE plants (
    name VARCHAR,
    country VARCHAR,
    fuel VARCHAR,
    capacity_mw DOUBLE,
    commissioned INTEGER,
    latitude DOUBLE,
    longitude DOUBLE
  )`,
  `INSERT INTO plants VALUES
    ('Hinkley Point C','United Kingdom','nuclear',3260,2027,51.2085,-3.1333),
    ('Three Gorges','China','hydro',22500,2012,30.8230,111.0030),
    ('Hornsea Two','United Kingdom','wind',1386,2022,53.8900,1.7900),
    ('Ivanpah','United States','solar',392,2014,35.5550,-115.4690),
    ('Jebel Ali','United Arab Emirates','gas',8695,2019,25.0590,55.1160),
    ('Kashiwazaki','Japan','nuclear',7965,1997,37.4280,138.5980),
    ('Itaipu','Brazil','hydro',14000,1984,-25.4080,-54.5890),
    ('Noor','Morocco','solar',580,2018,31.0160,-6.8660),
    ('Neurath','Germany','coal',4400,2012,51.0380,6.6150),
    ('Alta Wind','United States','wind',1548,2011,35.0330,-118.2500),
    ('Medupi','South Africa','coal',4764,2019,-23.7040,27.5620),
    ('Olkiluoto','Finland','nuclear',1600,2023,61.2360,21.4430),
    ('Bhadla','India','solar',2245,2020,27.5390,71.9160),
    ('Guri','Venezuela','hydro',10235,1986,7.7600,-63.0000),
    ('Taean','South Korea','coal',6100,2016,36.9040,126.2350),
    ('Gemini','Netherlands','wind',600,2017,54.0360,5.9630)`,
  `CREATE TABLE tracks (
    title VARCHAR,
    artist VARCHAR,
    genre VARCHAR,
    year INTEGER,
    score INTEGER,
    plays INTEGER
  )`,
  `INSERT INTO tracks VALUES
    ('Copper Wire','Mara Voss','folk',2019,88,2400000),
    ('Night Market','Jun Park','electronic',2021,91,6100000),
    ('Red Ledger','The Kilns','rock',2016,84,1800000),
    ('Paper Boats','Amina Sol','folk',2023,93,4200000),
    ('Glass Elevator','North Station','electronic',2018,79,990000),
    ('Salt Hymn','Inez Mora','jazz',2014,86,760000),
    ('Low Orbit','Kite Division','electronic',2024,90,5300000),
    ('Yard Sale','The Kilns','rock',2020,82,1500000),
    ('Second Press','Mara Voss','folk',2022,87,2100000),
    ('Harbor Math','Jun Park','electronic',2017,85,3400000),
    ('Blue Invoice','Inez Mora','jazz',2021,92,1200000),
    ('Coal Dust','North Station','rock',2015,77,640000),
    ('Window Tax','Amina Sol','folk',2018,89,2800000),
    ('Quiet Grid','Kite Division','electronic',2022,94,7200000)`,
];

const BINDERY_SQL: string[] = [
  `CREATE TABLE books (
    title VARCHAR,
    author VARCHAR,
    year INTEGER,
    language VARCHAR,
    pages INTEGER,
    city VARCHAR,
    latitude DOUBLE,
    longitude DOUBLE
  )`,
  `INSERT INTO books VALUES
    ('The Book of the City of Ladies','Christine de Pizan',1405,'French',280,'Paris',48.8566,2.3522),
    ('Orlando Furioso','Ludovico Ariosto',1532,'Italian',620,'Ferrara',44.8381,11.6198),
    ('Don Quixote','Miguel de Cervantes',1605,'Spanish',860,'Madrid',40.4168,-3.7038),
    ('The Anatomy of Melancholy','Robert Burton',1621,'English',880,'Oxford',51.7520,-1.2577),
    ('Simplicius Simplicissimus','Hans Jakob Christoffel von Grimmelshausen',1668,'German',480,'Strasbourg',48.5734,7.7521),
    ('The Tale of Genji','Murasaki Shikibu',1021,'Japanese',1100,'Kyoto',35.0116,135.7681),
    ('Dream of the Red Chamber','Cao Xueqin',1791,'Chinese',900,'Beijing',39.9042,116.4074),
    ('Pride and Prejudice','Jane Austen',1813,'English',430,'London',51.5072,-0.1276),
    ('Dead Souls','Nikolai Gogol',1842,'Russian',380,'Saint Petersburg',59.9311,30.3609),
    ('Middlemarch','George Eliot',1871,'English',880,'Coventry',52.4068,-1.5197)`,
];

const OBSERVATORY_SQL: string[] = [
  `CREATE TABLE nights (
    site VARCHAR,
    night DATE,
    sky VARCHAR,
    temp_c DOUBLE,
    seeing DOUBLE,
    latitude DOUBLE,
    longitude DOUBLE
  )`,
  `INSERT INTO nights VALUES
    ('Mauna Kea','2024-06-11','photometric',2.1,0.55,19.8207,-155.4681),
    ('Mauna Kea','2024-06-12','thin cloud',3.4,0.90,19.8207,-155.4681),
    ('Paranal','2024-07-02','photometric',11.0,0.70,-24.6272,-70.4042),
    ('Paranal','2024-07-03','wind',9.5,1.20,-24.6272,-70.4042),
    ('La Palma','2024-08-19','photometric',14.2,0.80,28.7606,-17.8792),
    ('La Palma','2024-08-20','calima',16.8,1.40,28.7606,-17.8792),
    ('Siding Spring','2024-09-01','photometric',8.0,1.10,-31.2733,149.0644),
    ('Siding Spring','2024-09-02','cloud',6.4,1.60,-31.2733,149.0644),
    ('Kitt Peak','2024-10-14','photometric',12.5,0.95,31.9633,-111.6000),
    ('Kitt Peak','2024-10-15','clear',10.2,0.85,31.9633,-111.6000)`,
];

const LEDGER_SQL: string[] = [
  `CREATE TABLE entries (
    posted DATE,
    account VARCHAR,
    kind VARCHAR,
    memo VARCHAR,
    amount DOUBLE
  )`,
  `INSERT INTO entries VALUES
    ('2024-01-03','paper','expense','Laid cotton, 100 sheets',-86.00),
    ('2024-01-03','ink','expense','Iron gall, one bottle',-18.50),
    ('2024-01-18','desk','income','Copy of a parish register',240.00),
    ('2024-02-02','desk','expense','Brass rule',-22.00),
    ('2024-02-14','binding','income','Repair of a quarto',160.00),
    ('2024-03-01','paper','expense','Endpapers',-34.00),
    ('2024-03-22','desk','income','Catalogue of a small library',410.00),
    ('2024-04-09','ink','expense','Lamp black',-12.00),
    ('2024-04-30','binding','income','Reback of a ledger',190.00),
    ('2024-05-16','desk','expense','Train to the archive',-48.00),
    ('2024-06-02','desk','income','Notes on a coastline',275.00),
    ('2024-06-20','paper','expense','Blotting paper',-15.00)`,
];

export const SAMPLE_DATABASES: { id: string; name: string; path: string; about: string; sql: string[] }[] = [
  {
    id: "main",
    name: "Carrel",
    path: "opfs://carrel.db",
    about: "Cities, power plants, and tracks.",
    sql: SEED_SQL,
  },
  {
    id: "bindery",
    name: "Bindery",
    path: "opfs://carrel-bindery.db",
    about: "A short shelf of books.",
    sql: BINDERY_SQL,
  },
  {
    id: "observatory",
    name: "Observatory",
    path: "opfs://carrel-observatory.db",
    about: "A few nights of sky.",
    sql: OBSERVATORY_SQL,
  },
  {
    id: "ledger",
    name: "Ledger",
    path: "opfs://carrel-ledger.db",
    about: "A desk account for one half-year.",
    sql: LEDGER_SQL,
  },
];

export const CANNED: { label: string; sql: string }[] = [
  {
    label: "People by continent",
    sql: `SELECT continent, count(*) AS cities, sum(population) AS people
FROM cities
GROUP BY 1
ORDER BY people DESC`,
  },
  {
    label: "Capacity by fuel",
    sql: `SELECT fuel, count(*) AS plants, round(sum(capacity_mw)) AS megawatts
FROM plants
GROUP BY 1
ORDER BY megawatts DESC`,
  },
  {
    label: "Highest scores",
    sql: `SELECT title, artist, genre, year, score
FROM tracks
ORDER BY score DESC, plays DESC
LIMIT 8`,
  },
  {
    label: "Books by language",
    sql: `SELECT language, count(*) AS books, sum(pages) AS pages
FROM books
GROUP BY 1
ORDER BY books DESC`,
  },
  {
    label: "Clearest nights",
    sql: `SELECT site, night, sky, temp_c, seeing
FROM nights
WHERE sky = 'photometric'
ORDER BY seeing`,
  },
  {
    label: "Balance by account",
    sql: `SELECT account, round(sum(amount), 2) AS balance
FROM entries
GROUP BY 1
ORDER BY balance DESC`,
  },
];
