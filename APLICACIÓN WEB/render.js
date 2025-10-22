// Sistema de renderizado de mapas con canvas

const statusText = document.getElementById('statusText');

let map1Data = { restaurantes: {}, casas: {} };
let map2Data = { repartidores: {} };

// Estados para algoritmos de scheduling
let restaurantStates = {};

const flechas = { 'U': '↑', 'D': '↓', 'L': '←', 'R': '→' };
function obtenerFlechaTexto(dir) {
    return flechas[dir?.toUpperCase()] || '↑';
}

// Mapa de edificios 7x7
class Map1Renderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.gridSize = 7;
        this.cellSize = 90;
        
        this.canvas.width = this.canvas.height = this.gridSize * this.cellSize;
        this.windows = this.generateWindows();
        
        this.colors = {
            restaurant: '#e74c3c',
            house: '#3498db',
            normal: '#34495e',
            window: '#f39c12',
            windowOff: '#2c3e50'
        };
    }
    
    // Genera patrón de ventanas aleatorio
    generateWindows() {
        const windows = {};
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                windows[`${x}-${y}`] = Array.from({length: 12}, () => Math.random() > 0.3);
            }
        }
        return windows;
    }
    
    // Dibuja edificio con color dinámico
    drawBuilding(x, y, type = 'normal', direccion = null, restaurantId = null) {
        const px = x * this.cellSize;
        const py = y * this.cellSize;
        const margin = 2;
        const size = this.cellSize - margin * 2;
        
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        this.ctx.shadowBlur = 15;
        this.ctx.shadowOffsetX = 3;
        this.ctx.shadowOffsetY = 3;
        
        // Color según estado del restaurante
        let buildingColor = this.colors[type];
        
        if (type === 'restaurant' && restaurantId) {
            const estado = restaurantStates[restaurantId] || 'NORMAL';
            buildingColor = estado === 'CARGADO' ? '#2bff00ff' : '#e74c3c';
        }
        
        this.ctx.fillStyle = buildingColor;
        this.ctx.fillRect(px + margin, py + margin, size, size);
        this.ctx.shadowBlur = 0;
        
        if (type === 'restaurant' || type === 'house') {
            const letra = type === 'restaurant' ? 'R' : 'H';
            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 32px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            const centerX = px + this.cellSize/2;
            const centerY = py + this.cellSize/2;
            this.ctx.fillText(letra, centerX, centerY - 8);
            
            this.ctx.font = 'bold 24px Arial';
            this.ctx.fillText(obtenerFlechaTexto(direccion), centerX, centerY + 22);
        } else {
            this.ctx.fillStyle = '#2c3e50';
            this.ctx.fillRect(px + margin, py + margin, size, 8);
            
            const windowSize = 6;
            const spacing = 12;
            const pattern = this.windows[`${x}-${y}`];
            
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 4; col++) {
                    const idx = row * 4 + col;
                    const wx = px + margin + 10 + col * spacing;
                    const wy = py + margin + 15 + row * spacing;
                    
                    this.ctx.fillStyle = pattern[idx] ? this.colors.window : this.colors.windowOff;
                    this.ctx.fillRect(wx, wy, windowSize, windowSize);
                }
            }
        }
        
        this.ctx.strokeStyle = '#555';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(px + margin, py + margin, size, size);
    }
    
    // Dibuja grid completo
    draw() {
        this.ctx.fillStyle = '#0a0a15';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                this.drawBuilding(x, y, 'normal');
            }
        }
    }
}

// Mapa de repartidores 15x15
class Map2Renderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.gridSize = 15;
        this.cellSize = 40;
        
        this.canvas.width = this.canvas.height = this.gridSize * this.cellSize;
        this.canvas.style.width = '100%';
        this.canvas.style.height = 'auto';
        
        this.driverStates = {};
    }
    
    // Dibuja calles con líneas
    drawStreets() {
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.strokeStyle = '#ffeaa7';
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([8, 6]);
        
        for (let i = 0; i <= this.gridSize; i++) {
            const pos = i * this.cellSize;
            this.ctx.beginPath();
            this.ctx.moveTo(pos, 0);
            this.ctx.lineTo(pos, this.canvas.height);
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.moveTo(0, pos);
            this.ctx.lineTo(this.canvas.width, pos);
            this.ctx.stroke();
        }
        
        this.ctx.setLineDash([]);
    }
    
    // Dibuja repartidor con color según estado
    drawDriver(x, y, driverId = null) {
        const px = x * this.cellSize + this.cellSize / 2;
        const py = y * this.cellSize + this.cellSize / 2;
        const radius = 12;
        
        let glowColor, fillColor;
        const estado = this.driverStates[driverId] || 'DESOCUPADO';
        
        switch(estado) {
            case 'EN_CAMINO_A_RESTAURANTE':
                glowColor = 'rgba(231, 76, 60, 0.9)';
                fillColor = '#e74c3c';
                break;
            case 'RECOGIENDO':
                glowColor = 'rgba(230, 126, 34, 0.9)';
                fillColor = '#e67e22';
                break;
            case 'EN_CAMINO_A_DESTINO':
                glowColor = 'rgba(52, 152, 219, 0.9)';
                fillColor = '#3498db';
                break;
            case 'ENTREGANDO':
                glowColor = 'rgba(46, 204, 113, 0.9)';
                fillColor = '#2ecc71';
                break;
            case 'DESOCUPADO':
            default:
                glowColor = 'rgba(241, 196, 15, 0.9)';
                fillColor = '#f1c40f';
        }
        
        this.ctx.fillStyle = glowColor;
        this.ctx.beginPath();
        this.ctx.arc(px, py, radius + 4, 0, Math.PI * 2);
        this.ctx.fill();
        
        this.ctx.fillStyle = fillColor;
        this.ctx.beginPath();
        this.ctx.arc(px, py, radius, 0, Math.PI * 2);
        this.ctx.fill();
        
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('P', px, py);
    }
    
    // Actualiza estado del repartidor
    setDriverState(driverId, estado) {
        this.driverStates[driverId] = estado;
    }
    
    // Dibuja mapa base
    draw() {
        this.ctx.fillStyle = '#0a0a15';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawStreets();
    }
}

// Mapa unificado 15x15
class Map3Renderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.gridSize = 15;
        this.cellSize = 50;
        
        this.canvas.width = this.canvas.height = this.gridSize * this.cellSize;
        this.windows = this.generateWindows();
        this.hoveredCell = null;
        this.routePath = null;
        
        this.halfCell = this.cellSize / 2;
        
        this.driverStates = {};
    }
    
    // Genera patrón de ventanas
    generateWindows() {
        const windows = {};
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                windows[`${x}-${y}`] = Array.from({length: 12}, () => Math.random() > 0.3);
            }
        }
        return windows;
    }
    
    // Dibuja calles con líneas punteadas
    drawRoads() {
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const px = x * this.cellSize;
                const py = y * this.cellSize;
                const color = (y % 2 === 0 || x % 2 === 0) ? '#2d2d2d' : '#0a0a15';
                this.ctx.fillStyle = color;
                this.ctx.fillRect(px, py, this.cellSize, this.cellSize);
            }
        }
        
        this.ctx.strokeStyle = '#ffeaa7';
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([10, 8]);
        
        for (let y = 0; y < this.gridSize; y += 2) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y * this.cellSize + this.halfCell);
            this.ctx.lineTo(this.canvas.width, y * this.cellSize + this.halfCell);
            this.ctx.stroke();
        }
        
        for (let x = 0; x < this.gridSize; x += 2) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * this.cellSize + this.halfCell, 0);
            this.ctx.lineTo(x * this.cellSize + this.halfCell, this.canvas.height);
            this.ctx.stroke();
        }
        
        this.ctx.setLineDash([]);
    }
    
    // Dibuja celda con color según tipo
    drawCell(x, y, char, direccion = null, isHighlighted = false, driverId = null, restaurantId = null) {
        const px = x * this.cellSize;
        const py = y * this.cellSize;
        const margin = 2;
        const size = this.cellSize - margin * 2;
        const isRoad = (y % 2 === 0) || (x % 2 === 0);
        
        if (isRoad && char !== 'P') return;
        
        if (isRoad && char === 'P') {
            let glowColor, fillColor;
            const estado = this.driverStates[driverId] || 'DESOCUPADO';
            
            switch(estado) {
                case 'EN_CAMINO_A_RESTAURANTE':
                    glowColor = 'rgba(231, 76, 60, 0.9)';
                    fillColor = '#e74c3c';
                    break;
                case 'RECOGIENDO':
                    glowColor = 'rgba(230, 126, 34, 0.9)';
                    fillColor = '#e67e22';
                    break;
                case 'EN_CAMINO_A_DESTINO':
                    glowColor = 'rgba(52, 152, 219, 0.9)';
                    fillColor = '#3498db';
                    break;
                case 'ENTREGANDO':
                    glowColor = 'rgba(46, 204, 113, 0.9)';
                    fillColor = '#2ecc71';
                    break;
                case 'DESOCUPADO':
                default:
                    glowColor = 'rgba(241, 196, 15, 0.9)';
                    fillColor = '#f1c40f';
            }
            
            this.ctx.fillStyle = glowColor;
            this.ctx.beginPath();
            this.ctx.arc(px + this.halfCell, py + this.halfCell, 12, 0, Math.PI * 2);
            this.ctx.fill();
            
            this.ctx.fillStyle = fillColor;
            this.ctx.beginPath();
            this.ctx.arc(px + this.halfCell, py + this.halfCell, 9, 0, Math.PI * 2);
            this.ctx.fill();
            
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = 'bold 10px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText('P', px + this.halfCell, py + this.halfCell);
            
            return;
        }
        
        if (isHighlighted) {
            this.ctx.shadowColor = 'rgba(139, 69, 255, 0.8)';
            this.ctx.shadowBlur = 20;
        } else {
            this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            this.ctx.shadowBlur = 8;
            this.ctx.shadowOffsetX = 2;
            this.ctx.shadowOffsetY = 2;
        }
        
        // Color dinámico para restaurantes
        let colors = { 'H': '#3498db' };
        
        if (char === 'R' && restaurantId) {
            const estado = restaurantStates[restaurantId] || 'NORMAL';
            colors['R'] = estado === 'CARGADO' ? '#2bff00ff' : '#e74c3c';
        } else if (char === 'R') {
            colors['R'] = '#e74c3c';
        }
        
        this.ctx.fillStyle = colors[char] || '#34495e';
        this.ctx.fillRect(px + margin, py + margin, size, size);
        this.ctx.shadowBlur = 0;
        
        if (char === 'R' || char === 'H') {
            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 14px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(char, px + this.halfCell, py + this.halfCell - 3);
            
            this.ctx.font = 'bold 12px Arial';
            this.ctx.fillText(obtenerFlechaTexto(direccion), px + this.halfCell, py + this.halfCell + 13);
        } else {
            const windowSize = 3;
            const spacing = 6;
            const pattern = this.windows[`${x}-${y}`];
            
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 4; col++) {
                    const idx = row * 4 + col;
                    const wx = px + margin + 5 + col * spacing;
                    const wy = py + margin + 5 + row * spacing;
                    
                    this.ctx.fillStyle = pattern[idx] ? '#f39c12' : '#2c3e50';
                    this.ctx.fillRect(wx, wy, windowSize, windowSize);
                }
            }
        }
        
        this.ctx.strokeStyle = isHighlighted ? '#a78bfa' : '#555';
        this.ctx.lineWidth = isHighlighted ? 3 : 0.5;
        this.ctx.strokeRect(px + margin, py + margin, size, size);
    }
    
    // Actualiza estado del repartidor
    setDriverState(driverId, estado) {
        this.driverStates[driverId] = estado;
    }
    
    // Dibuja ruta del repartidor
    drawRoute(route, driverId) {
        if (!route || route.length < 2) return;
        
        const estado = this.driverStates[driverId] || 'DESOCUPADO';
        
        let routeColor;
        switch(estado) {
            case 'EN_CAMINO_A_RESTAURANTE':
                routeColor = 'rgba(231, 76, 60, 0.6)';
                break;
            case 'EN_CAMINO_A_DESTINO':
                routeColor = 'rgba(52, 152, 219, 0.6)';
                break;
            default:
                routeColor = 'rgba(241, 196, 15, 0.6)';
        }
        
        this.ctx.strokeStyle = routeColor;
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([10, 5]);
        this.ctx.lineCap = 'round';
        this.ctx.shadowColor = routeColor;
        this.ctx.shadowBlur = 8;
        
        this.ctx.beginPath();
        
        for (let i = 0; i < route.length; i++) {
            const point = route[i];
            const px = point.x * this.cellSize + this.halfCell;
            const py = point.y * this.cellSize + this.halfCell;
            
            if (i === 0) {
                this.ctx.moveTo(px, py);
            } else {
                this.ctx.lineTo(px, py);
            }
        }
        
        this.ctx.stroke();
        
        this.ctx.setLineDash([]);
        this.ctx.shadowBlur = 0;
        
        this.ctx.fillStyle = routeColor;
        
        for (let i = 1; i < route.length - 1; i += 3) {
            const point = route[i];
            const px = point.x * this.cellSize + this.halfCell;
            const py = point.y * this.cellSize + this.halfCell;
            
            this.ctx.beginPath();
            this.ctx.arc(px, py, 2, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }
    
    // Dibuja mapa base
    draw() {
        this.drawRoads();
        
        for (let y = 1; y < this.gridSize; y += 2) {
            for (let x = 1; x < this.gridSize; x += 2) {
                this.drawCell(x, y, '0');
            }
        }
    }
}

// Inicializa los tres mapas
const map1 = new Map1Renderer('map1Canvas');
const map2 = new Map2Renderer('map2Canvas');
const map3 = new Map3Renderer('map3Canvas');

window.map3 = map3;

map1.draw();
map2.draw();
map3.draw();

// Redibuja todos los mapas
function redrawAll() {
    map1.draw();
    
    // Restaurantes con ID para color dinámico
    for (let id in map1Data.restaurantes) {
        const r = map1Data.restaurantes[id];
        map1.drawBuilding(r.av - 1, 6 - (r.ca - 1), 'restaurant', r.dir, id);
    }
    
    // Casas
    for (let id in map1Data.casas) {
        const h = map1Data.casas[id];
        map1.drawBuilding(h.av - 1, 6 - (h.ca - 1), 'house', h.dir);
    }
    
    map2.draw();
    
    // Repartidores con ID
    for (let id in map2Data.repartidores) {
        const d = map2Data.repartidores[id];
        const x = d.av - 1;
        const y = 14 - (d.ca - 1);
        map2.drawDriver(x, y, parseInt(id));
    }
    
    map3.draw();
    
    const ocupadas3 = {};
    
    // Mapear restaurantes a grid 15x15
    for (let id in map1Data.restaurantes) {
        const r = map1Data.restaurantes[id];
        const x3 = (r.av - 1) * 2 + 1;
        const y3 = (6 - (r.ca - 1)) * 2 + 1;
        ocupadas3[`${x3}-${y3}`] = { tipo: 'R', dir: r.dir, restaurantId: id };
    }
    
    // Mapear casas
    for (let id in map1Data.casas) {
        const h = map1Data.casas[id];
        const x3 = (h.av - 1) * 2 + 1;
        const y3 = (6 - (h.ca - 1)) * 2 + 1;
        const key = `${x3}-${y3}`;
        if (!ocupadas3[key]) {
            ocupadas3[key] = { tipo: 'H', dir: h.dir };
        }
    }
    
    // Mapear repartidores
    for (let id in map2Data.repartidores) {
        const d = map2Data.repartidores[id];
        const x3 = d.av - 1;
        const y3 = 14 - (d.ca - 1);
        const key = `${x3}-${y3}`;
        if (!ocupadas3[key]) {
            ocupadas3[key] = { tipo: 'P', dir: null, driverId: parseInt(id) };
        }
    }
    
    // Dibujar celdas con highlighting
    for (let key in ocupadas3) {
        const [x, y] = key.split('-').map(Number);
        const obj = ocupadas3[key];
        
        // Iluminar celda bajo cursor
        let isHighlighted = map3.hoveredCell && map3.hoveredCell.x === x && map3.hoveredCell.y === y;
        
        // Iluminar restaurante seleccionado
        if (selectedRestaurant && obj.tipo === 'R' && obj.restaurantId == selectedRestaurant.id) {
            isHighlighted = true;
        }
        
        // Iluminar casa seleccionada
        if (selectedDestination && obj.tipo === 'H') {
            const houseAv = (x - 1) / 2 + 1;
            const houseCa = 7 - ((y - 1) / 2);
            if (houseAv === selectedDestination.av && houseCa === selectedDestination.ca) {
                isHighlighted = true;
            }
        }
        
        map3.drawCell(x, y, obj.tipo, obj.dir, isHighlighted, obj.driverId, obj.restaurantId);
    }
    
    // Dibujar rutas
    if (typeof driverRoutes !== 'undefined') {
        for (let [driverId, route] of driverRoutes) {
            map3.drawRoute(route, parseInt(driverId));
        }
    }
    
    // Actualizar tablas
    if (typeof updateAllInfoTables === 'function') {
        updateAllInfoTables();
    }
}

// Cursor pointer en mapa 3
map3.canvas.style.cursor = 'pointer';

// Hover en mapa 3
let mouseMoveTimeout;
map3.canvas.addEventListener('mousemove', (event) => {
    if (mouseMoveTimeout) return;
    
    mouseMoveTimeout = setTimeout(() => {
        const rect = map3.canvas.getBoundingClientRect();
        const gridX = Math.floor((event.clientX - rect.left) / map3.cellSize);
        const gridY = Math.floor((event.clientY - rect.top) / map3.cellSize);
        
        if (gridX % 2 === 1 && gridY % 2 === 1) {
            if (!map3.hoveredCell || map3.hoveredCell.x !== gridX || map3.hoveredCell.y !== gridY) {
                map3.hoveredCell = { x: gridX, y: gridY };
                redrawAll();
            }
        } else if (map3.hoveredCell) {
            map3.hoveredCell = null;
            redrawAll();
        }
        
        mouseMoveTimeout = null;
    }, 16);
});

// Limpiar hover al salir
map3.canvas.addEventListener('mouseleave', () => {
    if (map3.hoveredCell) {
        map3.hoveredCell = null;
        redrawAll();
    }
});

// Clicks en mapa 3
map3.canvas.addEventListener('click', (event) => {
    const rect = map3.canvas.getBoundingClientRect();
    const gridX = Math.floor((event.clientX - rect.left) / map3.cellSize);
    const gridY = Math.floor((event.clientY - rect.top) / map3.cellSize);
    
    if (gridX % 2 === 1 && gridY % 2 === 1) {
        const av = ((gridX - 1) / 2) + 1;
        const ca = 7 - ((gridY - 1) / 2);
        
        let foundRestaurant = null;
        for (let id in map1Data.restaurantes) {
            const r = map1Data.restaurantes[id];
            if (r.av === av && r.ca === ca) {
                foundRestaurant = { id, ...r };
                break;
            }
        }
        
        let foundHouse = null;
        for (let id in map1Data.casas) {
            const h = map1Data.casas[id];
            if (h.av === av && h.ca === ca) {
                foundHouse = { id, ...h };
                break;
            }
        }
        
        if (foundRestaurant) {
            window.dispatchEvent(new CustomEvent('mapRestaurantClick', {
                detail: { restaurant: foundRestaurant, av, ca }
            }));
        } else if (foundHouse) {
            window.dispatchEvent(new CustomEvent('mapHouseClick', {
                detail: { house: foundHouse, av, ca }
            }));
        }
    }
});

// Conexión WebSocket con servidor bridge
let ws = new WebSocket('ws://localhost:8081');
window.ws = ws;

ws.onopen = () => {
    statusText.textContent = 'Conectado - Esperando STM32';
};

// Procesa mensajes del STM32
ws.onmessage = (e) => {
    try {
        const msg = JSON.parse(e.data);
        
        if (msg.type === 'stm32_data') {
            const txt = msg.data;
            
            if (txt.startsWith('MAPA:') || !txt.trim().startsWith('{')) return;
            
            const json = JSON.parse(txt);
            
            // Procesar solicitud de pedido automático
            if (json.type === 'auto_order_request' && window.processAutoOrderRequest) {
                console.log('📨 Recibida solicitud de pedido automático del STM32');
                window.processAutoOrderRequest(json.restId, json.destId, json.dishes);
                return;
            }
            
            // Recargar página
            if (json.type === 'regenerate') {
                console.log('✅ Mapa completo recibido - Recargando página...');
                setTimeout(() => {
                    location.reload();
                }, 1000);
                return;
            }
            
            // Capturar métricas individuales
            if (json.type === 'metrics' && window.handleMetricsData) {
                window.handleMetricsData(json);
                return;
            }
            
            // Capturar histórico
            if (json.type === 'history' && window.handleHistoryData) {
                window.handleHistoryData(json);
                return;
            }
            
            // Capturar métricas globales del STM32
            if (json.type === 'global_metrics' && window.handleGlobalMetrics) {
                window.handleGlobalMetrics(json);
                return;
            }
            
            // Regenerar mapa completo
            if (json.type === 'map') {
                map1Data = { restaurantes: {}, casas: {} };
                map2Data = { repartidores: {} };
                restaurantStates = {};
                
                // Limpiar métricas
                if (window.clearMetrics) {
                    window.clearMetrics();
                }
                
                // Resetear contador
                totalOrdersCreated = 0;
                
                redrawAll();
            }
            
            // Agregar restaurante
            if (json.type === 'restaurante') {
                for (let id in map1Data.casas) {
                    if (map1Data.casas[id].av === json.av && map1Data.casas[id].ca === json.ca) {
                        delete map1Data.casas[id];
                        break;
                    }
                }
                map1Data.restaurantes[json.id] = {av: json.av, ca: json.ca, dir: json.dir || 'U'};
                redrawAll();
            }
            
            // Agregar casa
            if (json.type === 'casa') {
                for (let id in map1Data.restaurantes) {
                    if (map1Data.restaurantes[id].av === json.av && map1Data.restaurantes[id].ca === json.ca) {
                        delete map1Data.restaurantes[id];
                        break;
                    }
                }
                for (let id in map1Data.casas) {
                    if (map1Data.casas[id].av === json.av && map1Data.casas[id].ca === json.ca) {
                        delete map1Data.casas[id];
                    }
                }
                map1Data.casas[json.id] = {av: json.av, ca: json.ca, dir: json.dir || 'u'};
                redrawAll();
            }
            
            // Agregar repartidor
            if (json.type === 'repartidor') {
                map2Data.repartidores[json.id] = {av: json.av, ca: json.ca};
                redrawAll();
            }
            
            // Agregar menú de restaurante
            if (json.type === 'menu' && window.addRestaurantMenu) {
                window.addRestaurantMenu(json.restaurantId, json.dishId, json.nombre, json.tiempo);
            }

            // Completar información de pedido automático
            if (json.type === 'auto_order' && window.completeAutoOrder) {
                window.completeAutoOrder(json.order, json.restId, json.destId, json.dishes);
            }

            // Procesar evento de pedido
            if (json.type === 'event' && window.handleSTM32OrderEvent) {
                window.handleSTM32OrderEvent(json.ev, json.order, json.driver, json.prepTime);
            }

            // Actualizar estado de restaurante
            if (json.type === 'restaurant_status') {
                restaurantStates[json.id] = json.status;
                redrawAll();
            }

            // Actualizar movimiento de repartidor
            if (json.type === 'mov') {
                map2Data.repartidores[json.rep] = {av: json.av, ca: json.ca};
                
                if (json.estado) {
                    map2.setDriverState(json.rep, json.estado);
                    map3.setDriverState(json.rep, json.estado);
                }
                
                // Simular ruta visual del repartidor
                if (json.estado === 'EN_CAMINO_A_RESTAURANTE' || json.estado === 'EN_CAMINO_A_DESTINO') {
                    const currentPos = {
                        x: json.av - 1,
                        y: 14 - (json.ca - 1)
                    };
                    
                    let targetPos = null;
                    
                    // Buscar destino del pedido
                    for (let order of activeOrders) {
                        if (order.repartidorId == json.rep && !order.entregado) {
                            if (json.estado === 'EN_CAMINO_A_RESTAURANTE' && order.restaurant) {
                                const rest = map1Data.restaurantes[order.restaurant.id];
                                if (rest) {
                                    targetPos = {
                                        x: (rest.av - 1) * 2 + 1,
                                        y: (6 - (rest.ca - 1)) * 2 + 1
                                    };
                                }
                            } else if (json.estado === 'EN_CAMINO_A_DESTINO' && order.destination) {
                                const house = map1Data.casas[order.destination.id];
                                if (house) {
                                    targetPos = {
                                        x: (house.av - 1) * 2 + 1,
                                        y: (6 - (house.ca - 1)) * 2 + 1
                                    };
                                }
                            }
                            break;
                        }
                    }
                    
                    // Crear ruta visual interpolada
                    if (targetPos) {
                        const route = [];
                        const steps = 20;
                        
                        for (let i = 0; i <= steps; i++) {
                            const t = i / steps;
                            route.push({
                                x: currentPos.x + (targetPos.x - currentPos.x) * t,
                                y: currentPos.y + (targetPos.y - currentPos.y) * t
                            });
                        }
                        
                        driverRoutes.set(json.rep, route);
                    }
                } else {
                    // Limpiar ruta si no está en movimiento
                    driverRoutes.delete(json.rep);
                }
                
                redrawAll();
            }
        }
    } catch (err) {
        console.error('Error:', err);
    }
};

ws.onerror = () => {
    statusText.textContent = 'Error de conexion';
};

ws.onclose = () => {
    statusText.textContent = 'Desconectado';
};

// Inicializa configuración de clics en el mapa
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔧 Inicializando fix de clicks...');
    
    // Obtener canvas principal
    const canvas3 = document.getElementById('map3Canvas');
    
    if (!canvas3) {
        console.error('❌ Canvas map3Canvas no encontrado');
        return;
    }
    
    // Hacer canvas interactivo
    canvas3.style.position = 'relative';
    canvas3.style.zIndex = '10';
    canvas3.style.pointerEvents = 'auto';
    canvas3.style.cursor = 'pointer';
    canvas3.style.touchAction = 'auto';
    
    console.log('✅ Canvas configurado:', {
        width: canvas3.width,
        height: canvas3.height,
        offsetWidth: canvas3.offsetWidth,
        offsetHeight: canvas3.offsetHeight,
        pointerEvents: canvas3.style.pointerEvents
    });
    
    // Reemplazar canvas para evitar duplicados
    const newCanvas = canvas3.cloneNode(true);
    canvas3.parentNode.replaceChild(newCanvas, canvas3);
    
    // Crear nuevo contexto
    const ctx = newCanvas.getContext('2d');
    
    // Actualizar referencias globales
    map3.canvas = newCanvas;
    map3.ctx = ctx;
    
    // Detectar clics sobre el mapa
    newCanvas.addEventListener('click', function(event) {
        console.log('🖱️ Click detectado en canvas');
        
        // Validar datos cargados
        if (!map1Data || !map1Data.restaurantes || !map1Data.casas) {
            console.warn('⚠️ map1Data no está disponible aún');
            console.log('map1Data actual:', map1Data);
            return;
        }
        
        const rect = newCanvas.getBoundingClientRect();
        const scaleX = newCanvas.width / rect.width;
        const scaleY = newCanvas.height / rect.height;
        
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;
        
        const gridX = Math.floor((clickX * scaleX) / map3.cellSize);
        const gridY = Math.floor((clickY * scaleY) / map3.cellSize);
        
        console.log('📍 Click en grid:', { gridX, gridY, clickX, clickY });
        
        // Ignorar clics en calles
        if (gridX % 2 !== 1 || gridY % 2 !== 1) {
            console.log('❌ Click en calle, ignorando');
            return;
        }
        
        // Calcular coordenadas
        const av = ((gridX - 1) / 2) + 1;
        const ca = 7 - ((gridY - 1) / 2);
        
        console.log('🗺️ Coordenadas Av/Ca:', { av, ca });
        
        // Buscar restaurante
        let foundRestaurant = null;
        for (let id in map1Data.restaurantes) {
            const r = map1Data.restaurantes[id];
            if (r.av === av && r.ca === ca) {
                foundRestaurant = { id, ...r };
                console.log('🍽️ Restaurante encontrado:', foundRestaurant);
                break;
            }
        }
        
        // Buscar casa
        let foundHouse = null;
        for (let id in map1Data.casas) {
            const h = map1Data.casas[id];
            if (h.av === av && h.ca === ca) {
                foundHouse = { id, ...h };
                console.log('🏠 Casa encontrada:', foundHouse);
                break;
            }
        }
        
        // Lanzar eventos
        if (foundRestaurant) {
            console.log('✅ Disparando evento mapRestaurantClick');
            window.dispatchEvent(new CustomEvent('mapRestaurantClick', {
                detail: { restaurant: foundRestaurant, av, ca }
            }));
        } else if (foundHouse) {
            console.log('✅ Disparando evento mapHouseClick');
            window.dispatchEvent(new CustomEvent('mapHouseClick', {
                detail: { house: foundHouse, av, ca }
            }));
        } else {
            console.log('⚠️ No se encontró edificio en esta posición');
            console.log('Restaurantes disponibles:', Object.keys(map1Data.restaurantes).length);
            console.log('Casas disponibles:', Object.keys(map1Data.casas).length);
        }
    }, { passive: false });
    
    // Detectar movimiento del mouse
    newCanvas.addEventListener('mousemove', function(event) {
        const rect = newCanvas.getBoundingClientRect();
        const scaleX = newCanvas.width / rect.width;
        const scaleY = newCanvas.height / rect.height;
        
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;
        
        const gridX = Math.floor((clickX * scaleX) / map3.cellSize);
        const gridY = Math.floor((clickY * scaleY) / map3.cellSize);
        
        if (gridX % 2 === 1 && gridY % 2 === 1) {
            if (!map3.hoveredCell || map3.hoveredCell.x !== gridX || map3.hoveredCell.y !== gridY) {
                map3.hoveredCell = { x: gridX, y: gridY };
                redrawAll();
            }
        } else if (map3.hoveredCell) {
            map3.hoveredCell = null;
            redrawAll();
        }
    }, { passive: true });
    
    // Detectar cuando sale del canvas
    newCanvas.addEventListener('mouseleave', function() {
        if (map3.hoveredCell) {
            map3.hoveredCell = null;
            redrawAll();
        }
    }, { passive: true });
    
    // Redibujar mapa
    setTimeout(() => {
        console.log('🎨 Redibujando mapa...');
        redrawAll();
    }, 100);
    
    console.log('✅ Fix de clicks instalado correctamente');
});