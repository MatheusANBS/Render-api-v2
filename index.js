const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001; // Usar PORT do Render ou 3001 local

// Dados em memória
let dadosImpacto = null;
let dadosPessoas = null;

// Middlewares
app.use(cors());
app.use(express.json());

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
            '/standby-filtrado': 'Standby hoje + média mensal (310106->P-62, 310107->P-53, 310104->P-54) + filtro empresa UTC'
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