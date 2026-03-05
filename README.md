# Fiber AI MCP Server

Servidor MCP (Model Context Protocol) que expone los endpoints de búsqueda de Fiber AI como herramientas (tools) para que cualquier agente o cliente MCP pueda consumirlos.

## Tools incluidas

### Search
| Tool | Endpoint | Descripción |
|------|----------|-------------|
| `company_search` | POST /v1/company-search | Buscar empresas con filtros avanzados |
| `company_count` | POST /v1/company-count | Contar empresas que coinciden con filtros |
| `investor_search` | POST /v1/investor-search | Buscar inversores |
| `investment_search` | POST /v1/investment-search | Buscar rondas de inversión |
| `people_search` | POST /v1/people-search | Buscar personas/perfiles |
| `people_search_count` | POST /v1/people-search/count | Contar personas que coinciden |
| `combined_search_start` | POST /v1/combined-search/start | Iniciar búsqueda combinada (async) |
| `combined_search_sync` | POST /v1/combined-search/sync | Búsqueda combinada síncrona |
| `combined_search_poll` | POST /v1/combined-search/poll | Obtener resultados de búsqueda combinada |

### Google Maps
| Tool | Endpoint | Descripción |
|------|----------|-------------|
| `google_maps_search_start` | POST /v1/google-maps-search/start | Iniciar búsqueda en Google Maps |
| `google_maps_search_check` | POST /v1/google-maps-search/check | Comprobar progreso |
| `google_maps_search_poll` | POST /v1/google-maps-search/poll | Obtener resultados |

## Requisitos previos

- Node.js >= 20
- Una API Key de Fiber AI (https://fiber.ai/app/api)
- Una cuenta en [Railway](https://railway.app)
- (Opcional) Cuenta en Portkey para la integración

---

## Despliegue en Railway

### Opción A: Desde un repo de GitHub (recomendado)

1. **Sube este proyecto a un repo de GitHub:**
   ```bash
   cd fiber-mcp-server
   git init
   git add .
   git commit -m "Initial commit - Fiber AI MCP Server"
   git remote add origin https://github.com/TU_USUARIO/fiber-mcp-server.git
   git push -u origin main
   ```

2. **En Railway (https://railway.app):**
   - Crea un nuevo proyecto → "Deploy from GitHub Repo"
   - Selecciona tu repo `fiber-mcp-server`
   - Railway detectará automáticamente el Dockerfile

3. **Configura las variables de entorno en Railway:**
   - Ve a tu servicio → Settings → Variables
   - Añade:
     - `FIBER_API_KEY` = tu clave API de Fiber AI
     - `PORT` = `3000` (Railway normalmente lo setea automáticamente)

4. **Genera un dominio público:**
   - Ve a Settings → Networking → "Generate Domain"
   - Obtendrás algo como: `fiber-mcp-server-production-xxxx.up.railway.app`

5. **Verifica que funciona:**
   ```bash
   curl https://TU-DOMINIO.up.railway.app/health
   # Debería devolver: {"status":"healthy","timestamp":"..."}
   ```

### Opción B: Usando Railway CLI

```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login
railway login

# Crear proyecto y desplegar
railway init
railway up

# Configurar variable de entorno
railway variables set FIBER_API_KEY=tu_clave_aqui

# Ver dominio
railway domain
```

---

## Conexión desde Portkey

Una vez desplegado en Railway, tu servidor MCP está accesible via HTTP en:

```
https://TU-DOMINIO.up.railway.app/mcp
```

### Configuración en Portkey

En la configuración de Portkey, cuando quieras añadir este MCP server como herramienta disponible para tus agentes, necesitas configurarlo como un **MCP server remoto (Streamable HTTP)**:

```json
{
  "mcp_servers": [
    {
      "type": "url",
      "url": "https://TU-DOMINIO.up.railway.app/mcp",
      "name": "fiber-ai-search"
    }
  ]
}
```

Si usas Portkey con la API de Anthropic (o cualquier otro proveedor compatible con MCP), el agente podrá invocar directamente las tools de Fiber AI.

### Ejemplo de uso con Portkey + Anthropic API

```python
from portkey_ai import Portkey

client = Portkey(
    api_key="TU_PORTKEY_API_KEY",
    virtual_key="TU_ANTHROPIC_VIRTUAL_KEY",
)

response = client.chat.completions.create(
    model="claude-sonnet-4-20250514",
    messages=[
        {
            "role": "user",
            "content": "Busca empresas SaaS en España con más de 50 empleados"
        }
    ],
    # Las tools del MCP se descubren automáticamente
    # si has configurado el MCP server en Portkey
)
```

---

## Desarrollo local

```bash
# Instalar dependencias
npm install

# Crear archivo .env
cp .env.example .env
# Editar .env con tu FIBER_API_KEY

# Ejecutar en modo desarrollo
npm run dev

# O compilar y ejecutar
npm run build
npm start
```

### Probar el servidor localmente

```bash
# Health check
curl http://localhost:3000/health

# Inicializar sesión MCP y listar tools
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": { "name": "test", "version": "1.0.0" }
    }
  }'
```

---

## Estructura del proyecto

```
fiber-mcp-server/
├── src/
│   └── index.ts          # Servidor MCP principal
├── Dockerfile            # Para despliegue en Railway
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

## Arquitectura

```
┌─────────────┐     ┌──────────────────────┐     ┌──────────────┐
│   Portkey    │────▶│  MCP Server (Railway) │────▶│  Fiber AI    │
│   / Agent   │◀────│  Express + MCP SDK    │◀────│  API         │
└─────────────┘     └──────────────────────┘     └──────────────┘
                    Streamable HTTP Transport
```

El servidor recibe peticiones MCP via Streamable HTTP, extrae los parámetros de cada tool call, inyecta la `FIBER_API_KEY` del entorno, y reenvía la petición a la API de Fiber AI. Los resultados se devuelven como texto JSON al agente.
