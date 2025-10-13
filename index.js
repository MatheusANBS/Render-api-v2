const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
// DB
require('dotenv').config();
const { Pool } = require('pg');

let pool = null;
if (process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    console.log('🔌 Conectando ao banco via DATABASE_URL');
} else {
    console.log('⚠️ DATABASE_URL não definida — usando armazenamento em JSON local');
}

const app = express();
const PORT = process.env.PORT || 3001; // Usar PORT do Render ou 3001 local

// Dados em memória
let dadosImpacto = null;
let dadosPessoas = null;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir fotos estáticas (pasta public/fotos)
app.use('/fotos-aniversariantes', express.static(path.join(__dirname, '..', 'public', 'fotos')));

// Função para carregar dados de impacto
function carregarDadosImpacto() {
    try {
        const impactoPath = path.join(__dirname, 'data', 'impacto_mes_atual.json');
        if (fs.existsSync(impactoPath)) {
            const data = fs.readFileSync(impactoPath, 'utf8');
            dadosImpacto = JSON.parse(data);
            console.log('✅ Dados de impacto carregados:', dadosImpacto.metadata?.mes_nome_pt || 'N/A');
        } else {
            console.log('⚠️ impacto_mes_atual.json não encontrado');
        }
    } catch (error) {
        console.error('❌ Erro ao carregar impacto:', error);
    }
}

// Função para carregar dados de pessoas
function carregarDadosPessoas() {
    try {
        const pessoasPath = path.join(__dirname, 'data', 'csvjson.json');
        if (fs.existsSync(pessoasPath)) {
            const data = fs.readFileSync(pessoasPath, 'utf8');
            const rawData = JSON.parse(data);
            
            // Processar dados básicos
            dadosPessoas = {
                raw: rawData,
                total: rawData.length,
                centrosCusto: [...new Set(rawData.map(p => p['CENTRO DE CUSTO']))].sort(),
                empresas: [...new Set(rawData.map(p => p['EMPRESA']))].filter(Boolean),
                estados: [...new Set(rawData.map(p => p['ESTADO']))].filter(Boolean)
            };
            
            // Identificar datas disponíveis
            const firstRecord = rawData[0] || {};
            dadosPessoas.datas = Object.keys(firstRecord)
                .filter(key => key.match(/^\d{2}\/\d{2}$/))
                .sort((a, b) => {
                    const [dayA, monthA] = a.split('/').map(Number);
                    const [dayB, monthB] = b.split('/').map(Number);
                    if (monthA !== monthB) return monthB - monthA;
                    return dayB - dayA;
                });
            
            console.log(`✅ Dados de pessoas carregados: ${dadosPessoas.total} registros`);
            console.log(`📅 Datas disponíveis: ${dadosPessoas.datas.length} (${dadosPessoas.datas[0]} - ${dadosPessoas.datas[dadosPessoas.datas.length-1]})`);
            console.log(`🏢 Centros de custo: ${dadosPessoas.centrosCusto.join(', ')}`);
        } else {
            console.log('⚠️ csvjson.json não encontrado');
        }
    } catch (error) {
        console.error('❌ Erro ao carregar pessoas:', error);
    }
}

// Rota principal - status da API
app.get('/', (req, res) => {
    res.json({
        api: 'UTC POB/Standby API v2.0',
        status: 'OK',
        data: {
            impacto: dadosImpacto ? `Carregado (${dadosImpacto.metadata?.mes_nome_pt})` : 'Não carregado',
            pessoas: dadosPessoas ? `${dadosPessoas.total} registros, ${dadosPessoas.datas.length} datas` : 'Não carregado'
        },
        endpoints: {
                '/': 'Status da API',
                '/dados-impacto': 'Dados de impacto completos',
                '/dados-pessoas': 'Dados de pessoas completos',
                '/resumo': 'Resumo dos dados carregados',
                '/dados-por-data/:data': 'Dados de uma data específica',
                '/pob-filtrado': 'POB hoje + média mensal (310106->P-62 P, 310107->P-53 C, 310104->P-54 A)',
                '/standby-filtrado': 'Standby hoje + média mensal (310106->P-62, 310107->P-53, 310104->P-54) + filtro empresa UTC',
                '/aniversariantes': 'GET lista, POST adiciona (multipart/form-data, campo "foto" opcional), DELETE /aniversariantes/:ano/:mes/:dia/:nome',
                '/fotos-aniversariantes/:filename': 'Static - fotos dos aniversariantes (pasta public/fotos)',
                '/niver.html': 'Página administrativa (frontend) para gerenciar aniversariantes (list/add/remove)'
            },
        timestamp: new Date().toISOString()
    });
});

// Rota para dados de impacto
app.get('/dados-impacto', (req, res) => {
    if (!dadosImpacto) {
        return res.status(404).json({ error: 'Dados de impacto não carregados' });
    }
    res.json(dadosImpacto);
});

// Rota para dados de pessoas (raw)
app.get('/dados-pessoas', (req, res) => {
    if (!dadosPessoas) {
        return res.status(404).json({ error: 'Dados de pessoas não carregados' });
    }
    res.json(dadosPessoas);
});

// Rota para resumo dos dados
app.get('/resumo', (req, res) => {
    const resumo = {
        impacto: dadosImpacto ? {
            mes: dadosImpacto.metadata?.mes_nome_pt,
            totalEmbarcacoes: Object.keys(dadosImpacto.data || {}).length
        } : null,
        pessoas: dadosPessoas ? {
            total: dadosPessoas.total,
            centrosCusto: dadosPessoas.centrosCusto,
            datas: {
                total: dadosPessoas.datas.length,
                primeira: dadosPessoas.datas[dadosPessoas.datas.length-1],
                ultima: dadosPessoas.datas[0]
            }
        } : null
    };
    
    res.json(resumo);
});

// Rota para testar dados de uma data específica
app.get('/dados-por-data/:data', (req, res) => {
    const { data } = req.params;
    
    if (!dadosPessoas) {
        return res.status(404).json({ error: 'Dados de pessoas não carregados' });
    }
    
    if (!dadosPessoas.datas.includes(data)) {
        return res.status(400).json({ 
            error: `Data ${data} não encontrada`,
            datasDisponiveis: dadosPessoas.datas
        });
    }
    
    const dadosData = dadosPessoas.raw.map(pessoa => ({
        centroCusto: pessoa['CENTRO DE CUSTO'],
        empresa: pessoa['EMPRESA'],
        estado: pessoa['ESTADO'],
        valor: pessoa[data]
    })).filter(p => p.valor); // Só onde tem valor
    
    // Agrupar por valor
    const grupos = {};
    dadosData.forEach(p => {
        if (!grupos[p.valor]) grupos[p.valor] = [];
        grupos[p.valor].push(p);
    });
    
    res.json({
        data: data,
        total: dadosData.length,
        grupos: Object.keys(grupos).map(valor => ({
            valor: valor,
            quantidade: grupos[valor].length,
            pessoas: grupos[valor]
        }))
    });
});

// Endpoint para filtrar POB por centro de custo na última data + média mensal
app.get('/pob-filtrado', (req, res) => {
    if (!dadosPessoas) {
        return res.status(404).json({ error: 'Dados de pessoas não carregados' });
    }
    
    const ultimaData = dadosPessoas.datas[0]; // Primeira posição é a data mais recente
    
    if (!ultimaData) {
        return res.status(400).json({ error: 'Nenhuma data disponível' });
    }
    
    // Identificar mês atual (baseado na última data)
    const [dia, mes] = ultimaData.split('/');
    const mesAtual = mes;
    
    // Filtrar datas do mês atual
    const datasDoMes = dadosPessoas.datas.filter(data => {
        const [d, m] = data.split('/');
        return m === mesAtual;
    });
    
    // Definir mapeamento centro de custo -> valor esperado
    const filtros = {
        310106: 'P-62 P',
        310107: 'P-53 C', 
        310104: 'P-54 A'
    };
    
    const resultadosHoje = {};
    const resultadosMes = {};
    const totalGeralHoje = { encontrados: 0 };
    
    // Processar para cada centro de custo
    Object.keys(filtros).forEach(centroCusto => {
        const valorEsperado = filtros[centroCusto];
        
        // Filtrar pessoas do centro de custo específico
        const pessoasCentro = dadosPessoas.raw.filter(pessoa => 
            pessoa['CENTRO DE CUSTO'].toString() === centroCusto.toString()
        );
        
        // 1. DADOS DE HOJE (última data)
        const pessoasHoje = pessoasCentro.filter(pessoa => 
            pessoa[ultimaData] === valorEsperado
        );
        resultadosHoje[centroCusto] = pessoasHoje.length;
        totalGeralHoje.encontrados += pessoasHoje.length;
        
        // 2. MÉDIA DO MÊS
        const valoresTotaisMes = [];
        datasDoMes.forEach(data => {
            const pessoasNaData = pessoasCentro.filter(pessoa => 
                pessoa[data] === valorEsperado
            );
            valoresTotaisMes.push(pessoasNaData.length);
        });
        
        const mediaMes = valoresTotaisMes.length > 0 
            ? Math.round(valoresTotaisMes.reduce((a, b) => a + b, 0) / valoresTotaisMes.length)
            : 0;
            
        resultadosMes[centroCusto] = {
            media: mediaMes,
            diasCalculados: valoresTotaisMes.length,
            valores: valoresTotaisMes
        };
    });
    
    // Calcular média total do mês
    const mediaTotalMes = Math.round(
        (resultadosMes['310107']?.media || 0) +
        (resultadosMes['310104']?.media || 0) +
        (resultadosMes['310106']?.media || 0)
    );
    
    res.json({
        data: ultimaData,
        mes: `${mesAtual}/2025`,
        diasDoMes: datasDoMes.length,
        hoje: {
            'P-53 C': resultadosHoje['310107'] || 0,
            'P-54 A': resultadosHoje['310104'] || 0, 
            'P-62 P': resultadosHoje['310106'] || 0,
            total: totalGeralHoje.encontrados
        },
        media_mes: {
            'P-53 C': resultadosMes['310107']?.media || 0,
            'P-54 A': resultadosMes['310104']?.media || 0,
            'P-62 P': resultadosMes['310106']?.media || 0,
            total: mediaTotalMes
        }
    });
});

// Endpoint para filtrar Standby por centro de custo + empresa na última data + média mensal
app.get('/standby-filtrado', (req, res) => {
    if (!dadosPessoas) {
        return res.status(404).json({ error: 'Dados de pessoas não carregados' });
    }
    
    const ultimaData = dadosPessoas.datas[0]; // Primeira posição é a data mais recente
    
    if (!ultimaData) {
        return res.status(400).json({ error: 'Nenhuma data disponível' });
    }
    
    // Identificar mês atual (baseado na última data)
    const [dia, mes] = ultimaData.split('/');
    const mesAtual = mes;
    
    // Filtrar datas do mês atual
    const datasDoMes = dadosPessoas.datas.filter(data => {
        const [d, m] = data.split('/');
        return m === mesAtual;
    });
    
    // Definir mapeamento centro de custo -> plataforma
    const filtros = {
        310106: 'P-62',
        310107: 'P-53',
        310104: 'P-54'
    };
    
    // Empresas válidas para Standby
    const empresasValidas = [
        'UTC INTERNACIONAL - BASE NITEROI',
        'UTC INTERNACIONAL - BASE MACAE'
    ];
    
    const resultadosHoje = {};
    const resultadosMes = {};
    const totalGeralHoje = { encontrados: 0 };
    
    // Processar para cada centro de custo
    Object.keys(filtros).forEach(centroCusto => {
        const plataforma = filtros[centroCusto];
        
        // Filtrar pessoas do centro de custo específico + empresa válida
        const pessoasCentro = dadosPessoas.raw.filter(pessoa => 
            pessoa['CENTRO DE CUSTO'].toString() === centroCusto.toString() &&
            empresasValidas.includes(pessoa['EMPRESA'])
        );
        
        // 1. DADOS DE HOJE (última data) - filtrar "Stb"
        const pessoasHoje = pessoasCentro.filter(pessoa => 
            pessoa[ultimaData] === 'Stb'
        );
        resultadosHoje[centroCusto] = pessoasHoje.length;
        totalGeralHoje.encontrados += pessoasHoje.length;
        
        // 2. MÉDIA DO MÊS
        const valoresTotaisMes = [];
        datasDoMes.forEach(data => {
            const pessoasNaData = pessoasCentro.filter(pessoa => 
                pessoa[data] === 'Stb'
            );
            valoresTotaisMes.push(pessoasNaData.length);
        });
        
        const mediaMes = valoresTotaisMes.length > 0 
            ? Math.round(valoresTotaisMes.reduce((a, b) => a + b, 0) / valoresTotaisMes.length)
            : 0;
            
        resultadosMes[centroCusto] = {
            media: mediaMes,
            diasCalculados: valoresTotaisMes.length,
            valores: valoresTotaisMes
        };
    });
    
    // Calcular média total do mês
    const mediaTotalMes = Math.round(
        (resultadosMes['310107']?.media || 0) +
        (resultadosMes['310104']?.media || 0) +
        (resultadosMes['310106']?.media || 0)
    );
    
    res.json({
        data: ultimaData,
        mes: `${mesAtual}/2025`,
        diasDoMes: datasDoMes.length,
        hoje: {
            'P-53 Stb': resultadosHoje['310107'] || 0,
            'P-54 Stb': resultadosHoje['310104'] || 0, 
            'P-62 Stb': resultadosHoje['310106'] || 0,
            total: totalGeralHoje.encontrados
        },
        media_mes: {
            'P-53 Stb': resultadosMes['310107']?.media || 0,
            'P-54 Stb': resultadosMes['310104']?.media || 0,
            'P-62 Stb': resultadosMes['310106']?.media || 0,
            total: mediaTotalMes
        }
    });
});

// Inicializar dados e servidor
async function inicializar() {
    console.log('🚀 Inicializando UTC POB API v2.0...');
    
    carregarDadosImpacto();
    carregarDadosPessoas();
    
    app.listen(PORT, () => {
        console.log(`✅ Servidor rodando na porta ${PORT}`);
        console.log(`🌐 Acesse: http://localhost:${PORT}`);
    });
}

inicializar();

// =================== Endpoints de Aniversariantes (CRUD mínimo) ===================

// Config multer (salva em public/fotos)
const fotosDir = path.join(__dirname, '..', 'public', 'fotos');
if (!fs.existsSync(fotosDir)) fs.mkdirSync(fotosDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, fotosDir),
    filename: (req, file, cb) => {
        // nome vindo no campo 'nome' ou name do arquivo sem extensão
        const nomeBase = (req.body.nome || path.parse(file.originalname).name)
            .toLowerCase().replace(/\s+/g, '_');
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${nomeBase}${ext}`);
    }
});

const upload = multer({ storage });

const aniversariantesPath = path.join(__dirname, '..', 'public', 'aniversariantes.json');

function readAniversariantes() {
    if (!fs.existsSync(aniversariantesPath)) return {};
    try { return JSON.parse(fs.readFileSync(aniversariantesPath, 'utf8')); } catch (e) { return {}; }
}

function writeAniversariantes(obj) {
    fs.writeFileSync(aniversariantesPath, JSON.stringify(obj, null, 2));
}

// GET - listar (DB if available, else JSON file)
app.get('/aniversariantes', async (req, res) => {
    try {
        if (pool) {
            const { rows } = await pool.query('SELECT id, nome, cargo, setor, dia, mes, ano, foto_filename, foto_mime FROM aniversariantes ORDER BY ano DESC, mes DESC, dia DESC, nome');
            // Transform rows into the same nested structure expected by the frontend
            const out = {};
            rows.forEach(r => {
                const ano = String(r.ano);
                const mes = String(r.mes).padStart(2,'0');
                const dia = String(r.dia).padStart(2,'0');
                const meses = {
                    '01':'janeiro','02':'fevereiro','03':'março','04':'abril','05':'maio','06':'junho',
                    '07':'julho','08':'agosto','09':'setembro','10':'outubro','11':'novembro','12':'dezembro'
                };
                const nomeMes = meses[mes];
                if (!out[ano]) out[ano] = {};
                if (!out[ano][mes]) out[ano][mes] = {};
                if (!out[ano][mes][nomeMes]) out[ano][mes][nomeMes] = {};
                if (!out[ano][mes][nomeMes][dia]) out[ano][mes][nomeMes][dia] = [];
                out[ano][mes][nomeMes][dia].push({ nome: r.nome, cargo: r.cargo, setor: r.setor, foto: r.foto_filename, id: r.id });
            });
            return res.json(out);
        }
        const data = readAniversariantes();
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'erro ao ler aniversariantes' });
    }
});

// POST - adicionar (aceita multipart/form-data campo 'foto' OU JSON com fotoBase64 + fotoFilename)
app.post('/aniversariantes', upload.single('foto'), async (req, res) => {
    try {
        const body = req.body || {};
        const isJson = req.is('application/json');
        const nome = body.nome;
        const cargo = body.cargo || '';
        const setor = body.setor || '';
        const dia = body.dia;
        const mes = body.mes;
        const ano = body.ano;

        if (!nome || !dia || !mes || !ano) return res.status(400).json({ error: 'nome, dia, mes, ano obrigatórios' });

        // If DB available, insert there
        if (pool) {
            const fotoBase64 = isJson ? body.fotoBase64 : null;
            const fotoFilename = isJson ? body.fotoFilename : (req.file ? req.file.originalname : null);
            const fotoMime = isJson ? body.fotoMime : (req.file ? req.file.mimetype : null);
            const fotoBuffer = fotoBase64 ? Buffer.from(fotoBase64, 'base64') : (req.file ? fs.readFileSync(req.file.path) : null);

            const insertSql = `INSERT INTO aniversariantes (nome, cargo, setor, dia, mes, ano, foto_filename, foto_mime, foto) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, nome, cargo, setor, dia, mes, ano, foto_filename`;
            const params = [nome, cargo, setor, parseInt(dia), parseInt(mes), parseInt(ano), fotoFilename || null, fotoMime || null, fotoBuffer];
            const { rows } = await pool.query(insertSql, params);
            return res.json({ success: true, aniversariante: rows[0] });
        }

        // Fallback to JSON file storage
        const data = readAniversariantes();
        if (!data[ano]) data[ano] = {};
        if (!data[ano][mes]) data[ano][mes] = {};
        const meses = {
            '01':'janeiro','02':'fevereiro','03':'março','04':'abril','05':'maio','06':'junho',
            '07':'julho','08':'agosto','09':'setembro','10':'outubro','11':'novembro','12':'dezembro'
        };
        const nomeMes = meses[mes];
        if (!data[ano][mes][nomeMes]) data[ano][mes][nomeMes] = {};
        if (!data[ano][mes][nomeMes][dia]) data[ano][mes][nomeMes][dia] = [];

        let novo = { nome, cargo, setor };
        if (req.file) novo.foto = req.file.filename;
        else if (isJson && body.fotoBase64) { novo.fotoBase64 = body.fotoBase64; novo.foto = body.fotoFilename || `${nome.toLowerCase().replace(/\s+/g,'_')}.jpg`; }
        else novo.foto = `${nome.toLowerCase().replace(/\s+/g,'_')}.jpg`;

        data[ano][mes][nomeMes][dia].push(novo);
        writeAniversariantes(data);
        res.json({ success: true, aniversariante: novo });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'erro ao adicionar' });
    }
});

// DELETE - remover por nome/dia/mes/ano
app.delete('/aniversariantes/:ano/:mes/:dia/:nome', async (req, res) => {
    try {
        const { ano, mes, dia, nome } = req.params;
        if (pool) {
            // Delete by matching fields
            const delSql = 'DELETE FROM aniversariantes WHERE nome = $1 AND ano = $2 AND mes = $3 AND dia = $4 RETURNING id';
            const { rows } = await pool.query(delSql, [decodeURIComponent(nome), parseInt(ano), parseInt(mes), parseInt(dia)]);
            if (rows.length === 0) return res.status(404).json({ error: 'não encontrado' });
            return res.json({ success: true });
        }
        const data = readAniversariantes();
        const meses = {
            '01':'janeiro','02':'fevereiro','03':'março','04':'abril','05':'maio','06':'junho',
            '07':'julho','08':'agosto','09':'setembro','10':'outubro','11':'novembro','12':'dezembro'
        };
        const nomeMes = meses[mes];
        if (!data[ano] || !data[ano][mes] || !data[ano][mes][nomeMes] || !data[ano][mes][nomeMes][dia]) {
            return res.status(404).json({ error: 'não encontrado' });
        }
        const lista = data[ano][mes][nomeMes][dia];
        const nova = lista.filter(a => a.nome !== nome);
        data[ano][mes][nomeMes][dia] = nova;
        if (nova.length === 0) delete data[ano][mes][nomeMes][dia];
        writeAniversariantes(data);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'erro ao remover' });
    }
});

// GET - servir foto do aniversariante (bytea) pelo id
app.get('/aniversariantes/:id/foto', async (req, res) => {
    try {
        const { id } = req.params;
        if (!pool) return res.status(400).json({ error: 'Banco não configurado para servir fotos por id' });
        const { rows } = await pool.query('SELECT foto, foto_mime, foto_filename FROM aniversariantes WHERE id = $1', [parseInt(id)]);
        if (!rows[0]) return res.status(404).json({ error: 'Não encontrado' });
        const r = rows[0];
        if (!r.foto) return res.status(404).json({ error: 'Foto não disponível' });
        const mime = r.foto_mime || 'image/jpeg';
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `inline; filename="${r.foto_filename || 'foto'}"`);
        return res.send(r.foto);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'erro ao obter foto' });
    }
});