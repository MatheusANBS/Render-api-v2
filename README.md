# UTC POB/Standby API v2.0

API simplificada para consulta de dados POB (People on Board) e Standby da UTC Internacional.

## Endpoints Disponíveis

### 📊 Status e Informações
- `GET /` - Status geral da API
- `GET /resumo` - Resumo dos dados carregados

### 📋 Dados Brutos
- `GET /dados-impacto` - Dados completos de impacto
- `GET /dados-pessoas` - Dados completos de pessoas
- `GET /dados-por-data/:data` - Dados de uma data específica (formato: dd/mm)

### 🚢 POB (People on Board)
- `GET /pob-filtrado` - POB atual + média mensal
  - **310106** → P-62 P
  - **310107** → P-53 C  
  - **310104** → P-54 A

### 🏠 Standby
- `GET /standby-filtrado` - Standby atual + média mensal
  - **310106** → P-62 Stb
  - **310107** → P-53 Stb
  - **310104** → P-54 Stb
  - Filtro: Apenas empresas UTC INTERNACIONAL - BASE NITEROI/MACAE

## Exemplo de Resposta

### POB Filtrado
```json
{
  "data": "09/10",
  "mes": "10/2025",
  "diasDoMes": 9,
  "hoje": {
    "P-53 C": 336,
    "P-54 A": 56,
    "P-62 P": 334,
    "total": 726
  },
  "media_mes": {
    "P-53 C": 330,
    "P-54 A": 52,
    "P-62 P": 328,
    "total": 710
  }
}
```

### Standby Filtrado
```json
{
  "data": "09/10",
  "mes": "10/2025", 
  "diasDoMes": 9,
  "hoje": {
    "P-53 Stb": 45,
    "P-54 Stb": 12,
    "P-62 Stb": 38,
    "total": 95
  },
  "media_mes": {
    "P-53 Stb": 42,
    "P-54 Stb": 15,
    "P-62 Stb": 35,
    "total": 92
  }
}
```

## Tecnologias

- Node.js
- Express.js
- CORS habilitado

## Deploy

Configurado para deploy automático no Render.com