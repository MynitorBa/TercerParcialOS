// Sistema de registro de eventos del delivery
// Guarda y muestra los últimos 50 eventos del sistema

const MAX_HISTORY_EVENTS = 50;
const historyEvents = [];

// Agrega un nuevo evento al histórico
function addHistoryEvent(timestamp, message) {
    if (!message || message.trim().length === 0) return;
    
    historyEvents.unshift({ 
        ts: timestamp || Date.now(), 
        msg: message 
    });
    
    if (historyEvents.length > MAX_HISTORY_EVENTS) {
        historyEvents.pop();
    }
    
    updateHistoryDisplay();
}

// Intercepta mensajes de consola para capturar eventos del STM32
const originalConsoleLog = console.log;
console.log = function(...args) {
    originalConsoleLog.apply(console, args);
    
    args.forEach(arg => {
        if (typeof arg === 'string') {
            if (arg.includes('"type":') && arg.includes('"msg":')) {
                try {
                    const json = JSON.parse(arg);
                    
                    if (json.type === 'info' || json.type === 'event' || 
                        json.type === 'warning' || json.type === 'error' ||
                        json.type === 'success' || json.type === 'regenerate') {
                        
                        let message = json.msg || '';
                        
                        if (message) {
                            addHistoryEvent(Date.now(), message);
                        }
                    }
                } catch (e) {
                    // No es JSON válido, ignorar
                }
            }
        }
    });
};

// Intercepta eventos de pedidos para registrarlos
const originalHandleEvent = window.handleSTM32OrderEvent;

window.handleSTM32OrderEvent = function(eventType, orderNumber, driverName = null, prepTime = null) {
    if (originalHandleEvent) {
        originalHandleEvent(eventType, orderNumber, driverName, prepTime);
    }
    
    const eventLabels = {
        'ORDER_CREATED': 'Pedido creado',
        'ORDER_PREPARING': 'Preparando pedido',
        'ORDER_READY': 'Pedido listo',
        'DRIVER_ASSIGNED': 'Repartidor asignado',
        'DRIVER_PICKED_UP': 'Pedido recogido',
        'DELIVERED': 'Pedido entregado',
        'CANCELLED': 'Pedido cancelado',
        'CANCEL_REJECTED': 'Cancelación rechazada'
    };
    
    const label = eventLabels[eventType] || eventType;
    let message = `${label}: ${orderNumber}`;
    
    if (driverName) {
        message += ` (${driverName})`;
    }
    
    if (prepTime) {
        message += ` [${prepTime}s]`;
    }
    
    addHistoryEvent(Date.now(), message);
};

// Recibe datos de histórico desde el STM32
window.handleHistoryData = function(data) {
    if (!data || typeof data !== 'object') {
        console.warn('Datos de histórico inválidos:', data);
        return;
    }
    
    // Evento individual
    if (data.ts !== undefined && data.msg) {
        addHistoryEvent(data.ts, data.msg);
        return;
    }
    
    // Lista completa de eventos
    if (data.items && Array.isArray(data.items)) {
        historyEvents.length = 0;
        
        data.items.forEach(item => {
            if (item.ts !== undefined && item.msg) {
                historyEvents.push({ 
                    ts: item.ts, 
                    msg: item.msg 
                });
            }
        });
        
        while (historyEvents.length > MAX_HISTORY_EVENTS) {
            historyEvents.pop();
        }
        
        updateHistoryDisplay();
    }
};

// Actualiza la tabla de eventos en pantalla
function updateHistoryDisplay() {
    const tbody = document.getElementById('historyTableBody');
    const countElement = document.getElementById('historyCount');
    
    if (!tbody) {
        return;
    }
    
    // Actualizar contador
    if (countElement) {
        countElement.textContent = historyEvents.length;
    }
    
    // Sin eventos
    if (historyEvents.length === 0) {
        tbody.innerHTML = `
            <tr class="history-empty">
                <td colspan="2">Sin eventos registrados</td>
            </tr>
        `;
        return;
    }
    
    // Generar filas
    tbody.innerHTML = historyEvents.map(event => {
        const date = new Date(event.ts);
        const timeStr = date.toLocaleTimeString('es-GT', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: false 
        });
        
        return `
            <tr class="history-row">
                <td class="history-time">${timeStr}</td>
                <td class="history-message">${escapeHtml(event.msg)}</td>
            </tr>
        `;
    }).join('');
}

// Escapa HTML para seguridad
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Limpia el histórico
window.clearHistory = function() {
    if (historyEvents.length === 0) {
        console.log('El histórico ya está vacío');
        return;
    }
    
    const count = historyEvents.length;
    historyEvents.length = 0;
    updateHistoryDisplay();
    
    originalConsoleLog(`Histórico limpiado (${count} eventos eliminados)`);
    
    if (window.showNotification) {
        showNotification('info', 'Histórico Limpiado', 
            `Se eliminaron ${count} evento(s)`);
    }
};

// Exporta histórico a JSON
window.exportHistory = function() {
    if (historyEvents.length === 0) {
        originalConsoleLog('No hay eventos para exportar');
        return;
    }
    
    const json = JSON.stringify(historyEvents, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    a.href = url;
    a.download = `historial_${Date.now()}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    
    originalConsoleLog('Histórico exportado');
    
    if (window.showNotification) {
        showNotification('success', 'Exportación Exitosa', 
            `Se exportaron ${historyEvents.length} eventos`);
    }
};

// Inicializa al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    updateHistoryDisplay();
    originalConsoleLog('Sistema de histórico inicializado');
    
    addHistoryEvent(Date.now(), 'Sistema de histórico iniciado');
});

originalConsoleLog('history.js cargado correctamente');