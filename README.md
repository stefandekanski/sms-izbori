# SMS Izbori

Web stranica za kontrolore na biračkom mestu: jednom upišeš broj biračkog mesta, svoje ime i broj koordinatora, a posle svako javljanje (broj upisanih, izlaznost, glasanje van BM, rezultati) ide jednim dodirom. Dugme otvara aplikaciju za poruke sa gotovim tekstom, a ti samo pritisneš Pošalji.

Instalira se pravo iz pretraživača, bez prodavnice aplikacija, i ništa ne šalje na internet: sve što upišeš ostaje na tvom telefonu. Posle prvog otvaranja radi i bez interneta.

## Za razvoj

Običan statički sajt, bez build koraka: `index.html`, moduli u `src/`, Preact sa htm u `vendor/`. Testovi logike: `deno run --allow-read test/run.js`.

Projekat je napravljen uz pomoć AI alata: Claude Opus 5.5 i Gemini 3.8 Flash.
