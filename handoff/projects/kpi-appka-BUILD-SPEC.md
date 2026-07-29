# Aura KPI — BUILD-SPEC

> Technická špecifikácia pre sprint agentov. Zdroj rozhodnutí: `KONTRAKT-rozhodnutia.md`.
> Vzor stacku 1:1 = `C:\Aura\aura-logistika`. Cieľ: funkčné MVP v Dockeri na porte 3030.

---

## 1. Architektúra (prevzatá z aura-logistika)

Node 20 + Express 4 (CommonJS) + mysql2/promise (MariaDB 11.4) + bcryptjs + jsonwebtoken + cookie-parser + exceljs + **nodemailer** (nové, pre SMTP). Frontend vanilla JS SPA (žiadny build), inline SVG grafy. Docker: `app` + `mariadb` + voliteľný `ngrok` (profil tunnel) + external siete na integrácie.

**Prevziať z Logistiky takmer 1:1** (skopírovať a upraviť názvy): `server/src/{db,auth,crypto,audit,util}.js`, `index.js` (bootstrap poradie), `seed.js` (štruktúra), `public/{index.html,app.js,styles.css}` (jadro `window.APP` + `window.VIEWS` + router + grafy `renderLineChart/donutChart/renderStackedBar` + kit), `Dockerfile`, `docker-compose.yml`, `.env.example`. **Nekopírovať** doménové: `isoweek.js` (nepotrebné — pracujeme s kalendárnym mesiacom, nie ISO týždňom), `routes/shipments.js`, `routes/claims.js`, `views/shipments.js`, `views/claims.js`.

**Konvencie (dodržať z Logistiky):**
- Cookie `aura_kpi_token`, JWT 12h, roly rank `{viewer:1, editor:2, admin:3}`.
- `q(sql,params)` / `one(sql,params)`, pool `dateStrings:true`, `charset:utf8mb4`.
- Handlery obalené `ah(...)`; chyby `res.status(4xx).json({error})`; úspech `{ok:true}`/`{id}`/dáta.
- `attachUser` → `requireAuth` → `requireRole('editor'|'admin')`; `AUTH_DISABLED` prepínač.
- `audit(req, action, entity, entityId, detail)` pri každej zmene.
- Server agreguje a posiela **hotové `series`/`totals`**; frontend len kreslí.
- Statika `no-store`, SPA fallback `GET *` → index.html.

**Pridané oproti Logistike:** rola-viazané oddelenia (M:N), server-side KPI compute engine, integračné adaptéry (read-only cez external docker siete), SMTP pripomienky, SK/EN i18n, config-driven KPI definície.

## 2. Dátový model (schema.sql)

**Prevziať 1:1:** `settings`, `users` (+ pridať nič), `audit_log` — presne ako Logistika.

**Nové tabuľky:**

```sql
-- Oddelenia (číselník, seedované z kpi-config)
CREATE TABLE departments (
  `key`          VARCHAR(40) PRIMARY KEY,       -- 'performance','hospodarsky',...
  name_sk        VARCHAR(120) NOT NULL,
  name_en        VARCHAR(120) NOT NULL,
  sort           INT NOT NULL DEFAULT 0,
  active         TINYINT(1) NOT NULL DEFAULT 1,
  in_team_score  TINYINT(1) NOT NULL DEFAULT 0, -- vstupuje do Team score
  team_component VARCHAR(40) NULL,              -- kľúč zložky Team score (napr. 'ebitda')
  visibility     ENUM('all','admin') NOT NULL DEFAULT 'all', -- 'admin' = len Admin+Prehliadač
  color          VARCHAR(16) NULL,
  source         ENUM('manual','seo','logistika') NOT NULL DEFAULT 'manual',
  cadence        ENUM('month','quarter') NOT NULL DEFAULT 'month'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- KPI metriky (definícia, seedované z kpi-config)
CREATE TABLE metrics (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  department_key VARCHAR(40) NOT NULL,
  `key`          VARCHAR(60) NOT NULL,          -- 'marza','roas','trzba',...
  name_sk        VARCHAR(160) NOT NULL,
  name_en        VARCHAR(160) NOT NULL,
  unit           ENUM('pct','eur','int','ratio','x') NOT NULL DEFAULT 'int',
  calc_type      ENUM('band','ratio','tolerance','yoy','weighted','info','derived') NOT NULL,
  weight         DECIMAL(4,3) NULL,             -- váha v oddelení (Copywriter 0.6/0.2/0.2)
  in_department_plnenie TINYINT(1) NOT NULL DEFAULT 1,
  config_json    TEXT NULL,                     -- doplnkové parametre (tolerancia, deľovateľ, sub-metriky...)
  sort           INT NOT NULL DEFAULT 0,
  active         TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_metric (department_key, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Vstupné polia metriky (pre generický formulár + modul Na doplnenie)
CREATE TABLE metric_inputs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  metric_id  INT NOT NULL,
  `key`      VARCHAR(60) NOT NULL,              -- 'marza_objednavok','naklad','tento_rok',...
  label_sk   VARCHAR(160) NOT NULL,
  label_en   VARCHAR(160) NOT NULL,
  kind       ENUM('int','eur','pct','ratio','dec') NOT NULL DEFAULT 'int',
  required   TINYINT(1) NOT NULL DEFAULT 1,     -- vstupuje do "je riadok kompletný?"
  sort       INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_mi_metric FOREIGN KEY (metric_id) REFERENCES metrics(id) ON DELETE CASCADE,
  UNIQUE KEY uq_mi (metric_id, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Zadané mesačné hodnoty (JADRO) — 1 riadok = vstupné pole × mesiac
CREATE TABLE period_values (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  department_key VARCHAR(40) NOT NULL,
  metric_key     VARCHAR(60) NOT NULL,
  input_key      VARCHAR(60) NOT NULL,
  year           SMALLINT NOT NULL,
  month          TINYINT NOT NULL,             -- 1..12 (kvartálne: 3,6,9,12)
  value          DECIMAL(16,4) NULL,
  is_preliminary TINYINT(1) NOT NULL DEFAULT 0,-- Hospodársky predbežné/finálne
  updated_by     INT NULL,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pv (department_key, metric_key, input_key, year, month),
  INDEX idx_pv_period (year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pásma/plány (verzované per metrika per mesiac)
CREATE TABLE metric_targets (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  metric_key VARCHAR(60) NOT NULL,
  year       SMALLINT NOT NULL,
  month      TINYINT NOT NULL,
  min_val    DECIMAL(16,4) NULL,
  max_val    DECIMAL(16,4) NULL,
  plan_val   DECIMAL(16,4) NULL,
  UNIQUE KEY uq_mt (metric_key, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Vypočítané výsledky (server-side, uložené kvôli rýchlosti + histórii)
CREATE TABLE metric_results (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  department_key VARCHAR(40) NOT NULL,
  metric_key     VARCHAR(60) NOT NULL,
  year           SMALLINT NOT NULL,
  month          TINYINT NOT NULL,
  value          DECIMAL(16,4) NULL,          -- výsledná hodnota metriky (napr. EBITDA marža %)
  plnenie        DECIMAL(8,4) NULL,           -- 0..1 (môže byť záporné)
  mom_pct        DECIMAL(10,4) NULL,
  vs_target_pct  DECIMAL(10,4) NULL,
  complete       TINYINT(1) NOT NULL DEFAULT 0,
  computed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mr (department_key, metric_key, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE dept_plnenie (           -- plnenie oddelenia za mesiac (agregát metrík)
  department_key VARCHAR(40) NOT NULL,
  year SMALLINT NOT NULL, month TINYINT NOT NULL,
  plnenie DECIMAL(8,4) NULL, complete TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (department_key, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE team_score (
  year SMALLINT NOT NULL, month TINYINT NOT NULL,
  value DECIMAL(8,4) NULL, components_json TEXT NULL, n_components TINYINT NULL,
  PRIMARY KEY (year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE month_status (
  year SMALLINT NOT NULL, month TINYINT NOT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  deadline DATE NULL, closed_by INT NULL, closed_at DATETIME NULL,
  PRIMARY KEY (year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE month_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  department_key VARCHAR(40) NOT NULL, year SMALLINT NOT NULL, month TINYINT NOT NULL,
  comment TEXT NULL, author_id INT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mc (department_key, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE year_refs (              -- referenčné hodnoty min. roka (tržby 2025, COGS 2025)
  metric_key VARCHAR(60) NOT NULL, year SMALLINT NOT NULL, month TINYINT NOT NULL,
  value DECIMAL(16,4) NULL,
  PRIMARY KEY (metric_key, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Prístup Editorov k oddeleniam (M:N)
CREATE TABLE user_departments (
  user_id INT NOT NULL, department_key VARCHAR(40) NOT NULL,
  PRIMARY KEY (user_id, department_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Univerzálny modul Projekty (kvartálne, informatívne)
CREATE TABLE projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  department_key VARCHAR(40) NOT NULL, year SMALLINT NOT NULL, quarter TINYINT NOT NULL,
  name VARCHAR(200) NOT NULL, status ENUM('open','closed') NOT NULL DEFAULT 'open',
  expected_change VARCHAR(400) NULL, note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Denník skladu → agreguje do Sklad metrík
CREATE TABLE stock_journal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  year SMALLINT NOT NULL, month TINYINT NOT NULL,
  metal ENUM('zlato','striebro_ine') NOT NULL,
  kind VARCHAR(80) NULL,                        -- druh (číselník stock_kinds, voľné)
  movement ENUM('vyzbierane','priskladnene') NOT NULL,
  qty INT NULL, eur DECIMAL(14,2) NULL, note VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sj (year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE stock_kinds ( id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, sort INT DEFAULT 0, active TINYINT DEFAULT 1 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Externistky: číselník + detail úloh + SLA
CREATE TABLE externists ( id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(160) NOT NULL, sort INT DEFAULT 0, active TINYINT DEFAULT 1 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE externist_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY, externist_id INT NOT NULL,
  year SMALLINT NOT NULL, month TINYINT NOT NULL, plan INT NULL, done INT NULL,
  UNIQUE KEY uq_et (externist_id, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE externist_sla (
  year SMALLINT NOT NULL, month TINYINT NOT NULL,
  first_response DECIMAL(8,2) NULL, first_target DECIMAL(8,2) NULL,
  avg_response DECIMAL(8,2) NULL,  resp_target DECIMAL(8,2) NULL,
  avg_resolution DECIMAL(8,2) NULL, resol_target DECIMAL(8,2) NULL,
  PRIMARY KEY (year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Integračný cache (auto-pull SEO/Logistika + manual override)
CREATE TABLE integration_values (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source ENUM('seo','logistika') NOT NULL,
  metric_key VARCHAR(60) NOT NULL, input_key VARCHAR(60) NOT NULL,
  year SMALLINT NOT NULL, month TINYINT NOT NULL,
  auto_value DECIMAL(16,4) NULL, pulled_at DATETIME NULL,
  override_value DECIMAL(16,4) NULL, override_by INT NULL, override_at DATETIME NULL,
  UNIQUE KEY uq_iv (source, metric_key, input_key, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SEO porada modul (72 otázok)
CREATE TABLE seo_meetings (
  id INT AUTO_INCREMENT PRIMARY KEY, year SMALLINT NOT NULL, month TINYINT NOT NULL,
  period_label VARCHAR(60) NULL, compare_label VARCHAR(60) NULL,
  status ENUM('priprava','porada','zaver','done') NOT NULL DEFAULT 'priprava',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sm (year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE seo_meeting_answers (
  id INT AUTO_INCREMENT PRIMARY KEY, meeting_id INT NOT NULL,
  q_no INT NOT NULL, section VARCHAR(120) NULL, question VARCHAR(500) NOT NULL,
  answer TEXT NULL, note VARCHAR(500) NULL, link TEXT NULL,
  on_agenda TINYINT(1) DEFAULT 0, is_action TINYINT(1) DEFAULT 0,
  assignee VARCHAR(120) NULL, prep_status VARCHAR(40) NULL,
  UNIQUE KEY uq_sma (meeting_id, q_no),
  CONSTRAINT fk_sma FOREIGN KEY (meeting_id) REFERENCES seo_meetings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE seo_meeting_actions (
  id INT AUTO_INCREMENT PRIMARY KEY, meeting_id INT NOT NULL,
  text VARCHAR(500) NOT NULL, assignee VARCHAR(120) NULL, due DATE NULL,
  status ENUM('open','done') DEFAULT 'open',
  CONSTRAINT fk_smact FOREIGN KEY (meeting_id) REFERENCES seo_meetings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> **Šperky-Admin-Evidencia** tabuľky sa doplnia po dodaní súboru (P0-1) — agent nechá pripravený prázdny modul + placeholder route/view.

## 3. `server/src/kpi-config.js` — SRDCE (encoduje metodiku excelov)

Exportuje pole oddelení s metrikami, vstupmi, calc_type, váhami a default pásmami. `seed.js` z neho naplní `departments`, `metrics`, `metric_inputs` (INSERT ... ON DUPLICATE KEY UPDATE — pri štarte vždy re-sync definícií, dáta ostávajú). Skrátený tvar (agent doplní všetkých 13):

```js
module.exports = [
  { key:'performance', name_sk:'Performance', name_en:'Performance', in_team_score:1, team_component:'performance', source:'manual', metrics:[
    { key:'marza', name_sk:'Marža %', unit:'pct', calc_type:'band', weight:null, inputs:[{key:'marza',label_sk:'Marža % (Y/Y)',kind:'pct'}] },
    { key:'roas', name_sk:'ROAS (očistený)', unit:'x', calc_type:'band', inputs:[{key:'roas',label_sk:'ROAS',kind:'dec'}],
      config:{ tooltip:'ROAS = tržba s DPH × 0,86 (−12% storná −2% bonita) ÷ náklad na reklamu' } },
    { key:'trzba', name_sk:'Tržba (medziročný rast)', unit:'pct', calc_type:'yoy',
      inputs:[{key:'tento_rok',label_sk:'Tržba tento rok €',kind:'eur'}],
      config:{ ref_metric:'trzba', ref_input:'minuly_rok', band_min:0.10, band_max:0.25 } } ]},
  { key:'hospodarsky', name_sk:'Hospodársky', in_team_score:1, team_component:'ebitda', visibility:'admin', source:'manual', metrics:[
    { key:'ebitda', name_sk:'EBITDA marža %', unit:'pct', calc_type:'band',
      inputs:[{key:'marza_objednavok',label_sk:'Marža objednávok €',kind:'eur'},{key:'naklad',label_sk:'Náklad spoločnosti €',kind:'eur'}],
      config:{ derive:'ebitda_pct', band_min:0.01, band_max:0.05, preliminary:true } } ]},
  { key:'newsletter', name_sk:'Newsletter-AI', in_team_score:1, team_component:'newsletter', source:'manual', metrics:[
    { key:'plnenie', name_sk:'Plnenie Newsletter', unit:'pct', calc_type:'derived',
      inputs:[{key:'kupony',label_sk:'Tržba kupóny € (bez DPH)',kind:'eur'},{key:'admin',label_sk:'Admin € (bez DPH)',kind:'eur'},
              {key:'marza',label_sk:'Marža %',kind:'pct'},{key:'atrib',label_sk:'Atribuovaná €',kind:'eur',required:0},{key:'mailchimp',label_sk:'Mailchimp €',kind:'eur',required:0}],
      config:{ formula:'newsletter', plan:0.243, marza_lo:45, marza_hi:55, tol_ok:0.05, tol_max:0.10 } } ]},
  { key:'copywriter', name_sk:'Copywriter', in_team_score:1, team_component:'copywriter', source:'seo', metrics:[
    { key:'top100', name_sk:'TOP 100 v TOP 3', unit:'pct', calc_type:'band', weight:0.6,
      inputs:[{key:'in_top3',label_sk:'Počet zo 100 KW v TOP 3',kind:'int'}], config:{ band_min:0.20, band_max:0.40, of:100, seo:'top100_top3' } },
    { key:'hustota', name_sk:'Hustota KW', unit:'int', calc_type:'derived', weight:0.2,
      inputs:[{key:'kw_1_3',label_sk:'KW 1–3',kind:'int'},{key:'kw_4_10',label_sk:'KW 4–10',kind:'int'}],
      config:{ formula:'hustota', b1_min:150,b1_max:250, b2_min:300,b2_max:500, seo:'density' } },
    { key:'ctr', name_sk:'CTR %', unit:'pct', calc_type:'band', weight:0.2,
      inputs:[{key:'ctr',label_sk:'CTR %',kind:'pct'}], config:{ band_min:0.01, band_max:0.02, seo:'ctr' } },
    { key:'blogy', name_sk:'Blogy (info)', unit:'int', calc_type:'info', in_department_plnenie:0,
      inputs:[{key:'vytvorene',label_sk:'Vytvorené',kind:'int'},{key:'planovane',label_sk:'Plánované',kind:'int'}] } ]},
  { key:'fotografka', name_sk:'Fotografka', in_team_score:1, team_component:'fotografka', source:'manual', metrics:[
    { key:'plnenie', name_sk:'% plnenia (zavreté ÷ otvorené)', unit:'pct', calc_type:'ratio',
      inputs:[{key:'zavrete',label_sk:'Zavreté (odovzdané)',kind:'int'},{key:'otvorene',label_sk:'Otvorené (na fotení)',kind:'int'}],
      config:{ ratio:'zavrete/otvorene' } } /* + nepovinný detail: pocet_fotiek, z_toho_* */ ]},
  { key:'nahravanie', name_sk:'Nahrávanie', in_team_score:1, team_component:'nahravanie', source:'manual', metrics:[
    { key:'plnenie', name_sk:'% plnenia (uverejnené ÷ otvorené)', unit:'pct', calc_type:'ratio',
      inputs:[{key:'novinky',label_sk:'Novinky',kind:'int',required:0},{key:'dofocovanie',label_sk:'Dofocovanie',kind:'int',required:0},
              {key:'otvorene',label_sk:'Otvorené',kind:'int'},{key:'uverejnene',label_sk:'Uverejnené',kind:'int'}],
      config:{ ratio:'uverejnene/otvorene' } } ]},
  { key:'externistky', name_sk:'Externistky', in_team_score:0, source:'manual', metrics:[ /* úlohy z externist_tasks agregát, SLA z externist_sla */ ]},
  { key:'import', name_sk:'Import', in_team_score:0, source:'manual', metrics:[
    { key:'cogs', name_sk:'COGS vs vyplatené', unit:'eur', calc_type:'tolerance',
      inputs:[{key:'cogs',label_sk:'COGS €',kind:'eur'},{key:'vyplatene',label_sk:'Vyplatené €',kind:'eur'},{key:'cogs_min_rok',label_sk:'COGS minulý rok €',kind:'eur'},{key:'predikcia',label_sk:'Predikcia COGS €',kind:'eur',required:0}],
      config:{ tolerance_pct:0.05, tolerance_of:'cogs_min_rok' } }
    /* + info polia: KO uhradené/otvorené, FA uhradené/otvorené, tovar na ceste/colnica/sklad */ ]},
  { key:'sklad', name_sk:'Sklad', in_team_score:0, source:'manual', metrics:[ /* agregát z stock_journal, info */ ]},
  { key:'expedicia', name_sk:'Expedícia', in_team_score:0, source:'logistika', metrics:[
    { key:'plnenie', name_sk:'% plnenia (spracované ÷ prijaté)', unit:'pct', calc_type:'ratio',
      inputs:[{key:'prijate',label_sk:'Balíky prijaté',kind:'int'},{key:'spracovane',label_sk:'Spracované',kind:'int'}],
      config:{ ratio:'spracovane/prijate', logistika:{ prijate:'sent', spracovane:'delivered' } } } ]},  // P0-2
  { key:'reklamacie', name_sk:'Reklamácie', in_team_score:0, source:'logistika', metrics:[
    { key:'plnenie', name_sk:'% plnenia (zavreté ÷ otvorené)', unit:'pct', calc_type:'ratio',
      inputs:[{key:'otvorene',label_sk:'Otvorené',kind:'int'},{key:'zavrete',label_sk:'Zavreté',kind:'int'}],
      config:{ ratio:'zavrete/otvorene', logistika:{ otvorene:'claims_opened', zavrete:'claims_closed' } } } ]},
  { key:'appai', name_sk:'AppAI', in_team_score:0, cadence:'quarter', source:'manual', metrics:[ /* projekty/appky, % done, info */ ]},
];
```

## 4. Compute engine (`server/src/compute.js`)

Čistá funkcia `computeMetric(metric, inputs, target, refs)` → `{ value, plnenie, complete }`. Volá sa po každom zápise (`recomputePeriod(year,month)`), výsledky sa uložia do `metric_results`, `dept_plnenie`, `team_score`.

- **band:** `value = input`; `plnenie = clamp((value−min)/(max−min), ≤1)`; complete ak input aj min/max.
- **ratio:** `value = a/b` (cap 1 na plnenie); complete ak a aj b.
- **yoy:** `rast = tento/ref − 1`; `plnenie = min((rast−min)/(max−min),1)`; ref z `year_refs`.
- **tolerance:** `plnenie = |a−b| ≤ tol×ref ? 1 : 0`.
- **derived/ebitda_pct:** `value = (marza_objednavok−naklad)/marza_objednavok`; band 1–5 %.
- **derived/newsletter:** `pomer = kupony/admin`; `plnenie = min(0.6×(pomer/plan) + 0.4×(marza∈[45,55]?1:0), 1)`; odchýlka badge = `(atrib+mailchimp)/kupony − 1` → OK/Pozor/Nesedí.
- **derived/hustota:** `p1 = clamp((kw_1_3−150)/(250−150)); p2 = clamp((kw_4_10−300)/(500−300)); plnenie = avg(p1,p2)`.
- **weighted (department plnenie):** `Σ(weight×plnenie)/Σ(weight dostupných)` — prepočet váh na dostupné (Copywriter).
- **info:** bez plnenia.
- **Team score:** priemer `dept_plnenie` zložiek s `in_team_score=1`, floor 0, vynechať prázdne, uložiť `n_components`.
- **Odvodené:** `mom_pct` (vs predošlý mesiac), `vs_target_pct`, YTD (súčet/priemer), best/worst mesiac — počítané pri čítaní dashboardu/analýzy.

## 5. Integračné adaptéry (`server/src/integrations/`)

- `logistika.js` — pool na `aura_logistika` (host `mariadb` v sieti `aura-logistika`, alebo env `LOGISTIKA_DB_*`). Funkcia `pullMonth(year,month)` → SQL z KONTRAKT §8; zapíše do `integration_values`. Try/catch → ak nedostupné, ostáva ručné zadanie.
- `seo.js` — pool na `aura_marketing` (host `sperky-ai-db-1` v sieti `sperky-ai_aura_net`, alebo env `SEO_DB_*`). `pullMonth` → top100_in_top3 (Ahrefs live, P0-3), density 1-3/4-10, ctr/clicks/impressions (GSC). Zapíše do `integration_values`.
- `docker-compose.yml`: pridať external siete a read-only DB usery (viď §9).
- Route `POST /api/v1/integrations/pull?year&month` (Admin) + auto-pull pri otvorení mesiaca. UI: hodnoty s badge „auto", Admin override (logované).

## 6. REST API (`/api/v1`)

```
POST /auth/login, /auth/logout, GET /auth/me
GET  /meta                              -> user, departments (podľa práv), locale, current period, month_status
GET  /lookups                           -> departments, metrics(+inputs), externists, stock_kinds, users(admin)
GET  /dashboard?year&month              -> team_score, dept cards, table rows, series(12m), heatmap, missing count
GET  /department/:key?year&month        -> metriky, hodnoty, plnenie, target, comment, minulý mesiac
POST /department/:key/values            -> uloženie mesiaca (editor+práva); prepočet; audit
GET  /analysis?year                     -> MoM/vs cieľ/YTD/best/worst per metrika
GET  /year?year                         -> ročné súčty, ročné plnenie per odd., ročný Team score
GET  /missing?year                      -> zoznam oddelenie×mesiac×chýbajúce pole + počty
GET  /targets/:metric?year , POST /targets (admin)      -> pásma/plány, „vyplň dopredu"
GET/POST /projects , /stock (journal+agg) , /externists(+tasks+sla)
GET/POST /seo-meeting?year&month , /seo-meeting/:id/answers , /actions
POST /months/:year/:month/close|open (admin)
GET  /export/xlsx?year , /export/xlsx/:dept?year          -> exceljs (štruktúra ako pôvodné súbory)
POST /integrations/pull (admin)
CRUD /admin/users (+ user_departments), /admin/departments, /admin/metrics, /admin/lookups
GET  /reports/half-year?year&half   , /reports/year?year                 -> polročné/ročné vyhodnotenie
```

Chránené `requireAuth`; zápis `requireRole('editor')` + kontrola `user_departments`; admin sekcie `requireRole('admin')`; Hospodársky (visibility=admin) filtrovaný v `/meta`,`/dashboard`,`/department`.

## 7. Frontend views (`public/views/`)

`dashboard.js` (Team score hero, KPI karty, tabuľka, line/bar/donut), `department.js` (detail + „Vyplň mesiac" formulár generovaný z `metric_inputs` + komentár + minulý mesiac + auto badge), `analysis.js`, `year.js` (+ heatmapa), `missing.js` (Na doplnenie), `projects.js`, `stock.js`, `externists.js`, `seomeeting.js` (72-otázkový 4-tab workflow), `settings.js` (users+práva, departments, metrics, targets, lookups, integrácie, jazyk, téma, zálohy). **Admin-Evidencia view sa NESTAVIA** (rozhodnutie 23.7.). NAV badge = počet „na doplnenie" + otvorené mesiace. i18n: `T_SK`/`T_EN` slovníky v `app.js`, prepínač v topbare (localStorage `aura_kpi_lang`).

## 8. Pripomienky — LEN in-app (SMTP VYNECHANÉ)

Rozhodnutie 23.7.: **žiadne e-maily, žiadny nodemailer.** Pripomienky = len **in-app badge** v NAV (počet „na doplnenie" + otvorené mesiace po deadline). `mailer.js` sa NESTAVIA. (SMTP možno doplniť neskôr ako P2.)

## 9. Docker / env

`.env`: `APP_PORT=3030`, DB `aura_kpi`/user/heslo, `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAIL/PASSWORD`, `SMTP_*`, `SEO_DB_*`, `LOGISTIKA_DB_*`, `NGROK_*`. `docker-compose.yml` = Logistika + external siete:
```yaml
networks:
  aura-kpi: { driver: bridge }
  aura-logistika: { external: true }
  sperky-ai_aura_net: { external: true }
# app service pripojený na všetky tri; integrácie čítajú aura-logistika-db / sperky-ai-db-1
```
Read-only DB usery v cieľových DB: `CREATE USER 'kpi_ro'@'%'; GRANT SELECT ...` (Admin spustí manuálne; zdokumentovať v README). Backup skript `scripts/backup-db.ps1` (docker cp dump, bez BOM) + týždenný cron.

## 10. Sprint agentov (poradie a závislosti)

| # | Agent | Dodá | Závisí od |
|---|-------|------|-----------|
| **A0** | Skeleton | Skopíruje z Logistiky: `db,auth,crypto,audit,util,index,seed` (upravené názvy `aura_kpi`, cookie), `public/{index.html,app.js,styles.css}`, `Dockerfile`, `docker-compose.yml`, `.env.example`. `schema.sql` §2 (settings/users/audit + všetky nové tabuľky). Nabehne prázdna appka + login. | — |
| **A1** | KPI config + compute | `kpi-config.js` (všetkých 13 odd. — doplní z excelov), `compute.js` (§4), seed definícií, `metric_targets` default. Unit sanity check výpočtov. | A0 |
| **A2** | Core API + oddelenia | routes `meta,lookups,dashboard,department,targets,months,missing,analysis,year`; `user_departments` práva; recompute po zápise. | A1 |
| **A3** | Frontend SPA views | `dashboard,department(+Vyplň mesiac),analysis,year(+heatmapa),missing,settings`; i18n SK/EN; grafy; farebné prahy; A/B; auto badge. | A2 |
| **A4** | Denníky + moduly | `projects,stock(+kinds),externists(+tasks+sla)` routes+views; agregácia do metrík. | A1,A2 |
| **A5** | Integrácie | `integrations/logistika.js`,`seo.js`, external siete v compose, `/integrations/pull`, override UI, read-only user README. | A1,A2 |
| **A6** | SEO porada + export + zálohy | `seo-meeting` (72 otázok, 4 taby, akcie), `export/xlsx`, backup skript, polročný/ročný report. **Bez mailera** (in-app badge rieši A3). | A2,A3 |
| **A7** | Integračná kontrola | End-to-end v Dockeri: build, migrácie, seed, login/roly, vyplň júl (manual+auto), prepočet, dashboard, uzávierka, export, audit. Oprava nesúladov. | všetky |

Každý agent: commit po dokončení. A7 na konci overí bežiace MVP na `http://localhost:3030`.

---
*23.7.2026. Otvorené: P0-1..P0-7 z KONTRAKT (Admin-Evidencia súbor, mapovania, SMTP, pásma). Build začne po pokyne.*
