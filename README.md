# NexusDesk / HelpTicket

Ein privates, deutschsprachiges Support-Ticketsystem mit React + Vite, GitHub Pages, Supabase und Resend.

## Funktionen

- Nur eingeladene Nutzer: E-Mail/Passwort-Login, keine öffentliche Registrierung
- Rollen `admin` und `support`
- Tickets erstellen, suchen, filtern und nach Status/Priorität verwalten
- Nachrichtenverlauf, Anhänge bis 8 MB und private Storage-Bucket
- Supabase Row Level Security (RLS) für Datenbankzugriff
- Resend-Benachrichtigungen über eine Supabase Edge Function
- Responsive Dark-Mode-Oberfläche

> **Wichtig:** Dies ist eine Startimplementierung. Vor dem produktiven Einsatz bitte die Sicherheitshinweise und Tests unten abarbeiten. Keine Passwörter, Tokens, API-Keys oder vertraulichen personenbezogenen Daten in Git committen.

## 1. Supabase einrichten

1. Ein Projekt unter https://supabase.com erstellen.
2. Im Projekt **SQL Editor** öffnen und `supabase/schema.sql` vollständig ausführen.
3. Unter **Authentication → URL Configuration** die lokale URL `http://localhost:5173` und die spätere GitHub-Pages-URL hinzufügen.
4. Unter **Authentication → Providers → Email** öffentliche Sign-ups deaktivieren. Nur Admins dürfen Nutzer über **Authentication → Users → Invite user** einladen.
5. Lade zuerst deine eigene E-Mail-Adresse über **Invite user** ein. Öffne danach SQL Editor und setze deine Rolle:
   ```sql
   update public.profiles set role = 'admin' where email = 'DEINE-LOGIN-EMAIL';
   ```
   Prüfe danach:
   ```sql
   select id, email, role from public.profiles;
   ```
6. Unter **Project Settings → API** die Project URL und den Publishable-/Anon-Key kopieren. Der `service_role`-Key ist geheim und gehört niemals in Frontend oder GitHub.
7. Prüfe in **Storage**, dass der Bucket `ticket-files` privat ist. Das SQL-Skript legt ihn privat an.

### Hinweise zur Einladung

Die App bietet bewusst keinen öffentlichen Registrierungsweg. Nutzer werden im Supabase-Dashboard eingeladen. Der Menüpunkt „Nutzer einladen“ erinnert daran, wie die Einladung erfolgt; er verschickt aus Sicherheitsgründen nicht selbst. Für einen produktiven Self-Service-Admin-Einladungsbutton ist eine zusätzliche Edge Function mit serverseitiger Admin-Prüfung und Service-Role-Key nötig.

## 2. Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
cp .env.example .env
```

Bearbeite `.env` und setze die Supabase-Werte:

```dotenv
VITE_SUPABASE_URL=https://DEIN-PROJEKT.supabase.co
VITE_SUPABASE_ANON_KEY=DEIN_PUBLISHABLE_ODER_ANON_KEY
```

Dann:

```bash
npm run dev
```

Öffne die in der Konsole angezeigte Adresse, normalerweise `http://localhost:5173`.

## 3. E-Mail-Benachrichtigungen aktivieren

Die App ruft die Edge Function `notify-ticket` nach Erstellung eines Tickets und nach einer Antwort auf. Die Funktion prüft die eingeloggte Identität, kontrolliert den Ticketzugriff und versendet über Resend.

1. Erstelle ein Konto bei https://resend.com und verifiziere eine Absenderdomain. Für einen echten Betrieb nicht dauerhaft `onboarding@resend.dev` verwenden.
2. Installiere die Supabase CLI nach der offiziellen Anleitung: https://supabase.com/docs/guides/cli
3. Melde dich an und verknüpfe das Projekt:
   ```bash
   supabase login
   supabase link --project-ref DEIN_PROJECT_REF
   ```
4. Hinterlege Secrets (keine davon in `.env` mit `VITE_` speichern):
   ```bash
   supabase secrets set RESEND_API_KEY=re_DEIN_KEY SUPPORT_EMAIL=deine-adresse@example.com APP_URL=https://DEIN_GITHUB_NAME.github.io/DEIN_REPO/
   supabase secrets set MAIL_FROM="Helpdesk <support@DEINE-DOMAIN.de>"
   ```
5. Deploye:
   ```bash
   supabase functions deploy notify-ticket
   ```
6. Die Funktion verwendet die von Supabase bereitgestellten `SUPABASE_URL`, `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY` serverseitig. Niemals den Service-Role-Key in GitHub oder Frontend-Code eintragen.
7. Die aktuelle Funktion sendet bei Ticket-Erstellung an `SUPPORT_EMAIL`. Bei einer Antwort sendet sie an Support bzw. an den Ticket-Ersteller, wenn der antwortende Nutzer Admin ist.

**Hinweis:** Die UI fängt Fehler der Benachrichtigungsfunktion aktuell ab, damit das Ticket selbst nicht scheitert, wenn E-Mail kurzzeitig nicht verfügbar ist. Prüfe die Edge-Function-Logs in Supabase, wenn keine E-Mail ankommt.

## 4. Auf GitHub veröffentlichen

1. Erstelle auf GitHub ein neues Repository, z. B. `helpticket`. Für dieses Setup muss das Repository öffentlich sein, wenn du den kostenlosen GitHub-Pages-Tarif nutzt. Das bedeutet nicht, dass Tickets öffentlich sind: die Daten liegen in Supabase und werden durch RLS geschützt. Trotzdem enthält das Repo nur Frontend-Code und öffentliche Supabase-Clientwerte.
2. Lade die Projektdateien hoch bzw. pushe sie:
   ```bash
   git init
   git add .
   git commit -m "Initial helpdesk"
   git branch -M main
   git remote add origin https://github.com/DEIN_GITHUB_NAME/helpticket.git
   git push -u origin main
   ```
3. Öffne im Repository **Settings → Pages**.
4. Wähle **Build and deployment → Source: GitHub Actions**.
5. Lege die Repository Secrets unter **Settings → Secrets and variables → Actions** an:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Die Workflow-Datei `.github/workflows/deploy.yml` baut die App und veröffentlicht `dist/`.
7. Nach erfolgreichem Lauf findest du die URL unter **Settings → Pages**. Sie sieht typischerweise so aus:
   `https://DEIN_GITHUB_NAME.github.io/helpticket/`
8. Füge diese URL in Supabase **Authentication → URL Configuration → Redirect URLs** ein. Aktualisiere auch `APP_URL` als Edge-Function-Secret, falls du die E-Mail-Links nutzen möchtest.

## 5. Vor dem Livegang testen

- [ ] Anmeldung mit eingeladenem Konto funktioniert.
- [ ] Nicht eingeladene E-Mail kann sich nicht registrieren.
- [ ] Support-Nutzer sieht nur seine eigenen Tickets.
- [ ] Support-Nutzer kann Status/Priorität nicht ändern.
- [ ] Admin sieht alle Tickets und kann Status/Priorität ändern.
- [ ] Dateien sind nur für berechtigte Nutzer herunterladbar.
- [ ] Benachrichtigungen kommen an und landen nicht im Spam.
- [ ] Auf einem zweiten Testkonto wird geprüft, dass Ticket-IDs anderer Nutzer nicht ausgelesen werden können.
- [ ] MFA für Admin-Konten aktivieren und Resend-Absenderdomain verifizieren.

## Sicherheits- und Implementierungshinweise

- Der Supabase Publishable-/Anon-Key darf im Browser liegen; RLS ist zwingend erforderlich.
- `service_role`, Resend-Key und sonstige geheime Schlüssel bleiben ausschließlich in Supabase Edge Function Secrets.
- Der Storage-Bucket ist privat; Downloads werden über kurzlebige signierte URLs geöffnet.
- Uploads sind auf 8 MB pro Datei begrenzt. Die Bucket-MIME-Liste ist absichtlich eingeschränkt.
- Für einen größeren Einsatz sollten Rate Limits, Audit-Logs, Backup/Restore, Spam-Schutz und ein automatisierter Sicherheitstest ergänzt werden.
- Für strengere Produktionssicherheit sollte der Client nicht direkt `updated_at` setzen dürfen; stattdessen einen Datenbanktrigger für Änderungen einsetzen. Das Frontend aktualisiert den Zeitstempel aktuell beim Antworten.
- Das Einladungsformular ist in diesem Starter bewusst nur ein Hinweis auf die sichere Dashboard-Einladung, kein funktionsfähiger Admin-Invite-API-Aufruf.
