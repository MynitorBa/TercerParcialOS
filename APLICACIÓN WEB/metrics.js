// Sistema de métricas y estadísticas del delivery
// Procesa datos de rendimiento y genera gráficos

// Almacenamiento de datos
const metricsData = new Map();

// Gráficos
let metricsChart = null;
let driverPickupChart = null;
let driverTotalChart = null;
let restaurantPrepChart = null;
let houseDeliveryChart = null;

// Datos agregados por entidad
const driverPickupTimes = new Map();
const driverTotalTimes = new Map();
const restaurantPrepTimes = new Map();
const houseDeliveryTimes = new Map();

// Sistema de puntuación
const driverScores = new Map();

// Inicializa todos los gráficos al cargar
document.addEventListener('DOMContentLoaded', () => {
    initializeMetricsChart();
    initializeDriverPickupChart();
    initializeDriverTotalChart();
    initializeRestaurantPrepChart();
    initializeHouseDeliveryChart();
    updateMetricsDisplay();
    updateDriverScoreboard();
});

// Recibe métricas de un pedido desde el STM32
window.handleMetricsData = function(metricsJson) {
    const receiptNumber = metricsJson.order;
    
    // Buscar IDs del pedido activo
    let driverId = undefined;
    let restaurantId = undefined;
    let houseId = undefined;
    
    if (typeof activeOrders !== 'undefined') {
        const order = activeOrders.find(o => 
            (o.receiptNumber === receiptNumber || o.numeroRecibo === receiptNumber)
        );
        
        if (order) {
            if (order.repartidorId !== undefined && order.repartidorId !== null) {
                driverId = order.repartidorId;
            }
            if (order.restaurant && order.restaurant.id !== '?') {
                restaurantId = order.restaurant.id;
            }
            if (order.destination && order.destination.id !== '?') {
                houseId = order.destination.id;
            }
        }
    }
    
    // Guardar métricas
    metricsData.set(receiptNumber, {
        t_queue_kitchen: parseFloat(metricsJson.t_queue_kitchen) || 0,
        t_prep: parseFloat(metricsJson.t_prep) || 0,
        t_wait_driver: parseFloat(metricsJson.t_wait_driver) || 0,
        t_drive: parseFloat(metricsJson.t_drive) || 0,
        t_total: parseFloat(metricsJson.t_total) || 0,
        driver_id: driverId,
        restaurant_id: restaurantId,
        house_id: houseId
    });
    
    console.log(`Métricas recibidas para ${receiptNumber}:`, metricsData.get(receiptNumber));
    
    // Agregar datos del repartidor
    if (driverId !== undefined) {
        if (!driverPickupTimes.has(driverId)) {
            driverPickupTimes.set(driverId, []);
        }
        if (!driverTotalTimes.has(driverId)) {
            driverTotalTimes.set(driverId, []);
        }
        driverPickupTimes.get(driverId).push(parseFloat(metricsJson.t_wait_driver) || 0);
        driverTotalTimes.get(driverId).push(parseFloat(metricsJson.t_drive) || 0);
        
        // Sumar puntos
        if (!driverScores.has(driverId)) {
            driverScores.set(driverId, 0);
        }
        driverScores.set(driverId, driverScores.get(driverId) + 10);
    }
    
    // Agregar datos del restaurante
    if (restaurantId !== undefined) {
        if (!restaurantPrepTimes.has(restaurantId)) {
            restaurantPrepTimes.set(restaurantId, []);
        }
        restaurantPrepTimes.get(restaurantId).push(parseFloat(metricsJson.t_prep) || 0);
        console.log(`📊 Tiempo de prep agregado a R${restaurantId}: ${metricsJson.t_prep}s`);
    }
    
    // Agregar datos de la casa
    if (houseId !== undefined) {
        if (!houseDeliveryTimes.has(houseId)) {
            houseDeliveryTimes.set(houseId, []);
        }
        houseDeliveryTimes.get(houseId).push({
            time: parseFloat(metricsJson.t_total) || 0,
            receipt: receiptNumber
        });
    }
    
    updateMetricsDisplay();
    updateDriverPickupChart();
    updateDriverTotalChart();
    updateRestaurantPrepChart();
    updateHouseDeliveryChart();
    updateDriverScoreboard();
};

// Recibe estadísticas globales calculadas por el STM32
window.handleGlobalMetrics = function(data) {
    console.log('Métricas globales del STM32:', data);
    
    // Convertir datos
    const stm32Metrics = {
        avg_total: parseFloat(data.avg_total) || 0,
        avg_prep: parseFloat(data.avg_prep) || 0,
        avg_wait: parseFloat(data.avg_wait) || 0,
        avg_delivery: parseFloat(data.avg_delivery) || 0,
        p50_total: parseFloat(data.p50_total) || 0,
        p95_total: parseFloat(data.p95_total) || 0,
        p50_prep: parseFloat(data.p50_prep) || 0,
        p95_prep: parseFloat(data.p95_prep) || 0,
        analyzed: parseInt(data.analyzed) || 0
    };
    
    // Log de métricas
    console.log(`[STM32] Promedio Total: ${stm32Metrics.avg_total.toFixed(2)}s`);
    console.log(`[STM32] Promedio Preparación: ${stm32Metrics.avg_prep.toFixed(2)}s`);
    console.log(`[STM32] P50 Total: ${stm32Metrics.p50_total.toFixed(2)}s`);
    console.log(`[STM32] P95 Total: ${stm32Metrics.p95_total.toFixed(2)}s`);
    console.log(`[STM32] P50 Prep: ${stm32Metrics.p50_prep.toFixed(2)}s`);
    console.log(`[STM32] P95 Prep: ${stm32Metrics.p95_prep.toFixed(2)}s`);
    console.log(`[STM32] Pedidos analizados: ${stm32Metrics.analyzed}`);
    
    // Mostrar métricas del STM32
    const stm32Container = document.getElementById('stm32MetricsDisplay');
    
    if (stm32Container) {
        stm32Container.innerHTML = `
            <div class="stm32-metrics-banner">
                <h3>Métricas Calculadas por STM32</h3>
                <p style="color: #888; font-size: 14px; margin-bottom: 15px;">
                    Basado en ${stm32Metrics.analyzed} pedido(s) entregado(s)
                </p>
                
                <div class="stm32-metrics-grid">
                    <div class="stm32-metric">
                        <span class="stm32-label">Promedio Total</span>
                        <span class="stm32-value">${stm32Metrics.avg_total.toFixed(2)}s</span>
                    </div>
                    
                    <div class="stm32-metric">
                        <span class="stm32-label">Promedio Preparación</span>
                        <span class="stm32-value">${stm32Metrics.avg_prep.toFixed(2)}s</span>
                    </div>
                    
                    <div class="stm32-metric">
                        <span class="stm32-label">P50 Total</span>
                        <span class="stm32-value">${stm32Metrics.p50_total.toFixed(2)}s</span>
                    </div>
                    
                    <div class="stm32-metric">
                        <span class="stm32-label">P95 Total</span>
                        <span class="stm32-value">${stm32Metrics.p95_total.toFixed(2)}s</span>
                    </div>
                    
                    <div class="stm32-metric">
                        <span class="stm32-label">P50 Preparación</span>
                        <span class="stm32-value">${stm32Metrics.p50_prep.toFixed(2)}s</span>
                    </div>
                    
                    <div class="stm32-metric">
                        <span class="stm32-label">P95 Preparación</span>
                        <span class="stm32-value">${stm32Metrics.p95_prep.toFixed(2)}s</span>
                    </div>
                </div>
            </div>
        `;
    }
};

// Crea gráfico de barras apiladas
function initializeMetricsChart() {
    const ctx = document.getElementById('metricsChart');
    
    if (!ctx) {
        console.error('Canvas metricsChart no encontrado');
        return;
    }
    
    metricsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Cola Cocina',
                    data: [],
                    backgroundColor: 'rgba(255, 170, 0, 0.7)',
                    borderColor: '#ffaa00',
                    borderWidth: 2
                },
                {
                    label: 'Preparación',
                    data: [],
                    backgroundColor: 'rgba(255, 102, 0, 0.7)',
                    borderColor: '#ff6600',
                    borderWidth: 2
                },
                {
                    label: 'Espera Motorista',
                    data: [],
                    backgroundColor: 'rgba(52, 152, 219, 0.7)',
                    borderColor: '#3498db',
                    borderWidth: 2
                },
                {
                    label: 'Entrega',
                    data: [],
                    backgroundColor: 'rgba(46, 204, 113, 0.7)',
                    borderColor: '#2ecc71',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    ticks: { color: '#00d9ff', font: { weight: 'bold' } },
                    grid: { color: 'rgba(0, 217, 255, 0.1)' }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    min: 0,
                    ticks: { 
                        color: '#00ff00',
                        font: { weight: 'bold' },
                        callback: (value) => `${value.toFixed(1)}s`
                    },
                    grid: { color: 'rgba(0, 255, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    labels: { 
                        color: '#00ffff',
                        font: { weight: 'bold', size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}s`;
                        }
                    }
                }
            }
        }
    });
}

// Crea gráfico de tiempo de pickup por repartidor
function initializeDriverPickupChart() {
    const ctx = document.getElementById('driverPickupChart');
    if (!ctx) return;
    
    driverPickupChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Tiempo Promedio de Pickup (s)',
                data: [],
                backgroundColor: 'rgba(241, 196, 15, 0.7)',
                borderColor: '#f1c40f',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: '#00d9ff', font: { weight: 'bold' } },
                    grid: { color: 'rgba(0, 217, 255, 0.1)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { 
                        color: '#00ff00',
                        font: { weight: 'bold' },
                        callback: (value) => `${value.toFixed(1)}s`
                    },
                    grid: { color: 'rgba(0, 255, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    labels: { 
                        color: '#00ffff',
                        font: { weight: 'bold', size: 11 }
                    }
                }
            }
        }
    });
}

// Crea gráfico de tiempo total por repartidor
function initializeDriverTotalChart() {
    const ctx = document.getElementById('driverTotalChart');
    if (!ctx) return;
    
    driverTotalChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Tiempo Promedio Total (s)',
                data: [],
                backgroundColor: 'rgba(52, 152, 219, 0.7)',
                borderColor: '#3498db',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: '#00d9ff', font: { weight: 'bold' } },
                    grid: { color: 'rgba(0, 217, 255, 0.1)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { 
                        color: '#00ff00',
                        font: { weight: 'bold' },
                        callback: (value) => `${value.toFixed(1)}s`
                    },
                    grid: { color: 'rgba(0, 255, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    labels: { 
                        color: '#00ffff',
                        font: { weight: 'bold', size: 11 }
                    }
                }
            }
        }
    });
}

// Crea gráfico de tiempo de preparación por restaurante
function initializeRestaurantPrepChart() {
    const ctx = document.getElementById('restaurantPrepChart');
    if (!ctx) return;
    
    restaurantPrepChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Tiempo Promedio Preparación (s)',
                data: [],
                backgroundColor: 'rgba(231, 76, 60, 0.7)',
                borderColor: '#e74c3c',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: '#00d9ff', font: { weight: 'bold' } },
                    grid: { color: 'rgba(0, 217, 255, 0.1)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { 
                        color: '#00ff00',
                        font: { weight: 'bold' },
                        callback: (value) => `${value.toFixed(1)}s`
                    },
                    grid: { color: 'rgba(0, 255, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    labels: { 
                        color: '#00ffff',
                        font: { weight: 'bold', size: 11 }
                    }
                }
            }
        }
    });
}

// Crea gráfico de tiempo de entrega por casa
function initializeHouseDeliveryChart() {
    const ctx = document.getElementById('houseDeliveryChart');
    if (!ctx) return;
    
    houseDeliveryChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Tiempo Promedio Entrega (s)',
                data: [],
                backgroundColor: 'rgba(46, 204, 113, 0.7)',
                borderColor: '#2ecc71',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: '#00d9ff', font: { weight: 'bold' } },
                    grid: { color: 'rgba(0, 217, 255, 0.1)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { 
                        color: '#00ff00',
                        font: { weight: 'bold' },
                        callback: (value) => `${value.toFixed(1)}s`
                    },
                    grid: { color: 'rgba(0, 255, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    labels: { 
                        color: '#00ffff',
                        font: { weight: 'bold', size: 11 }
                    }
                }
            }
        }
    });
}

// Actualiza todas las secciones de métricas
function updateMetricsDisplay() {
    const allMetrics = Array.from(metricsData.values());
    
    if (allMetrics.length === 0) {
        updateEmptyState();
        return;
    }
    
    const stats = calculateAggregatedStats(allMetrics);
    updateSummaryCards(stats);
    updateChart();
    updateDetailedTable();
}

// Calcula estadísticas agregadas
function calculateAggregatedStats(metrics) {
    const fields = ['t_queue_kitchen', 't_prep', 't_wait_driver', 't_drive', 't_total'];
    const stats = {};
    
    fields.forEach(field => {
        const values = metrics.map(m => m[field]).filter(v => v > 0).sort((a, b) => a - b);
        
        if (values.length === 0) {
            stats[field] = { avg: 0, p50: 0, p90: 0 };
            return;
        }
        
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
        
        const p50Index = Math.floor(values.length * 0.5);
        const p50 = values[p50Index];
        
        const p90Index = Math.floor(values.length * 0.9);
        const p90 = values[p90Index];
        
        stats[field] = { avg, p50, p90 };
    });
    
    return stats;
}

// Actualiza las tarjetas de resumen
function updateSummaryCards(stats) {
    const fields = [
        { key: 't_queue_kitchen', prefix: 'queue' },
        { key: 't_prep', prefix: 'prep' },
        { key: 't_wait_driver', prefix: 'wait' },
        { key: 't_drive', prefix: 'drive' },
        { key: 't_total', prefix: 'total' }
    ];
    
    fields.forEach(({ key, prefix }) => {
        const stat = stats[key];
        
        document.getElementById(`metric-avg-${prefix}`).textContent = `${stat.avg.toFixed(1)}s`;
        document.getElementById(`metric-p50-${prefix}`).textContent = `${stat.p50.toFixed(1)}s`;
        document.getElementById(`metric-p90-${prefix}`).textContent = `${stat.p90.toFixed(1)}s`;
    });
}

// Actualiza el gráfico principal
function updateChart() {
    if (!metricsChart) return;
    
    const entries = Array.from(metricsData.entries()).slice(-10);
    
    const labels = entries.map(([receipt]) => receipt);
    const queueData = entries.map(([, m]) => m.t_queue_kitchen);
    const prepData = entries.map(([, m]) => m.t_prep);
    const waitData = entries.map(([, m]) => m.t_wait_driver);
    const driveData = entries.map(([, m]) => m.t_drive);
    
    metricsChart.data.labels = labels;
    metricsChart.data.datasets[0].data = queueData;
    metricsChart.data.datasets[1].data = prepData;
    metricsChart.data.datasets[2].data = waitData;
    metricsChart.data.datasets[3].data = driveData;
    
    metricsChart.update();
}

// Actualiza gráfico de pickup de repartidores
function updateDriverPickupChart() {
    if (!driverPickupChart) return;
    
    const labels = [];
    const data = [];
    
    for (let [driverId, times] of driverPickupTimes) {
        if (times.length === 0) continue;
        const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
        labels.push(`M${driverId}`);
        data.push(avg);
    }
    
    driverPickupChart.data.labels = labels;
    driverPickupChart.data.datasets[0].data = data;
    driverPickupChart.update();
    
    updateDriverPickupTable();
}

// Actualiza gráfico de tiempo total de repartidores
function updateDriverTotalChart() {
    if (!driverTotalChart) return;
    
    const labels = [];
    const data = [];
    
    for (let [driverId, times] of driverTotalTimes) {
        if (times.length === 0) continue;
        const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
        labels.push(`M${driverId}`);
        data.push(avg);
    }
    
    driverTotalChart.data.labels = labels;
    driverTotalChart.data.datasets[0].data = data;
    driverTotalChart.update();
    
    updateDriverTotalTable();
}

// Actualiza gráfico de preparación de restaurantes
function updateRestaurantPrepChart() {
    if (!restaurantPrepChart) return;
    
    const labels = [];
    const data = [];
    
    for (let [restId, times] of restaurantPrepTimes) {
        if (times.length === 0) continue;
        const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
        labels.push(`R${restId}`);
        data.push(avg);
    }
    
    restaurantPrepChart.data.labels = labels;
    restaurantPrepChart.data.datasets[0].data = data;
    restaurantPrepChart.update();
    
    updateRestaurantPrepTable();
}

// Actualiza gráfico de entregas por casa
function updateHouseDeliveryChart() {
    if (!houseDeliveryChart) return;
    
    const labels = [];
    const data = [];
    
    for (let [houseId, deliveries] of houseDeliveryTimes) {
        if (deliveries.length === 0) continue;
        const avg = deliveries.reduce((sum, d) => sum + d.time, 0) / deliveries.length;
        labels.push(`H${houseId}`);
        data.push(avg);
    }
    
    houseDeliveryChart.data.labels = labels;
    houseDeliveryChart.data.datasets[0].data = data;
    houseDeliveryChart.update();
    
    updateHouseDeliveryTable();
}

// Actualiza tabla de entregas por casa
function updateHouseDeliveryTable() {
    const tbody = document.getElementById('houseDeliveryTableBody');
    if (!tbody) return;
    
    const houseOrders = new Map();
    
    // Agrupar por casa
    for (let [houseId, deliveries] of houseDeliveryTimes) {
        if (!houseOrders.has(houseId)) {
            houseOrders.set(houseId, []);
        }
        deliveries.forEach(d => {
            houseOrders.get(houseId).push({
                receipt: d.receipt,
                time: d.time
            });
        });
    }
    
    if (houseOrders.size === 0) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="3" style="text-align: center;">Sin datos</td></tr>';
        return;
    }
    
    // Ordenar casas por ID
    const sortedHouses = Array.from(houseOrders.entries()).sort((a, b) => a[0] - b[0]);
    let html = '';
    
    sortedHouses.forEach(([houseId, orders]) => {
        orders.sort((a, b) => b.time - a.time);
        
        // Primera fila con rowspan
        html += `
            <tr style="border-top: 3px solid #27ae60;">
                <td rowspan="${orders.length}" style="color: #27ae60; font-weight: 900; vertical-align: middle; background: rgba(39, 174, 96, 0.1); text-align: center;">
                    H${houseId}
                </td>
                <td style="color: #ffaa00; font-weight: 800; text-align: center;">${orders[0].receipt}</td>
                <td style="color: #00ffff; font-weight: 900; text-align: center;">${orders[0].time.toFixed(2)}s</td>
            </tr>
        `;
        
        // Filas adicionales
        for (let i = 1; i < orders.length; i++) {
            html += `
                <tr>
                    <td style="color: #ffaa00; font-weight: 800; text-align: center;">${orders[i].receipt}</td>
                    <td style="color: #00ffff; font-weight: 900; text-align: center;">${orders[i].time.toFixed(2)}s</td>
                </tr>
            `;
        }
    });
    
    tbody.innerHTML = html;
}

// Actualiza ranking de repartidores
function updateDriverScoreboard() {
    const tbody = document.getElementById('driverScoreTableBody');
    if (!tbody) return;
    
    const scores = Array.from(driverScores.entries()).sort((a, b) => b[1] - a[1]);
    
    if (scores.length === 0) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="3">Sin datos</td></tr>';
        return;
    }
    
    tbody.innerHTML = scores.map(([driverId, score], index) => {
        let medal = '';
        if (index === 0) medal = '🥇';
        else if (index === 1) medal = '🥈';
        else if (index === 2) medal = '🥉';
        
        return `
            <tr>
                <td style="color: #f1c40f; font-weight: 900;">${medal} M${driverId}</td>
                <td>Repartidor ${parseInt(driverId) + 1}</td>
                <td style="color: #00ff00; font-weight: 900;">${score} pts</td>
            </tr>
        `;
    }).join('');
}

// Actualiza tabla detallada de métricas
function updateDetailedTable() {
    const tbody = document.getElementById('metricsTableBody');
    
    if (!tbody) return;
    
    const entries = Array.from(metricsData.entries()).reverse();
    
    if (entries.length === 0) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="6">Sin datos</td></tr>';
        return;
    }
    
    tbody.innerHTML = entries.map(([receipt, metrics]) => `
        <tr>
            <td style="color: #ffaa00; font-weight: 800;">${receipt}</td>
            <td>${metrics.t_queue_kitchen.toFixed(2)}s</td>
            <td>${metrics.t_prep.toFixed(2)}s</td>
            <td>${metrics.t_wait_driver.toFixed(2)}s</td>
            <td>${metrics.t_drive.toFixed(2)}s</td>
            <td style="color: #00ffff; font-weight: 900;">${metrics.t_total.toFixed(2)}s</td>
        </tr>
    `).join('');
}

// Resetea visualizaciones
function updateEmptyState() {
    const fields = ['queue', 'prep', 'wait', 'drive', 'total'];
    fields.forEach(prefix => {
        document.getElementById(`metric-avg-${prefix}`).textContent = '0.0s';
        document.getElementById(`metric-p50-${prefix}`).textContent = '0.0s';
        document.getElementById(`metric-p90-${prefix}`).textContent = '0.0s';
    });
    
    if (metricsChart) {
        metricsChart.data.labels = [];
        metricsChart.data.datasets.forEach(dataset => {
            dataset.data = [];
        });
        metricsChart.update();
    }
    
    const tbody = document.getElementById('metricsTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="6">Sin datos</td></tr>';
    }
}

// Limpia todas las métricas
window.clearMetrics = function() {
    metricsData.clear();
    driverPickupTimes.clear();
    driverTotalTimes.clear();
    restaurantPrepTimes.clear();
    houseDeliveryTimes.clear();
    driverScores.clear();
    updateEmptyState();
    updateDriverPickupChart();
    updateDriverTotalChart();
    updateRestaurantPrepChart();
    updateHouseDeliveryChart();
    updateDriverScoreboard();
    updateHouseDeliveryTable();
    updateDriverPickupTable();
    updateDriverTotalTable();
    updateRestaurantPrepTable();
    console.log('Métricas limpiadas');
};

console.log('Sistema de métricas inicializado');
console.log('Handler de métricas globales STM32 registrado');

// Control de música de fondo
const musicControl = () => {
    const music = document.getElementById('backgroundMusic');
    const toggleBtn = document.getElementById('musicToggle');
    
    if (!music || !toggleBtn) {
        setTimeout(musicControl, 100);
        return;
    }
    
    toggleBtn.addEventListener('click', () => {
        if (music.paused) {
            music.play().then(() => {
                toggleBtn.textContent = '🔊';
                toggleBtn.classList.add('playing');
            }).catch(e => {
                console.log('No se pudo reproducir música:', e);
            });
        } else {
            music.pause();
            toggleBtn.textContent = '🔇';
            toggleBtn.classList.remove('playing');
        }
    });
    
    music.play().then(() => {
        toggleBtn.textContent = '🔊';
        toggleBtn.classList.add('playing');
    }).catch(() => {
        console.log('Autoplay bloqueado - haz clic en el botón de música');
    });
};

// Iniciar control de música
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', musicControl);
} else {
    musicControl();
}

// Sistema de gestión de platillos
const restaurantDishesData = new Map();

// Gráficos de platillos
let totalDishesChart = null;
let pendingDishesChart = null;

// Inicializar gráficos de platillos
document.addEventListener('DOMContentLoaded', () => {
    initializeTotalDishesChart();
    initializePendingDishesChart();
    
    // Inicializar datos de restaurantes
    if (typeof restaurants !== 'undefined') {
        restaurants.forEach(restaurant => {
            if (!restaurantDishesData.has(restaurant.id)) {
                restaurantDishesData.set(restaurant.id, { total: 0, pending: 0 });
            }
        });
        updateDishesCharts();
    }
});

// Crea gráfico de total de platillos
function initializeTotalDishesChart() {
    const ctx = document.getElementById('totalDishesChart');
    if (!ctx) {
        console.warn('Canvas totalDishesChart no encontrado');
        return;
    }
    
    totalDishesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Total Platillos',
                data: [],
                backgroundColor: 'rgba(155, 89, 182, 0.7)',
                borderColor: '#9b59b6',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { 
                        color: '#e67e22', 
                        font: { weight: 'bold' } 
                    },
                    grid: { color: 'rgba(230, 126, 34, 0.1)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { 
                        color: '#00ff00',
                        font: { weight: 'bold' },
                        stepSize: 1,
                        callback: (value) => Math.floor(value)
                    },
                    grid: { color: 'rgba(0, 255, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    labels: { 
                        color: '#e67e22',
                        font: { weight: 'bold', size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y} platillos`;
                        }
                    }
                }
            }
        }
    });
}

// Crea gráfico de platillos pendientes
function initializePendingDishesChart() {
    const ctx = document.getElementById('pendingDishesChart');
    if (!ctx) {
        console.warn('Canvas pendingDishesChart no encontrado');
        return;
    }
    
    pendingDishesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Platillos Pendientes',
                data: [],
                backgroundColor: 'rgba(255, 152, 0, 0.7)',
                borderColor: '#ff9800',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { 
                        color: '#e67e22', 
                        font: { weight: 'bold' } 
                    },
                    grid: { color: 'rgba(230, 126, 34, 0.1)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { 
                        color: '#00ff00',
                        font: { weight: 'bold' },
                        stepSize: 1,
                        callback: (value) => Math.floor(value)
                    },
                    grid: { color: 'rgba(0, 255, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    labels: { 
                        color: '#ff9800',
                        font: { weight: 'bold', size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y} en cocina`;
                        }
                    }
                }
            }
        }
    });
}

// Incrementa contador al crear pedido
function incrementRestaurantDishes(restaurantId) {
    if (!restaurantDishesData.has(restaurantId)) {
        restaurantDishesData.set(restaurantId, { total: 0, pending: 0 });
    }
    
    const data = restaurantDishesData.get(restaurantId);
    data.total += 1;
    data.pending += 1;
    
    console.log(`Restaurante ${restaurantId}: Total=${data.total}, Pendientes=${data.pending}`);
    
    updateDishesCharts();
}

// Decrementa contador al completar platillo
function decrementRestaurantPendingDishes(restaurantId) {
    if (!restaurantDishesData.has(restaurantId)) {
        console.warn(`Restaurante ${restaurantId} no encontrado en datos de platillos`);
        return;
    }
    
    const data = restaurantDishesData.get(restaurantId);
    data.pending = Math.max(0, data.pending - 1);
    
    console.log(`Restaurante ${restaurantId}: Total=${data.total}, Pendientes=${data.pending}`);
    
    updateDishesCharts();
}

// Actualiza ambos gráficos de platillos
function updateDishesCharts() {
    if (!totalDishesChart || !pendingDishesChart) return;
    
    const labels = [];
    const totalData = [];
    const pendingData = [];
    
    // Ordenar por ID
    const sortedEntries = Array.from(restaurantDishesData.entries()).sort((a, b) => a[0] - b[0]);
    
    for (let [restaurantId, data] of sortedEntries) {
        labels.push(`R${restaurantId}`);
        totalData.push(data.total);
        pendingData.push(data.pending);
    }
    
    // Actualizar gráfico total
    totalDishesChart.data.labels = labels;
    totalDishesChart.data.datasets[0].data = totalData;
    totalDishesChart.update();
    
    // Actualizar gráfico pendientes
    pendingDishesChart.data.labels = labels;
    pendingDishesChart.data.datasets[0].data = pendingData;
    pendingDishesChart.update();
}

// Limpia datos de platillos
window.clearDishesData = function() {
    restaurantDishesData.clear();
    
    // Reinicializar restaurantes
    if (typeof restaurants !== 'undefined') {
        restaurants.forEach(restaurant => {
            restaurantDishesData.set(restaurant.id, { total: 0, pending: 0 });
        });
    }
    
    updateDishesCharts();
    console.log('Datos de platillos limpiados');
};

console.log('Sistema de métricas de platillos inicializado');

// Actualiza tabla de pickup por motorista
function updateDriverPickupTable() {
    const tbody = document.getElementById('driverPickupTableBody');
    if (!tbody) return;
    
    const driverOrders = new Map();
    
    for (let [receipt, metrics] of metricsData) {
        if (metrics.driver_id !== undefined) {
            if (!driverOrders.has(metrics.driver_id)) {
                driverOrders.set(metrics.driver_id, []);
            }
            driverOrders.get(metrics.driver_id).push({
                receipt: receipt,
                time: metrics.t_wait_driver
            });
        }
    }
    
    if (driverOrders.size === 0) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="3" style="text-align: center;">Sin datos</td></tr>';
        return;
    }
    
    const sortedDrivers = Array.from(driverOrders.entries()).sort((a, b) => a[0] - b[0]);
    let html = '';
    
    sortedDrivers.forEach(([driverId, orders]) => {
        orders.sort((a, b) => b.time - a.time);
        
        html += `
            <tr style="border-top: 3px solid #f1c40f;">
                <td rowspan="${orders.length}" style="color: #f1c40f; font-weight: 900; vertical-align: middle; background: rgba(241, 196, 15, 0.1); text-align: center;">
                    M${driverId}
                </td>
                <td style="color: #ffaa00; font-weight: 800; text-align: center;">${orders[0].receipt}</td>
                <td style="color: #00ffff; font-weight: 900; text-align: center;">${orders[0].time.toFixed(2)}s</td>
            </tr>
        `;
        
        for (let i = 1; i < orders.length; i++) {
            html += `
                <tr>
                    <td style="color: #ffaa00; font-weight: 800; text-align: center;">${orders[i].receipt}</td>
                    <td style="color: #00ffff; font-weight: 900; text-align: center;">${orders[i].time.toFixed(2)}s</td>
                </tr>
            `;
        }
    });
    
    tbody.innerHTML = html;
}

// Actualiza tabla de entrega por motorista
function updateDriverTotalTable() {
    const tbody = document.getElementById('driverTotalTableBody');
    if (!tbody) return;
    
    const driverOrders = new Map();
    
    for (let [receipt, metrics] of metricsData) {
        if (metrics.driver_id !== undefined) {
            if (!driverOrders.has(metrics.driver_id)) {
                driverOrders.set(metrics.driver_id, []);
            }
            driverOrders.get(metrics.driver_id).push({
                receipt: receipt,
                time: metrics.t_drive
            });
        }
    }
    
    if (driverOrders.size === 0) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="3" style="text-align: center;">Sin datos</td></tr>';
        return;
    }
    
    const sortedDrivers = Array.from(driverOrders.entries()).sort((a, b) => a[0] - b[0]);
    let html = '';
    
    sortedDrivers.forEach(([driverId, orders]) => {
        orders.sort((a, b) => b.time - a.time);
        
        html += `
            <tr style="border-top: 3px solid #f1c40f;">
                <td rowspan="${orders.length}" style="color: #f1c40f; font-weight: 900; vertical-align: middle; background: rgba(241, 196, 15, 0.1); text-align: center;">
                    M${driverId}
                </td>
                <td style="color: #ffaa00; font-weight: 800; text-align: center;">${orders[0].receipt}</td>
                <td style="color: #00ffff; font-weight: 900; text-align: center;">${orders[0].time.toFixed(2)}s</td>
            </tr>
        `;
        
        for (let i = 1; i < orders.length; i++) {
            html += `
                <tr>
                    <td style="color: #ffaa00; font-weight: 800; text-align: center;">${orders[i].receipt}</td>
                    <td style="color: #00ffff; font-weight: 900; text-align: center;">${orders[i].time.toFixed(2)}s</td>
                </tr>
            `;
        }
    });
    
    tbody.innerHTML = html;
}

// Actualiza tabla de preparación por restaurante
function updateRestaurantPrepTable() {
    const tbody = document.getElementById('restaurantPrepTableBody');
    if (!tbody) return;
    
    const restaurantOrders = new Map();
    
    for (let [receipt, metrics] of metricsData) {
        if (metrics.restaurant_id !== undefined) {
            if (!restaurantOrders.has(metrics.restaurant_id)) {
                restaurantOrders.set(metrics.restaurant_id, []);
            }
            restaurantOrders.get(metrics.restaurant_id).push({
                receipt: receipt,
                time: metrics.t_prep
            });
        }
    }
    
    if (restaurantOrders.size === 0) {
        tbody.innerHTML = '<tr class="table-empty"><td colspan="3" style="text-align: center;">Sin datos</td></tr>';
        return;
    }
    
    const sortedRestaurants = Array.from(restaurantOrders.entries()).sort((a, b) => a[0] - b[0]);
    let html = '';
    
    sortedRestaurants.forEach(([restaurantId, orders]) => {
        orders.sort((a, b) => b.time - a.time);
        
        html += `
            <tr style="border-top: 3px solid #e74c3c;">
                <td rowspan="${orders.length}" style="color: #e74c3c; font-weight: 900; vertical-align: middle; background: rgba(231, 76, 60, 0.1); text-align: center;">
                    R${restaurantId}
                </td>
                <td style="color: #ffaa00; font-weight: 800; text-align: center;">${orders[0].receipt}</td>
                <td style="color: #00ffff; font-weight: 900; text-align: center;">${orders[0].time.toFixed(2)}s</td>
            </tr>
        `;
        
        for (let i = 1; i < orders.length; i++) {
            html += `
                <tr>
                    <td style="color: #ffaa00; font-weight: 800; text-align: center;">${orders[i].receipt}</td>
                    <td style="color: #00ffff; font-weight: 900; text-align: center;">${orders[i].time.toFixed(2)}s</td>
                </tr>
            `;
        }
    });
    
    tbody.innerHTML = html;
}