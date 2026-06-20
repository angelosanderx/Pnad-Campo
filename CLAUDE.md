# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PNAD-C Campos** is a field management system for IBGE's PNAD-Contínua (National Continuous Household Survey) in the Campos/RJ region. It tracks household visits, interviewers, and survey progress across quarterly collection cycles.

## Deployment

```bash
firebase deploy          # deploy to Firebase Hosting (project: pnad-c-campos)
firebase deploy --only hosting
```

There is no build step — the HTML files are served directly.

## Architecture

This is a zero-build SPA: all code lives in two self-contained HTML files. There are no npm packages, no bundler, and no separate JS/CSS files.

- **`index.html`** (~5000 lines) — the main application. Contains all CSS, HTML markup, and a single `<script type="module">` block with all app logic. Firebase SDK is loaded from CDN (`https://www.gstatic.com/firebasejs/10.12.0/`).
- **`importador_v3.html`** — standalone CSV importer. Reads up to 5 CSV files exported from IBGE's internal systems, cross-references them, and pushes records to Firestore via the REST API. Auth is shared from the main panel via `window.firebaseAuthToken`.

### Firebase backend (project: `pnad-c-campos`)
- **Auth**: Email/password via Firebase Authentication. User profiles are stored in Firestore `usuarios/{uid}`.
- **Database**: Firestore. Accessed via the JS SDK in `index.html` and via the REST API in `importador_v3.html`.
- **Hosting**: `firebase.json` serves all files from `.`, with a catch-all rewrite to `index.html`.

### Firestore data model

| Collection | Doc ID pattern | Purpose |
|---|---|---|
| `domicilios` | `{periodo}_{controle}_{domicilio_num}` | Household records |
| `domicilios/{id}/moradores` | auto | Residents sub-collection |
| `usuarios` | Firebase Auth UID | User profiles |
| `avisos` | auto | Supervisor announcements |
| `chat` | auto | Team chat messages |
| `setores` | auto | Census sector metadata |

Key `domicilios` fields: `upa`, `controle`, `domicilio_num`, `semana` (1–4), `visita_etapa` (1–5), `status_atual`, `periodo`, `trimestre`, `entrevistador_nome`, `entrevistador_id`, `historico_especies` (array), `tentativas_recentes` (array).

### Domain concepts

- **Período**: One of three monthly rotation groups (`jan_abr_jul_out`, `fev_mai_ago_nov`, `mar_jun_set_dez`). Each group has its own set of domicílios. Stored in `localStorage` as `pnad_periodo_atual`. Older records without `periodo` default to `mar_jun_set_dez`.
- **Trimestre**: Survey quarter, e.g. `2026T2`.
- **Semana**: Week 1–4 within a collection period (current week stored in `localStorage` as `pnad_semana_atual`).
- **Visita_etapa**: Interview stage 1–5. Stage 5 means the household leaves the sample next quarter (shown as alert).
- **Status values**: `nao_visitado`, `ausente`, `agendado`, `realizada`, `recusa`, `carta_solicitada`, `supervisao`.
- **User roles**: `entrevistador` (interviewer — restricted UI), `supervisor`, `administrador` (full access including maintenance tools).

### SIGC integration

SIGC is IBGE's internal survey platform. Users copy all text from a SIGC questionnaire (Ctrl+A → Ctrl+C) and paste it into the app. The `processarSIGC()` function parses the raw text to extract interview results and household member data. The **Central de Importação SIGC** page (`pag-importar-sigc`) does the same but auto-matches domicílios by `Controle` and `Domicílio` fields from the pasted text.

### Importador CSV flow

1. User uploads 2 required + up to 3 optional CSV files from IBGE.
2. `processarDados()` cross-references all files by the `{controle}_{domicilio_num}` key.
3. Preview is shown; user clicks "Importar para o Firestore."
4. `importarFirestore()` PATCHes each domicílio to `domicilios/{periodo}_{controle}_{domicilio_num}` using the Firestore REST API with the user's Firebase auth token.

### Map (Leaflet)

Leaflet 1.9.4 is lazy-loaded from CDN once (`obterLeaflet()` returns a shared promise). It is preloaded in the background after login. KML files can be imported in the Setores page to plot sector boundaries and household coordinates.
