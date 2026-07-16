# REST API + bezpečnosť

> Praktický playbook na dizajn a zabezpečenie REST/HTTP API pre Aura — od návrhu endpointov cez autentifikáciu a autorizáciu až po ochranu proti OWASP API Top 10 (2023).

## Prehľad — čo to je a prečo na tom v Aure záleží

REST API je zmluva medzi klientom (web, mobilná appka, Higgsfield/Canva integrácie, platobná brána) a serverom, ktorá cez HTTP prenáša dáta o objednávkach, zákazníkoch, skladových zásobách a platbách. Každý endpoint, ktorý vystavíš, je zároveň potenciálny vstup pre útočníka.

Prečo je to pre Auru kritické:

- **Osobné údaje zákazníkov** (meno, adresa, e-mail, história objednávok) podliehajú GDPR. Únik cez zle zabezpečený endpoint = pokuta + strata dôvery.
- **Platby a e-shop logika** — API, ktoré vytvára objednávky alebo aplikuje zľavy, musí byť odolné proti manipulácii (napr. zmena ceny alebo množstva v requeste).
- **Integrácie a webhooky** — prijímaš callbacky z platobnej brány, Meta/Google Ads API, dodávateľov. Každý vstupný webhook treba overiť (podpis), inak môže ktokoľvek podvrhnúť „zaplatenú objednávku".
- **AI/automatizácie** — ak dávaš AI agentom prístup k svojmu API, autorizácia musí byť tesná (least privilege), inak sa z pohodlia stane bezpečnostná diera.

Kľúčová štatistika: **BOLA (Broken Object Level Authorization) tvorí ~40 % všetkých API útokov** a je najčastejšou API zraniteľnosťou. 95 % API útokov prichádza od autentifikovaných používateľov — takže „mať login" nestačí, treba kontrolovať *čo* smie ten konkrétny prihlásený používateľ vidieť a robiť.

## Kľúčové pojmy — glosár

- **REST / Resource** — architektúra, kde adresuješ *zdroje* (`/orders/123`, `/products/45`) cez HTTP metódy: `GET` (čítanie), `POST` (vytvorenie), `PUT`/`PATCH` (úprava), `DELETE` (mazanie). GET musí byť *idempotentný* a bez vedľajších efektov.
- **Idempotencia** — opakované vykonanie tej istej operácie dá rovnaký výsledok. Kritické pri platbách: `Idempotency-Key` header zabráni dvojitému stiahnutiu peňazí pri retry.
- **BOLA (API1:2023)** — Broken Object Level Authorization. Používateľ A pristúpi k objektu používateľa B len zmenou ID v URL (`/orders/124` namiesto `/orders/123`). Najčastejšia a najnebezpečnejšia chyba.
- **BOPLA (API3:2023)** — Broken Object Property Level Authorization. Zlúčenie starých kategórií *Excessive Data Exposure* (API vracia viac polí, než by malo — napr. `is_admin`, interné poznámky) a *Mass Assignment* (klient pošle pole, ktoré nemal — napr. `{"role":"admin","balance":9999}` a server ho slepo uloží).
- **BFLA (API5:2023)** — Broken Function Level Authorization. Bežný používateľ zavolá admin funkciu (`DELETE /users/5`, `POST /admin/refund`), lebo endpoint nekontroluje rolu.
- **Authentication (AuthN)** — *kto si*. Overenie identity (heslo, token, OAuth).
- **Authorization (AuthZ)** — *čo smieš*. Kontrola oprávnení na konkrétny objekt/funkciu. AuthN ≠ AuthZ; väčšina API dier je v AuthZ.
- **OAuth 2.1** — konsolidovaný auth framework (zjednotenie OAuth 2.0 + bezpečnostných BCP). Povinné PKCE, zákaz implicit flow a password grantu.
- **OIDC (OpenID Connect)** — vrstva nad OAuth 2.0 pre *autentifikáciu* (ID token). OAuth samotný je len o autorizácii.
- **PKCE** — Proof Key for Code Exchange. Klient vygeneruje náhodný `code_verifier` (43–128 znakov) a pošle jeho SHA-256 hash (`code_challenge`, metóda `S256`). Bráni odcudzeniu authorization code.
- **JWT** — JSON Web Token. Podpísaný (nie nutne šifrovaný!) token s claimami. Časti: header, payload, signature. Payload je len Base64 — **nikdy tam nedávaj tajomstvá**.
- **Access token vs. refresh token** — access je krátkodobý (5–15 min), používa sa na každý request. Refresh je dlhodobý, uložený bezpečne, slúži len na získanie nového access tokenu.
- **CORS** — Cross-Origin Resource Sharing. Prehliadačový mechanizmus, ktorý riadi, ktoré *origin* domény smú volať tvoje API z JS. Nie je to autentifikácia, je to ochrana prehliadača.
- **SSRF (API7 súčasť)** — Server-Side Request Forgery. Útočník prinúti *tvoj server* poslať request na interný cieľ (`http://169.254.169.254/` cloud metadata, interné služby).
- **Rate limiting** — obmedzenie počtu requestov za časové okno. Chráni proti brute-force, scrapingu, DoS a nákladovému vyčerpaniu.
- **HSTS / CSP / TLS** — bezpečnostné hlavičky a šifrovanie transportu (viď nižšie).

## Best practices 2025/2026 — aktuálny stav a čo sa zmenilo

### Autorizácia (najdôležitejšia časť)
- **Kontroluj vlastníctvo objektu pri KAŽDOM requeste**, nie len prihlásenie. Nikdy nedôveruj ID z URL/body. Vzor: `SELECT * FROM orders WHERE id = :id AND user_id = :current_user`. Nespoliehaj sa na to, že klient „nepozná" cudzie ID.
- **Používaj náhodné, neuhádnuteľné identifikátory** (UUIDv4/ULID) namiesto sekvenčných integer ID v URL. Nie je to náhrada za AuthZ kontrolu, ale znižuje enumeráciu.
- **Deny-by-default na funkčnej úrovni (BFLA)** — každý admin/citlivý endpoint explicitne vyžaduje rolu/permission. Nové v roku 2025: preferuj *policy-based* autorizáciu (napr. Laravel Policies/Gates, Symfony Voters) namiesto rozhádzaných `if` kontrol.
- **Mass assignment (BOPLA)** — používaj explicitné allowlisty polí (DTO / Form Request / `$fillable`, nikdy `$guarded = []`). Nikdy nemapuj celý request body priamo na DB model. Oddeľ *input DTO* od *DB entity*.
- **Excessive data exposure** — definuj explicitné *response* DTO/resource; nevracaj celý model. Filtrovanie na frontende NIE je ochrana.

### Autentifikácia a tokeny (2025/2026 stav)
- **OAuth 2.1 je nový baseline** (RFC 9700 – Best Current Practice, publikovaný 2025 nahradzuje staré draft BCP). Zmeny oproti OAuth 2.0:
  - **PKCE povinné pre VŠETKY klienty** vrátane confidential server-side aplikácií (nielen mobile/SPA).
  - **Implicit grant zrušený**, **Resource Owner Password Credentials grant zrušený**.
  - **Exact redirect URI matching** (žiadne wildcardy).
- **Access token TTL: 5–15 min**, podpis **RS256 alebo ES256** (asymetrické — verifikátory nepotrebujú privátny kľúč). Vyhni sa HS256, ak token overuje viac služieb.
- **Vždy validuj claimy**: `iss` (issuer), `aud` (audience), `exp` (expirácia), `nbf`. Over algoritmus proti allowlistu — **odmietni `alg: none`** a nedovoľ downgrade z RS256 na HS256 (klasický JWT confusion útok).
- **Refresh token rotation** — pri každom použití vydaj nový refresh token a starý zneplatni (single-use). Priraď každému `jti`. Pri detekcii reuse (použitie už rotovaného tokenu) zneplatni celú token rodinu — signál krádeže.
- **Ukladanie tokenov v prehliadači**: refresh token do **`HttpOnly; Secure; SameSite=Strict` cookie**, nie do `localStorage` (XSS ho ukradne). Access token drž v pamäti (in-memory), nie v localStorage.
- **Session vs. JWT**: pre klasický web s vlastným backendom sú *server-side sessions* (opaque cookie) často bezpečnejšie a jednoduchšie na revokáciu než JWT. JWT má zmysel pre stateless multi-service/mobilné scenáre. JWT nevýhoda: ťažká okamžitá revokácia (potrebuješ denylist/krátke TTL).

### Transport a hlavičky
- **TLS 1.2 a 1.3 only** — vypni SSLv3 a TLS < 1.2. TLS 1.3 = menej round-tripov, povinná forward secrecy. HTTP presmeruj na HTTPS (301).
- **HSTS**: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (2 roky, OWASP odporúčanie). Preload až keď si istý, že všetky subdomény idú po HTTPS.
- **Security headers (2025 baseline)**:
  - `Content-Security-Policy` — pre API čisto JSON stačí `default-src 'none'; frame-ancestors 'none'`. Pre web preferuj **nonce + `strict-dynamic`** namiesto allowlistu CDN domén (allowlist CDN sa dá obísť).
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY` (alebo `frame-ancestors 'none'` v CSP)
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` — vypni nepoužívané API (`camera=(), geolocation=()`).
  - Odstráň `Server`, `X-Powered-By` (information disclosure).
- **Content-Type** — vždy vracaj `application/json` a odmietaj requesty s nesprávnym `Content-Type`. Nastav `Accept` handling striktne.

### CORS (časté nedorozumenie)
- **Nikdy `Access-Control-Allow-Origin: *` spolu s `Access-Control-Allow-Credentials: true`** — táto kombinácia je zakázaná špecifikáciou a je klasická diera.
- **Nereflektuj slepo `Origin` header** späť do `Access-Control-Allow-Origin`. Použi **server-side allowlist** konkrétnych dôveryhodných domén (napr. `https://aura.sk`, `https://www.aura.sk`).
- Obmedz `Access-Control-Allow-Methods` a `-Headers` len na to, čo reálne potrebuješ.
- CORS chráni prehliadač, **nie server** — nenahrádza autentifikáciu. Non-browser klient (curl, bot) CORS ignoruje.

### Rate limiting
- **Token bucket** je de-facto štandard (používa AWS, Stripe, GitHub) — umožňuje krátke bursty a zároveň drží dlhodobý priemer. Alternatíva: sliding window log/counter.
- Limituj **per identity** (user ID / API key), nielen per IP (IP zdieľajú NAT/mobilné siete). Pre neautentifikované endpointy (login, register, reset hesla) limituj prísnejšie per IP + per account.
- Pri prekročení vráť **`429 Too Many Requests`** s hlavičkou **`Retry-After`** (sekundy alebo HTTP dátum) a informatívnymi `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` hlavičkami (IETF draft štandard).
- Klient by mal na 429 reagovať **exponential backoff s „full jitter"** (náhodné oneskorenie 0…ceiling), aby sa retry nezhlukli.

### SSRF (nová 2023 kategória, stále aktuálna)
- Ak server na základe user vstupu robí HTTP request (import obrázka z URL, webhook, náhľad odkazu):
  - **Allowlist povolených hostov/schém** namiesto blocklistu.
  - **Zablokuj privátne a metadata rozsahy**: `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254.169.254` (cloud metadata), IPv6 loopback/ULA.
  - Rozlíš (resolve) DNS a validuj cieľovú IP **po** resolvovaní — pozor na DNS rebinding (validuj a potom použi tú istú IP).
  - Zakáž redirecty na iné hosty alebo ich znovu-validuj.
  - Ideálne posielaj outbound cez dedikovanú proxy s egress filtrovaním.

### Request signing / webhooky
- Prichádzajúce webhooky (platby, dodávatelia) overuj **HMAC-SHA256 podpisom** z hlavičky (`X-Signature`) proti raw body a zdieľanému tajomstvu. Porovnávaj **constant-time** funkciou (`hash_equals`).
- Použi **timestamp + tolerančné okno** (napr. 5 min) proti replay útokom; ukladaj spracované `event_id` (idempotencia).
- Pre server-to-server API zvažuj mTLS alebo podpisovanie requestov (napr. AWS SigV4 štýl).

## Krok za krokom — workflow zabezpečenia endpointu

1. **Definuj kontrakt** — resource, HTTP metóda, vstupné a výstupné DTO. Napíš OpenAPI 3.1 špecifikáciu *pred* implementáciou (spec-first). Explicitne vymenuj polia — žiadne „pošli mi celý objekt".
2. **Autentifikuj** — over token/session na vstupe. Validuj JWT podpis + `iss`/`aud`/`exp` + algoritmus proti allowlistu.
3. **Autorizuj na úrovni funkcie (BFLA)** — má tento používateľ rolu/permission na túto operáciu? Deny-by-default.
4. **Validuj a sanitizuj vstup** — typy, dĺžky, formáty, rozsahy. Používaj parametrizované/prepared statements (SQL injection). Odmietni neznáme polia (strict schema).
5. **Autorizuj na úrovni objektu (BOLA)** — patrí požadovaný objekt tomuto používateľovi/tenantovi? Query vždy scopuj na `current_user`/`tenant_id`.
6. **Ošetri mass assignment (BOPLA)** — mapuj len allowlist polí z input DTO. Citlivé polia (`role`, `price`, `user_id`, `is_verified`) sa nastavujú serverom, nikdy z body.
7. **Vykonaj operáciu idempotentne** — pri POST/platbách rešpektuj `Idempotency-Key`.
8. **Filtruj výstup** — vráť len response DTO s povolenými poľami. Žiadne interné/citlivé polia.
9. **Aplikuj rate limit** a **security headers** (často na úrovni reverzného proxy/gateway).
10. **Loguj bezpečnostné udalosti** — neúspešné AuthZ, 401/403/429, anomálie. **Neloguj tokeny, heslá, PII v plaintext.**
11. **Vráť čistú chybu** — konzistentný error formát (RFC 9457 Problem Details), bez stack trace a interných detailov v produkcii.

## Checklist

- [ ] Každý endpoint kontroluje **vlastníctvo objektu** (BOLA), nie len prihlásenie — query scopuje na `user_id`/`tenant_id`.
- [ ] Citlivé/admin endpointy majú **explicitnú kontrolu rolí** (BFLA), deny-by-default.
- [ ] Vstup mapovaný cez **allowlist polí** (DTO/Form Request), nie hromadné priradenie (BOPLA).
- [ ] Response vracia len **whitelistované polia** — žiadne `password_hash`, interné poznámky, `is_admin`.
- [ ] JWT: overený **podpis + algoritmus (allowlist) + `iss`/`aud`/`exp`**; odmietnutý `alg:none`.
- [ ] Access token TTL 5–15 min; **refresh token rotation** so single-use a reuse detekciou.
- [ ] Refresh token v `HttpOnly; Secure; SameSite=Strict` cookie; nič citlivé v `localStorage`.
- [ ] OAuth flow používa **Authorization Code + PKCE (S256)**; žiadny implicit/password grant.
- [ ] **TLS 1.2/1.3 only**, HTTP → HTTPS redirect, **HSTS** s `max-age=63072000; includeSubDomains`.
- [ ] Security headers nastavené: CSP, `nosniff`, `X-Frame-Options/frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`; `Server`/`X-Powered-By` skryté.
- [ ] **CORS**: allowlist konkrétnych domén, žiadny wildcard s credentials, žiadne slepé reflektovanie Origin.
- [ ] **Rate limiting** per identity + per IP; `429` s `Retry-After`; prísnejšie na auth endpointoch.
- [ ] Vstup **validovaný**; SQL cez **prepared statements**; žiadna string konkatenácia dotazov.
- [ ] **SSRF**: allowlist hostov, blokované privátne/metadata IP rozsahy, kontrola redirectov.
- [ ] Webhooky overené **HMAC podpisom (constant-time)** + timestamp + idempotencia (`event_id`).
- [ ] Platby/POST idempotentné cez `Idempotency-Key`.
- [ ] Chyby cez **RFC 9457 Problem Details**, bez stack trace v produkcii.
- [ ] Bezpečnostné logovanie zapnuté; **PII/tajomstvá sa neloguju**.
- [ ] OpenAPI špec existuje a je linknutá v CI (Spectral); staré/nepoužívané verzie API zrušené (API9 – nesprávny inventory management).

## Časté chyby a ako sa im vyhnúť

- **„Používateľ je prihlásený, tak môže" (BOLA)** — najčastejšia a najdrahšia chyba. Vždy over, že objekt patrí práve tomuto používateľovi. Riešenie: scopni každú query na `current_user`.
- **Autorizácia iba na frontende** — skrytie tlačidla nie je bezpečnosť. Každú kontrolu duplikuj na backende.
- **Slepé `$request->all()` / mass assignment** — otvára cestu k `role=admin`. Používaj explicitné DTO/`$fillable`, nikdy `$guarded=[]`.
- **Vracanie celého DB modelu** — leaky interné polia. Definuj response resource/DTO.
- **Tajomstvá v JWT payloade** — payload je len Base64, každý si ho prečíta. Do JWT dávaj len ID a nutné claimy.
- **Dlhé access tokeny bez revokácie** — 24h JWT = 24h okno po krádeži. Krátke TTL + refresh rotation.
- **`localStorage` pre tokeny** — XSS ich ukradne. HttpOnly cookie.
- **CORS wildcard + credentials** — priama diera. Allowlist domén.
- **Rate limit len per IP** — mobilné/NAT siete zdieľajú IP; útočník s botnetom ho obíde. Limituj per identity.
- **Blocklist namiesto allowlist (SSRF, CORS, upload typy)** — blocklist vždy niečo prepustí. Vždy allowlist.
- **Verbose chyby v produkcii** — stack trace prezradí verziu frameworku, cesty, štruktúru DB. Generické chyby + interné logovanie.
- **Neoverené webhooky** — ktokoľvek pošle „platba prebehla". Vždy HMAC + timestamp.
- **Zabudnuté staré verzie API** (`/v1/` beží popri `/v2/`) — starý endpoint často nemá nové bezpečnostné opravy. Inventarizuj a rušiť.
- **Chýbajúca idempotencia pri platbách** — retry po timeoute dvakrát strhne peniaze. `Idempotency-Key`.

## Nástroje

- **Návrh a dokumentácia**: OpenAPI 3.1, Stoplight/Scalar/Redoc, Spectral (linting špecifikácie v CI).
- **Testovanie a útoky**: Postman, Insomnia, `httpie`/`curl`, OWASP ZAP, Burp Suite, Schemathesis (property-based testing z OpenAPI).
- **Auth**: knižnice s validáciou JWT (nie vlastná krypto implementácia), Keycloak/Auth0/Logto ako identity provider, Laravel Sanctum/Passport, Symfony Security.
- **Gateway / rate limiting / WAF**: HAProxy, Nginx, Cloudflare, Kong, Traefik — rate limiting a security headers často riešiť centrálne tu.
- **Skener hlavičiek a TLS**: securityheaders.com, SSL Labs (ssllabs.com/ssltest), Mozilla Observatory, `testssl.sh`.
- **Secrets & scanning**: gitleaks/trufflehog (leak detection v CI), HashiCorp Vault / cloud secret manager.
- **Runtime monitoring**: štruktúrované logy (PSR-3/Monolog), anomália detekcia na 401/403/429.
- **Referencia rizík**: OWASP API Security Top 10 (2023), OWASP ASVS, OWASP Cheat Sheet Series.

## Zdroje

- [OWASP API Security Top 10 – 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/)
- [API1:2023 Broken Object Level Authorization – OWASP](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/)
- [OWASP API Security Top 10 2023 Explained – Salt Security](https://salt.security/blog/owasp-api-security-top-10-explained)
- [RFC 9700 – Best Current Practice for OAuth 2.0 Security (IETF)](https://datatracker.ietf.org/doc/rfc9700/)
- [The Developer Guide to API Security: OAuth 2.1, JWT Best Practices – daily.dev](https://daily.dev/blog/dev-guide-api-security-oauth-2-1-jwt-vulnerabilities/)
- [Refresh Token Rotation: Best Practices – Serverion](https://www.serverion.com/uncategorized/refresh-token-rotation-best-practices-for-developers/)
- [10 Best Practices for API Rate Limiting in 2025 – Zuplo](https://zuplo.com/learning-center/10-best-practices-for-api-rate-limiting-in-2025)
- [429 Too Many Requests – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429)
- [HTTP 429 Too Many Requests Guide – Zuplo](https://zuplo.com/learning-center/http-429-too-many-requests-guide)
- [Strict-Transport-Security header – MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security)
- [HTTP Security Headers Complete Reference – hidekazu-konishi.com](https://hidekazu-konishi.com/entry/http_security_headers_complete_reference.html)
- [CORS misconfiguration allowing unauthorized cross-origin access – Sourcery](https://www.sourcery.ai/vulnerabilities/api-cors-misconfiguration)
- [Securing APIs from Misconfiguration Attacks – miniOrange](https://apisecurity.miniorange.com/blogs/securing-api-from-misconfiguration-attacks/)
