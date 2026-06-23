#!/usr/bin/env node
/**
 * importar_links_guia.js
 * Lê os PDFs do Guia de Estudo da pasta /apoio e extrai links dos cadernos TEC.
 * Coleção: `disciplinas`, campo `cadernos_tec` (array, merge: true)
 */

const path = require('path');
const fs   = require('fs');

// ── Verificar serviceAccountKey.json ────────────────────────────────────────
const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('❌  serviceAccountKey.json não encontrado.');
  process.exit(1);
}

const admin = require('firebase-admin');
const serviceAccount = require(keyPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Mapeamento disciplina (texto PDF) → slug ─────────────────────────────────
const DISC_MAP = {
  'DIREITO ADMINISTRATIVO':       'd_administrativo',
  'DIREITO CONSTITUCIONAL':       'd_constitucional',
  'DIREITO TRIBUTARIO':           'd_tributario',
  'CONTABILIDADE GERAL':          'contabilidade_geral',
  'CONTABILIDADE':                'contabilidade_geral',
  'PORTUGUES':                    'portugues',
  'RACIOCINIO LOGICO':            'raciocinio_logico',
  'AUDITORIA FISCAL':             'auditoria_fiscal',
  'FLUENCIA DE DADOS':            'fluencia_dados',
  'LEGISLACAO TRIBUTARIA':        'legislacao_tributaria',
  'DIREITO FINANCEIRO':           'd_financeiro',
  'ADMINISTRACAO FINANCEIRA':     'adm_financeira',
  'AFO':                          'adm_financeira',
};

function normalizar(str) {
  return (str || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolverDiscSlug(texto) {
  const norm = normalizar(texto);
  if (DISC_MAP[norm]) return DISC_MAP[norm];
  for (const [k, v] of Object.entries(DISC_MAP)) {
    if (norm.includes(k)) return v;
  }
  return null;
}

const BANCAS = ['FGV', 'FCC', 'CESPE', 'CEBRASPE', 'VUNESP', 'ESAF', 'CESGRANRIO', 'FUNRIO', 'FEPESE', 'FUNDATEC'];

function detectarBanca(texto) {
  const up = normalizar(texto);
  for (const b of BANCAS) {
    if (up.includes(b)) return b === 'CEBRASPE' ? 'CESPE' : b;
  }
  return 'Outras';
}

// ── Extrair links de um PDF com pdfjs-dist ───────────────────────────────────
async function extrairLinksDoPDF(filePath, getDocument) {
  const data = fs.readFileSync(filePath);
  const doc  = await getDocument({ data: new Uint8Array(data) }).promise;
  const resultado = []; // { discSlug, banca, rotulo, nome, url }

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);

    // Links da página
    const annots = await page.getAnnotations();
    const links  = annots.filter(a => a.subtype === 'Link' && a.url && a.url.startsWith('http'));
    if (!links.length) continue;

    // Texto completo da página com posições
    const content = await page.getTextContent();
    const items   = content.items.map(t => ({
      str: t.str,
      x:   t.transform[4],
      y:   t.transform[5],
    }));

    // Texto plano para detectar disciplina/banca do cabeçalho
    const textoPlano = items.map(t => t.str).join(' ');

    // Detectar disciplina atual na página
    let discAtual = null;
    // Tenta cada segmento de texto
    for (const item of items) {
      const slug = resolverDiscSlug(item.str);
      if (slug) { discAtual = slug; break; }
    }
    // Fallback: varredura de janela deslizante no texto plano
    if (!discAtual) {
      const words = textoPlano.split(/\s+/);
      for (let w = 0; w < words.length - 1; w++) {
        const janela = words.slice(w, w + 4).join(' ');
        const slug = resolverDiscSlug(janela);
        if (slug) { discAtual = slug; break; }
      }
    }

    // Detectar banca padrão da página (ex: "BANCA FGV" no cabeçalho)
    let bancaPagina = detectarBanca(textoPlano);

    for (const link of links) {
      // Rect do link: [x1, y1, x2, y2]
      const [x1, y1, x2, y2] = link.rect;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;

      // Textos na mesma linha horizontal (±20pt)
      const linha = items
        .filter(t => Math.abs(t.y - cy) < 20)
        .sort((a, b) => a.x - b.x)
        .map(t => t.str.trim())
        .filter(Boolean);

      const textoLinha = linha.join(' ');

      // Rótulo: procura padrão "Caderno NN", "Bloco X", nome de prova
      let rotulo = '';
      const mCad   = textoLinha.match(/Caderno\s+(?:Completo|\d+)/i);
      const mBloco = textoLinha.match(/Bloco\s+[IVXLC\d]+/i);
      const mProva = textoLinha.match(/\b(SEFAZ|ISS|SMFA|PGM|TCE|AGU|PGFN|ESAF)[^\n🔗]*/i);

      if (mCad)   rotulo = mCad[0].trim();
      else if (mBloco) rotulo = mBloco[0].trim();
      else if (mProva) rotulo = mProva[0].trim().slice(0, 50);
      else rotulo = textoLinha.replace(/\d+\s*$/, '').trim().slice(0, 60) || 'Link';

      // Banca da linha (pode sobrescrever a da página)
      const bancaLinha = detectarBanca(textoLinha);
      const banca = bancaLinha !== 'Outras' ? bancaLinha : bancaPagina;

      resultado.push({
        discSlug: discAtual,
        banca,
        rotulo,
        nome:  textoLinha.slice(0, 80) || rotulo,
        url:   link.url,
      });
    }
  }

  return resultado;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  // pdfjs-dist é ESM — usar dynamic import
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const apoioDir = path.join(__dirname, 'apoio');
  if (!fs.existsSync(apoioDir)) {
    console.error(`❌  Pasta /apoio não encontrada em ${apoioDir}`);
    process.exit(1);
  }

  const pdfs = fs.readdirSync(apoioDir)
    .filter(f => f.toLowerCase().includes('guia') && f.endsWith('.pdf'));

  if (!pdfs.length) {
    const todos = fs.readdirSync(apoioDir).filter(f => f.endsWith('.pdf'));
    if (!todos.length) { console.log('Nenhum PDF encontrado em /apoio'); process.exit(0); }
    pdfs.push(...todos);
  }

  const porDisc = {}; // slug → [{banca, rotulo, nome, url}]

  for (const pdf of pdfs) {
    const filePath = path.join(apoioDir, pdf);
    console.log(`\nProcessando ${pdf}...`);
    try {
      const entradas = await extrairLinksDoPDF(filePath, getDocument);
      let semDisc = 0;
      for (const e of entradas) {
        if (!e.discSlug) { semDisc++; continue; }
        if (!porDisc[e.discSlug]) porDisc[e.discSlug] = [];
        porDisc[e.discSlug].push({ banca: e.banca, rotulo: e.rotulo, nome: e.nome, url: e.url });
      }
      console.log(`  ${entradas.length} links encontrados (${semDisc} sem disciplina identificada)`);
    } catch (e) {
      console.error(`❌  Erro ao processar ${pdf}: ${e.message}`);
    }
  }

  let totalImportadas = 0;
  let totalErros      = 0;

  for (const [slug, cadernos] of Object.entries(porDisc)) {
    // Remover duplicatas por URL
    const vistos = new Set();
    const dedup  = cadernos.filter(c => { if (vistos.has(c.url)) return false; vistos.add(c.url); return true; });

    try {
      await db.collection('disciplinas').doc(slug).set({ cadernos_tec: dedup }, { merge: true });
      const contBancas = {};
      for (const c of dedup) contBancas[c.banca] = (contBancas[c.banca] || 0) + 1;
      const resumo = Object.entries(contBancas).map(([b, n]) => `${b}: ${n}`).join(', ');
      console.log(`✅ ${slug} — ${dedup.length} cadernos — ${resumo}`);
      totalImportadas++;
    } catch (e) {
      console.error(`❌ Erro em ${slug}: ${e.message}`);
      totalErros++;
    }
  }

  console.log(`\nConcluído: ${totalImportadas} disciplinas importadas`);
  if (totalErros) console.log(`Erros: ${totalErros}`);
}

main().catch(e => { console.error('Erro fatal:', e.message); process.exit(1); });
