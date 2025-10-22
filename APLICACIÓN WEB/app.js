// Sistema principal de gestión de pedidos

let selectedRestaurant = null;
let selectedDestination = null;
let selectedDishes = [];
let restaurantMenus = {};
let activeOrders = [];
let orderCounter = 1;
let totalOrdersCreated = 0;
const pendingOrdersQueue = new Map();
let nextTempId = 1;
let lastManualOrderTime = 0;
let lastAutoOrderData = null;

// Índice para búsqueda rápida
const orderIndexByReceipt = new Map();

// Rutas visuales de repartidores
const driverRoutes = new Map();

// Cache de eventos para evitar duplicados
const eventCache = new Map();

// Cache de elementos DOM
const dom = {};

// Crea contenedor de notificaciones
function createNotificationContainer() {
    if (!document.getElementById('notificationContainer')) {
        const container = document.createElement('div');
        container.id = 'notificationContainer';
        container.className = 'notification-container';
        document.body.appendChild(container);
    }
}

// Muestra notificación flotante
function showNotification(type, title, message, duration = 5000) {
    createNotificationContainer();
    
    const container = document.getElementById('notificationContainer');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    notification.innerHTML = `
        <div class="notification-icon">${icons[type] || 'ℹ'}</div>
        <div class="notification-content">
            <div class="notification-title">${title}</div>
            <div class="notification-message">${message}</div>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">✕</button>
    `;
    
    container.appendChild(notification);
    
    if (duration > 0) {
        setTimeout(() => {
            notification.classList.add('removing');
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }
}

// Agrega platillo al menú de un restaurante
window.addRestaurantMenu = function(restaurantId, dishId, nombre, tiempo) {
    if (!restaurantMenus[restaurantId]) {
        restaurantMenus[restaurantId] = [];
    }
    
    restaurantMenus[restaurantId].push({
        id: dishId,
        nombre: nombre,
        tiempoPreparacion: parseFloat(tiempo)
    });
    
    if (selectedRestaurant && selectedRestaurant.id == restaurantId) {
        displayMenu(restaurantId);
    }
};

// Procesa eventos de pedidos del STM32
window.handleSTM32OrderEvent = function(eventType, orderNumber, driverName = null, prepTime = null) {
    console.log(`Evento recibido: ${eventType} - ${orderNumber} - Driver: ${driverName}`);
    
    // Detectar reinicio del sistema
    if (eventType === 'SYSTEM_RESET' || eventType === 'REGENERATE') {
        console.log('🔄 Detectado evento de regeneración - Reseteando contadores');
        orderCounter = 1;
        totalOrdersCreated = 0;
        pendingOrderInfo = null;
        activeOrders.length = 0;
        restaurantMenus = {};
        orderIndexByReceipt.clear();
        driverRoutes.clear();
        eventCache.clear();
        selectedRestaurant = null;
        selectedDestination = null;
        selectedDishes.length = 0;
        displayActiveOrders();
        updateCancelOrdersTable();
        console.log('✅ Contadores reseteados: orderCounter=1, totalOrdersCreated=0');
        return;
    }
    
    // Validar eventos duplicados
    const cached = eventCache.get(orderNumber);
    const now = Date.now();
    
    if (cached && cached.lastEvent === eventType && (now - cached.timestamp) < 1000) {
        console.log(`Evento duplicado ignorado: ${eventType} - ${orderNumber}`);
        return;
    }
    
    // Actualizar cache
    eventCache.set(orderNumber, { lastEvent: eventType, timestamp: now });
    
    switch(eventType) {
        case 'ORDER_CREATED':
            handleOrderCreated(orderNumber, prepTime);
            showNotification('info', 'Pedido Creado', `Pedido ${orderNumber} en cola`);
            break;
        case 'ORDER_PREPARING':
            startOrderPreparation(orderNumber, prepTime);
            showNotification('info', 'Preparando', `Preparando ${orderNumber}`);
            
            // Incrementar platillos pendientes
            const preparingOrder = findOrderByReceipt(orderNumber);
            if (preparingOrder && preparingOrder.restaurant && preparingOrder.restaurant.id !== '?') {
                if (typeof incrementRestaurantPendingDishes !== 'undefined') {
                    incrementRestaurantPendingDishes(preparingOrder.restaurant.id);
                    console.log(`📊 Platillo en preparación en R${preparingOrder.restaurant.id}`);
                }
            }
            break;
        case 'ORDER_READY':
            updateOrderStatus(orderNumber, 'Preparado', 100);
            showNotification('success', 'Pedido Listo', `${orderNumber} está listo para recoger`);
            
            // Decrementar platillos pendientes
            const readyOrder = findOrderByReceipt(orderNumber);
            if (readyOrder && readyOrder.restaurant && readyOrder.restaurant.id !== '?') {
                if (typeof decrementRestaurantPendingDishes !== 'undefined') {
                    decrementRestaurantPendingDishes(readyOrder.restaurant.id);
                    console.log(`📊 Platillo completado en R${readyOrder.restaurant.id}`);
                }
            }
            break;
            
        case 'DRIVER_ASSIGNED':
            assignDriverToOrder(orderNumber, driverName);
            updateOrderStatus(orderNumber, `Asignado a ${driverName}`, 100);
            showNotification('info', 'Repartidor Asignado', `${driverName} entregará tu pedido`);
            break;
        case 'DRIVER_PICKED_UP':
            updateOrderStatus(orderNumber, `En camino (${driverName})`, 100);
            showNotification('info', 'En Camino', `${driverName} está entregando tu pedido`);
            break;
        case 'DELIVERED':
            console.log(`Marcando ${orderNumber} como ENTREGADO`);
            
            const deliveredOrder = findOrderByReceipt(orderNumber);
            if (deliveredOrder) {
                deliveredOrder.entregado = true;
                deliveredOrder.status = 'Entregado';
                deliveredOrder.progress = 100;
            }
            
            updateOrderStatus(orderNumber, 'Entregado', 100);
            showNotification('success', 'Entregado', `${orderNumber} fue entregado exitosamente`);
            
            setTimeout(() => {
                console.log(`Eliminando pedido ${orderNumber} del DOM`);
                removeOrder(orderNumber);
            }, 2000);
            break;
        case 'CANCELLED':
            console.log(`Cancelando pedido ${orderNumber}`);
            removeOrder(orderNumber);
            showNotification('success', 'Pedido Cancelado', `${orderNumber} fue cancelado exitosamente`);
            break;
        case 'CANCEL_REJECTED':
            showNotification('error', 'No se puede Cancelar', 'El pedido está siendo entregado en este momento');
            break;
    }
};

// Asigna repartidor a un pedido
function assignDriverToOrder(orderNumber, driverName) {
    const order = findOrderByReceipt(orderNumber);
    
    if (!order) {
        console.warn(`No se encontró pedido ${orderNumber} para asignar repartidor`);
        return;
    }
    
    let driverId = null;
    
    if (driverName && typeof map2Data !== 'undefined' && map2Data.repartidores) {
        const match = driverName.match(/repartidor\s+(\d+)/i);
        if (match) {
            const numero = parseInt(match[1]);
            driverId = numero - 1;
            
            console.log(`Asignando pedido ${orderNumber} a repartidor ID ${driverId} (${driverName})`);
        }
    }
    
    if (driverId !== null) {
        order.repartidorId = driverId;
        console.log(`Pedido ${orderNumber} asignado a repartidor ${driverId}`);
    } else {
        console.warn(`No se pudo determinar el ID del repartidor para ${driverName}`);
    }
    
    displayActiveOrders();
    updateCancelOrdersTable();
}

// Maneja creación de pedido
function handleOrderCreated(orderNumber, prepTime) {
    console.log(`📨 ORDER_CREATED: ${orderNumber}`);
    
    if (orderIndexByReceipt.has(orderNumber)) {
        console.log(`⚠️ ${orderNumber} ya existe`);
        return;
    }
    
    // Buscar pedido temporal reciente
    const now = Date.now();
    let foundTemp = null;
    
    for (let order of activeOrders) {
        if (order.isTemporary && 
            order.receiptNumber.startsWith('TEMP-') && 
            (now - order.createdAt) < 2000) {
            foundTemp = order;
            break;
        }
    }
    
    // Reemplazar temporal si existe (pedido manual)
    if (foundTemp) {
        console.log(`🔄 Reemplazando ${foundTemp.receiptNumber} → ${orderNumber}`);
        
        const tempIndex = activeOrders.indexOf(foundTemp);
        orderIndexByReceipt.delete(foundTemp.receiptNumber);
        
        activeOrders[tempIndex] = {
            ...foundTemp,
            receiptNumber: orderNumber,
            numeroRecibo: orderNumber,
            status: 'En cola',
            isTemporary: false,
            isSTM32Order: true,
            totalTime: prepTime ? parseFloat(prepTime) : foundTemp.totalTime,
            startTime: null,
            progress: 0
        };
        
        orderIndexByReceipt.set(orderNumber, tempIndex);
        displayActiveOrders();
        updateCancelOrdersTable();
        return;
    }
    
    // Crear pedido automático
    console.log(`🤖 Creando pedido automático: ${orderNumber}`);
    
    // Obtener datos del pedido automático
    let restaurantInfo = { id: '?', av: '?', ca: '?' };
    let destinationInfo = { id: '?', av: '?', ca: '?' };
    let dishNames = ['Pedido automático STM32'];
    
    if (lastAutoOrderData && (now - lastAutoOrderData.timestamp) < 5000) {
        console.log(`✅ Usando datos guardados:`, lastAutoOrderData);
        
        // Info del restaurante
        const rest = map1Data.restaurantes?.[lastAutoOrderData.restId];
        if (rest) {
            restaurantInfo = {
                id: lastAutoOrderData.restId,
                av: rest.av,
                ca: rest.ca
            };
        }
        
        // Info de la casa
        const house = map1Data.casas?.[lastAutoOrderData.destId];
        if (house) {
            destinationInfo = {
                id: lastAutoOrderData.destId,
                av: house.av,
                ca: house.ca
            };
        }
        
        // Nombres de platillos
        const menuRest = restaurantMenus[lastAutoOrderData.restId];
        if (menuRest && lastAutoOrderData.dishes) {
            dishNames = lastAutoOrderData.dishes.map(dishId => {
                const dish = menuRest.find(d => d.id === dishId);
                return dish ? dish.nombre : `Platillo ${dishId}`;
            });
        } else {
            dishNames = [`${lastAutoOrderData.dishes.length} platillo(s)`];
        }
        
        console.log(`📍 Restaurante: R${restaurantInfo.id} (Av${restaurantInfo.av}-Ca${restaurantInfo.ca})`);
        console.log(`🏠 Casa: H${destinationInfo.id} (Av${destinationInfo.av}-Ca${destinationInfo.ca})`);
        console.log(`🍽️ Platillos:`, dishNames);
        
        lastAutoOrderData = null;
    } else {
        console.warn(`⚠️ No hay datos de pedido automático guardados o expiraron`);
    }
    
    const order = {
        id: activeOrders.length + 1,
        receiptNumber: orderNumber,
        numeroRecibo: orderNumber,
        status: 'En cola',
        progress: 0,
        timestamp: new Date(),
        isSTM32Order: true,
        isAutoOrder: true,
        restaurant: restaurantInfo,
        destination: destinationInfo,
        dishNames: dishNames,
        totalTime: prepTime ? parseFloat(prepTime) : 0,
        startTime: null,
        createdAt: Date.now()
    };
    
    activeOrders.push(order);
    totalOrdersCreated++;
    orderIndexByReceipt.set(orderNumber, activeOrders.length - 1);
    displayActiveOrders();
    updateCancelOrdersTable();
    
    console.log(`✅ Pedido automático ${orderNumber} creado:`, order);
}

// Inicia preparación de pedido
function startOrderPreparation(orderNumber, prepTime) {
    const order = findOrderByReceipt(orderNumber);
    
    if (order) {
        console.log(`✅ Iniciando preparación de ${orderNumber}`);
        
        // Solo inicializar si no existe (previene duplicados)
        if (!order.startTime) {
            order.startTime = Date.now();
            order.elapsedTime = 0;
            console.log(`⏱️ Cronómetro iniciado para ${orderNumber}`);
        } else {
            console.log(`⚠️ Cronómetro ya estaba corriendo para ${orderNumber} - mensaje duplicado ignorado`);
        }
        
        order.status = 'Preparando';
        order.progress = 0;
        
        if (prepTime) {
            order.totalTime = parseFloat(prepTime);
        }
        
        displayActiveOrders();
        updateCancelOrdersTable();
    } else {
        console.warn(`No se encontró pedido ${orderNumber} para preparar`);
    }
}

// Busca pedido por número de recibo
function findOrderByReceipt(receiptNumber) {
    const index = orderIndexByReceipt.get(receiptNumber);
    return index !== undefined ? activeOrders[index] : null;
}

// Actualiza estado de un pedido
function updateOrderStatus(receiptNumber, newStatus, progress) {
    const order = findOrderByReceipt(receiptNumber);
    
    if (order) {
        console.log(`Actualizando ${receiptNumber}: ${order.status} → ${newStatus}`);
        order.status = newStatus;
        order.progress = progress;
        
        if (newStatus.includes('Preparado')) {
            order.startTime = null;
        }
        
        displayActiveOrders();
        updateCancelOrdersTable();
        return true;
    } else {
        console.warn(`No se encontró pedido ${receiptNumber} para actualizar`);
    }
    return false;
}

// Elimina pedido del sistema
function removeOrder(receiptNumber) {
    const index = orderIndexByReceipt.get(receiptNumber);
    
    if (index !== undefined) {
        console.log(`Eliminando pedido ${receiptNumber} (índice ${index})`);
        
        const pedidoEliminado = {...activeOrders[index]};
        
        if (activeOrders[index].repartidorId !== undefined) {
            const driverId = activeOrders[index].repartidorId;
            console.log(`Limpiando asignación del repartidor ${driverId}`);
            driverRoutes.delete(driverId);
            activeOrders[index].repartidorId = null;
        }
        
        // Marcar como eliminado
        activeOrders[index]._eliminado = true;
        activeOrders[index].entregado = true;
        activeOrders[index].status = 'Entregado';
        
        // Eliminar después de delay
        setTimeout(() => {
            activeOrders.splice(index, 1);
            orderIndexByReceipt.delete(receiptNumber);
            eventCache.delete(receiptNumber);
            
            // Reconstruir índice
            orderIndexByReceipt.clear();
            activeOrders.forEach((order, idx) => {
                orderIndexByReceipt.set(order.receiptNumber || order.numeroRecibo, idx);
            });
            
            console.log(`✅ Pedido ${receiptNumber} eliminado del array`);
            displayActiveOrders();
            updateCancelOrdersTable();
            updateAllInfoTables();
        }, 100);
        
        // Actualizar UI inmediatamente
        displayActiveOrders();
        updateCancelOrdersTable();
        updateAllInfoTables();
        
        console.log(`Pedido ${receiptNumber} marcado como eliminado`);
        console.log(`Pedidos activos restantes: ${activeOrders.filter(o => !o._eliminado).length}`);
    } else {
        console.warn(`No se encontró pedido ${receiptNumber} para eliminar`);
    }
}

// Inicializa listeners al cargar
document.addEventListener('DOMContentLoaded', () => {
    dom.trackingPreparing = document.getElementById('trackingPreparing');
    dom.trackingReady = document.getElementById('trackingReady');
    dom.trackingDelivering = document.getElementById('trackingDelivering');
    dom.menuGrid = document.getElementById('menuGrid');
    dom.menuDisabled = document.getElementById('menuDisabled');
    dom.btnCreateOrder = document.getElementById('btnCreateOrder');
    dom.summaryRestaurant = document.getElementById('summaryRestaurant');
    dom.summaryItems = document.getElementById('summaryItems');
    dom.summaryTime = document.getElementById('summaryTime');
    dom.summaryDestination = document.getElementById('summaryDestination');
    dom.restaurantDisplay = document.getElementById('restaurantDisplay');
    dom.houseDisplay = document.getElementById('houseDisplay');
    dom.cancelOrdersTable = document.getElementById('cancelOrdersTable');
    
    displayActiveOrders();
    updateCancelOrdersTable();
    
    window.addEventListener('mapRestaurantClick', e => {
        const { restaurant, av, ca } = e.detail;
        selectedRestaurant = { id: restaurant.id, av, ca };
        selectedDishes = [];
        
        if (typeof restaurantStates !== 'undefined' && restaurantStates[restaurant.id]) {
            const estado = restaurantStates[restaurant.id];
            if (estado === 'CARGADO') {
                console.log(`Restaurante ${restaurant.id} está CARGADO (usando algoritmo SJF)`);
            } else {
                console.log(`Restaurante ${restaurant.id} está NORMAL (usando algoritmo FCFS)`);
            }
        }
        
        updateRestaurantDisplay();
        displayMenu(restaurant.id);
        updateOrderSummary();
        redrawAll();
    });

    window.addEventListener('mapHouseClick', e => {
        const { house, av, ca } = e.detail;
        selectedDestination = { id: house.id, av, ca };
        
        updateHouseDisplay();
        updateOrderSummary();
        redrawAll();
    });

    dom.btnCreateOrder.addEventListener('click', () => {
        if (selectedRestaurant && selectedDestination && selectedDishes.length > 0) {
            createOrder();
        }
    });
});

// Muestra menú del restaurante
function displayMenu(restaurantId) {
    if (!restaurantId || !restaurantMenus[restaurantId] || restaurantMenus[restaurantId].length === 0) {
        dom.menuDisabled.style.display = 'flex';
        dom.menuGrid.style.display = 'none';
        dom.menuDisabled.innerHTML = `
            <span class="menu-disabled-icon">🍽️</span>
            <p>Cargando menú del restaurante...</p>
        `;
        return;
    }
    
    dom.menuDisabled.style.display = 'none';
    dom.menuGrid.style.display = 'grid';
    
    const menu = restaurantMenus[restaurantId];
    dom.menuGrid.innerHTML = menu.map(dish => `
        <div class="menu-item ${selectedDishes.includes(dish.id) ? 'selected' : ''}" 
             onclick="toggleDish(${restaurantId}, ${dish.id})">
            <div class="menu-item-header">
                <span class="menu-item-name">${dish.nombre}</span>
                <span class="menu-item-check">${selectedDishes.includes(dish.id) ? '✓' : ''}</span>
            </div>
            <div class="menu-item-details">
                <span class="menu-item-time">⏱️ ${dish.tiempoPreparacion.toFixed(1)}s</span>
            </div>
        </div>
    `).join('');
}

// Selecciona/deselecciona platillo
function toggleDish(restaurantId, dishId) {
    const index = selectedDishes.indexOf(dishId);
    
    if (index > -1) {
        selectedDishes.splice(index, 1);
    } else {
        selectedDishes.push(dishId);
    }
    
    displayMenu(restaurantId);
    updateOrderSummary();
}

// Calcula tiempo total del pedido
function calculateOrderDetails(restaurantId) {
    if (!restaurantId || selectedDishes.length === 0 || !restaurantMenus[restaurantId]) {
        return { totalTime: 0, dishNames: [] };
    }
    
    const menu = restaurantMenus[restaurantId];
    let totalTime = 0;
    const dishNames = [];
    
    selectedDishes.forEach(dishId => {
        const dish = menu.find(d => d.id === dishId);
        if (dish) {
            totalTime += parseFloat(dish.tiempoPreparacion);
            dishNames.push(dish.nombre);
        }
    });
    
    return { totalTime, dishNames };
}

// Actualiza display del restaurante seleccionado
function updateRestaurantDisplay() {
    let statusBadge = '';
    if (selectedRestaurant && typeof restaurantStates !== 'undefined' && restaurantStates[selectedRestaurant.id]) {
        const estado = restaurantStates[selectedRestaurant.id];
        if (estado === 'CARGADO') {
            statusBadge = '<span style="color: #2bff00ff; font-weight: bold; margin-left: 8px;">CARGADO (SJF)</span>';
        }
    }
    
    dom.restaurantDisplay.innerHTML = selectedRestaurant ? `
        <div class="location-selected">
            <div class="location-icon">🍽️</div>
            <div class="location-info">
                <div class="location-name">Restaurante R${selectedRestaurant.id}${statusBadge}</div>
                <div class="location-coords">Av${selectedRestaurant.av} - Ca${selectedRestaurant.ca}</div>
            </div>
            <div class="location-check">✓</div>
        </div>` : `
        <div class="location-placeholder">
            <p>🍽️ Clic en Restaurante (R)</p>
        </div>`;
}

// Actualiza display de la casa seleccionada
function updateHouseDisplay() {
    dom.houseDisplay.innerHTML = selectedDestination ? `
        <div class="location-selected">
            <div class="location-icon">🏠</div>
            <div class="location-info">
                <div class="location-name">Casa H${selectedDestination.id}</div>
                <div class="location-coords">Av${selectedDestination.av} - Ca${selectedDestination.ca}</div>
            </div>
            <div class="location-check">✓</div>
        </div>` : `
        <div class="location-placeholder">
            <p>🏠 Clic en Casa (H)</p>
        </div>`;
}

// Actualiza resumen del pedido
function updateOrderSummary() {
    const canCreate = selectedRestaurant && selectedDestination && selectedDishes.length > 0;
    
    dom.btnCreateOrder.disabled = !canCreate;
    
    if (canCreate) {
        dom.btnCreateOrder.textContent = 'Crear Pedido';
        dom.btnCreateOrder.classList.add('btn-ready');
    } else if (selectedRestaurant && selectedDestination) {
        dom.btnCreateOrder.textContent = 'Selecciona platillos del menú';
        dom.btnCreateOrder.classList.remove('btn-ready');
    } else {
        dom.btnCreateOrder.textContent = 'Selecciona Restaurante y Casa';
        dom.btnCreateOrder.classList.remove('btn-ready');
    }
    
    const orderDetails = selectedRestaurant ? 
        calculateOrderDetails(selectedRestaurant.id) : 
        { totalTime: 0, dishNames: [] };
    
    dom.summaryRestaurant.textContent = selectedRestaurant ? `R${selectedRestaurant.id}` : '❌';
    dom.summaryItems.textContent = selectedDishes.length > 0 ? `${selectedDishes.length} platillo(s)` : '-';
    dom.summaryTime.textContent = selectedDishes.length > 0 ? `~${orderDetails.totalTime.toFixed(1)}s` : '-';
    dom.summaryDestination.textContent = selectedDestination ? `H${selectedDestination.id}` : '❌';
}

// Crea un nuevo pedido manual
function createOrder() {
    if (!selectedRestaurant || !selectedDestination || selectedDishes.length === 0) return;
    
    const orderDetails = calculateOrderDetails(selectedRestaurant.id);
    const tempOrderId = orderCounter++;
    totalOrdersCreated++;
    
    // Crear pedido temporal
    const order = {
        id: tempOrderId,
        receiptNumber: `TEMP-${tempOrderId}`,
        numeroRecibo: `TEMP-${tempOrderId}`,
        restaurant: selectedRestaurant,
        destination: selectedDestination,
        dishes: [...selectedDishes],
        dishNames: orderDetails.dishNames,
        totalTime: orderDetails.totalTime,
        status: 'Esperando STM32...',
        progress: 0,
        timestamp: new Date(),
        isTemporary: true,
        isSTM32Order: false,
        elapsedTime: 0,
        createdAt: Date.now()
    };
    
    activeOrders.push(order);
    orderIndexByReceipt.set(order.receiptNumber, activeOrders.length - 1);
    displayActiveOrders();
    updateCancelOrdersTable();
    
    lastManualOrderTime = Date.now();
    
    const command = `PEDIDO_WEB,${selectedRestaurant.id},${selectedDestination.id},${selectedDishes.join(',')}`;
    
    if (window.ws?.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
            type: "send_to_stm32",
            payload: command
        }));
        
        console.log(`✅ Pedido manual enviado: ${command}`);
        
        if (typeof incrementRestaurantDishes !== 'undefined') {
            incrementRestaurantDishes(selectedRestaurant.id);
        }
    } else {
        console.error('WebSocket no conectado');
        activeOrders.pop();
        orderIndexByReceipt.delete(order.receiptNumber);
        displayActiveOrders();
        updateCancelOrdersTable();
    }
    
    selectedDishes = [];
    displayMenu(selectedRestaurant.id);
    updateOrderSummary();
}

// Cancela un pedido
window.cancelOrder = function(receiptNumber) {
    const order = findOrderByReceipt(receiptNumber);
    
    if (!order) {
        console.error('Pedido no encontrado');
        return;
    }
    
    console.log(`Cancelando pedido: ${receiptNumber}`);
    
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
            type: "send_to_stm32",
            payload: `CANCELAR_PEDIDO,${receiptNumber}`
        }));
        console.log('Señal de cancelación enviada al STM32');
    } else {
        console.error('WebSocket no conectado');
    }
};

// Actualiza tabla de pedidos cancelables
function updateCancelOrdersTable() {
    const cancelableOrders = activeOrders.filter(order => {
        if (order.status.includes('Entregado') || order.entregado === true) {
            return false;
        }
        
        return order.status.includes('En cola') || 
               order.status.includes('Preparando') ||
               order.status.includes('Preparado') ||
               order.status.includes('Asignado') ||
               order.status.includes('camino') ||
               order.status === 'Esperando STM32...';
    });
    
    if (cancelableOrders.length === 0) {
        dom.cancelOrdersTable.innerHTML = `
            <div class="cancel-orders-empty">
                <div class="cancel-orders-empty-icon">📋</div>
                <p>Sin pedidos activos</p>
            </div>`;
        return;
    }
    
    dom.cancelOrdersTable.innerHTML = cancelableOrders.map(order => {
        const orderNum = order.receiptNumber || order.numeroRecibo || `#${order.id}`;
        const restInfo = order.restaurant && order.restaurant.id !== '?' ? `R${order.restaurant.id}` : '?';
        const destInfo = order.destination && order.destination.id !== '?' ? `H${order.destination.id}` : '?';
        const platillos = order.dishNames && order.dishNames.length > 0 
            ? order.dishNames.join(', ') 
            : 'Sin platillos';
        
        let statusIcon = '⏳';
        if (order.status.includes('Preparando')) statusIcon = '👨‍🍳';
        if (order.status.includes('Preparado')) statusIcon = '✅';
        if (order.status.includes('Asignado') || order.status.includes('camino')) statusIcon = '🚗';
        
        return `
            <div class="cancel-order-row">
                <div class="cancel-order-info">
                    <div class="cancel-order-id">${statusIcon} ${orderNum}</div>
                    <div class="cancel-order-details">
                        ${restInfo} → ${destInfo} | ${platillos}
                    </div>
                </div>
                <button class="cancel-order-btn" onclick="cancelOrder('${order.receiptNumber || order.numeroRecibo}')">
                    Cancelar
                </button>
            </div>`;
    }).join('');
}

// Muestra todos los pedidos activos
function displayActiveOrders() {
    const preparing = [];
    const ready = [];
    const delivering = [];
    
    activeOrders.forEach(o => {
        // Ignorar pedidos eliminados
        if (o._eliminado) return;
        
        if (o.status === 'Preparando' || o.status === 'En cola' || o.status === 'Esperando STM32...') {
            preparing.push(o);
        } else if (o.status.includes('Preparado')) {
            ready.push(o);
        } else if (o.status.includes('Asignado') || o.status.includes('camino') || o.status.includes('Entregado')) {
            delivering.push(o);
        }
    });
    
    const totalActive = preparing.length + ready.length + delivering.length;
    
    const emptyState = (icon) => `<div class="tracking-empty"><span class="tracking-icon">${icon}</span><p>Sin pedidos</p></div>`;
    
    dom.trackingPreparing.innerHTML = preparing.length === 0 ? emptyState('👨‍🍳') : preparing.map(renderOrderCard).join('');
    dom.trackingReady.innerHTML = ready.length === 0 ? emptyState('✅') : ready.map(renderOrderCard).join('');
    dom.trackingDelivering.innerHTML = delivering.length === 0 ? emptyState('🚚') : delivering.map(renderOrderCard).join('');
    
    document.querySelector('.tracking-column:nth-child(1) .tracking-column-header').innerHTML = `
        <span class="status-icon">👨‍🍳</span>
        <span>Preparando (${preparing.length})</span>
    `;
    document.querySelector('.tracking-column:nth-child(2) .tracking-column-header').innerHTML = `
        <span class="status-icon">✅</span>
        <span>Listos (${ready.length})</span>
    `;
    document.querySelector('.tracking-column:nth-child(3) .tracking-column-header').innerHTML = `
        <span class="status-icon">🚚</span>
        <span>En Ruta (${delivering.length})</span>
    `;
    
    document.querySelector('.section-title-main').textContent = `ESTADO DE PEDIDOS EN TIEMPO REAL - TOTAL CREADOS: ${totalOrdersCreated} | EN CIRCULACIÓN: ${totalActive}`;
}

// Renderiza una tarjeta de pedido
function renderOrderCard(o) {
    let timeDisplay = '';
    let progressPercent = o.progress;
    
    if (o.status === 'Preparando' && o.startTime) {
        // Usar tiempo guardado
        const elapsed = o.elapsedTime || 0;
        const remaining = Math.max(0, o.totalTime - elapsed);
        timeDisplay = `⏱️ ${remaining.toFixed(1)}s`;
        progressPercent = Math.min(100, (elapsed / o.totalTime) * 100);
    } else if (o.status === 'En cola') {
        timeDisplay = `⏳ Esperando turno...`;
        progressPercent = 0;
    } else if (o.totalTime > 0) {
        timeDisplay = `⏱️ ${o.totalTime.toFixed(1)}s`;
    } else {
        timeDisplay = '⏱️ STM32';
    }
    
    const orderNum = o.receiptNumber || o.numeroRecibo || `#${o.id}`;
    const originInfo = o.restaurant && o.restaurant.id !== '?' ? `R${o.restaurant.id}` : 'STM32';
    const destInfo = o.destination && o.destination.id !== '?' ? `H${o.destination.id}` : 'STM32';
    
    return `
    <div class="tracking-card" data-order-id="${o.id}">
        <div class="tracking-header">
            <div class="tracking-order-id">🍔 ${orderNum}</div>
            <div class="tracking-status">${o.status}</div>
        </div>
        <div class="tracking-body">
            <div class="tracking-info">
                <span class="tracking-label">Desde:</span>
                <span class="tracking-value">${originInfo}</span>
            </div>
            <div class="tracking-info">
                <span class="tracking-label">Hacia:</span>
                <span class="tracking-value">${destInfo}</span>
            </div>
            <div class="tracking-info">
                <span class="tracking-label">Tiempo:</span>
                <span class="tracking-value" id="time-${o.id}">${timeDisplay}</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" id="progress-${o.id}" style="width: ${progressPercent}%"></div>
            </div>
        </div>
    </div>`;
}

// Actualiza cronómetros cada 100ms
setInterval(() => {
    activeOrders.forEach(order => {
        // Ignorar eliminados o entregados
        if (order._eliminado || order.entregado) return;
        
        if (order.status === 'Preparando' && order.startTime) {
            // Actualizar tiempo guardado
            order.elapsedTime = (Date.now() - order.startTime) / 1000;
            
            const timeElement = document.getElementById(`time-${order.id}`);
            const progressElement = document.getElementById(`progress-${order.id}`);
            
            if (timeElement && progressElement) {
                const remaining = Math.max(0, order.totalTime - order.elapsedTime);
                const progressPercent = Math.min(100, (order.elapsedTime / order.totalTime) * 100);
                
                timeElement.textContent = `⏱️ ${remaining.toFixed(1)}s`;
                progressElement.style.width = `${progressPercent}%`;
            }
        }
    });
}, 100);

// Actualiza tabla de repartidores
function updateRepartidoresTable() {
    const tbody = document.getElementById('repartidoresTableBody');
    
    if (!tbody || !map2Data.repartidores) return;
    
    const reps = Object.entries(map2Data.repartidores);
    
    if (reps.length === 0) {
        tbody.innerHTML = '<tr class="info-empty"><td colspan="5">Sin repartidores</td></tr>';
        return;
    }
    
    tbody.innerHTML = reps.map(([id, data]) => {
        const pos = `Av${data.av} - Ca${data.ca}`;
        
        let pedidosActivos = 0;
        let pedidosInfo = [];
        
        for (let order of activeOrders) {
            const orderId = parseInt(order.repartidorId);
            const repId = parseInt(id);
            
            if (orderId === repId && !order.entregado && !order.status.includes('Entregado')) {
                pedidosActivos++;
                pedidosInfo.push(order.receiptNumber || order.numeroRecibo || `#${order.id}`);
            }
        }
        
        let estado = 'DESOCUPADO';
        if (typeof map2 !== 'undefined' && map2.driverStates && map2.driverStates[id]) {
            estado = map2.driverStates[id];
        }
        
        let badgeClass, estadoTexto, pedidosTexto;
        
        switch(estado) {
            case 'EN_CAMINO_A_RESTAURANTE':
                badgeClass = 'badge-en-ruta-rest';
                estadoTexto = 'Yendo a restaurante';
                break;
            case 'RECOGIENDO':
                badgeClass = 'badge-recogiendo';
                estadoTexto = 'Recogiendo pedido';
                break;
            case 'EN_CAMINO_A_DESTINO':
                badgeClass = 'badge-en-ruta-casa';
                estadoTexto = 'Yendo a entregar';
                break;
            case 'ENTREGANDO':
                badgeClass = 'badge-entregando';
                estadoTexto = 'Entregando';
                break;
            case 'DESOCUPADO':
            default:
                badgeClass = 'badge-disponible';
                estadoTexto = 'Disponible';
        }
        
        if (pedidosActivos === 0) {
            pedidosTexto = '<span style="color: #888;">Sin pedidos</span>';
        } else if (pedidosActivos === 1) {
            pedidosTexto = `<span style="color: #00ffff; font-weight: 800;">${pedidosInfo[0]}</span>`;
        } else {
            pedidosTexto = `<span style="color: #ffaa00; font-weight: 800;">${pedidosActivos} pedidos</span>`;
        }
        
        return `
            <tr>
                <td style="color: #f1c40f; font-weight: 900;">M${id}</td>
                <td>Repartidor ${parseInt(id) + 1}</td>
                <td style="color: #00d9ff;">${pos}</td>
                <td><span class="info-badge ${badgeClass}">${estadoTexto}</span></td>
                <td>${pedidosTexto}</td>
            </tr>
        `;
    }).join('');
}

// Actualiza tabla de restaurantes
function updateRestaurantesTable() {
    const tbody = document.getElementById('restaurantesTableBody');
    
    if (!tbody || !map1Data.restaurantes) return;
    
    const rests = Object.entries(map1Data.restaurantes);
    
    if (rests.length === 0) {
        tbody.innerHTML = '<tr class="info-empty"><td colspan="4">Sin restaurantes</td></tr>';
        return;
    }
    
    tbody.innerHTML = rests.map(([id, data]) => {
        const pos = `Av${data.av} - Ca${data.ca}`;
        
        const estado = restaurantStates[id] || 'NORMAL';
        const algoritmo = estado === 'CARGADO' ? 'SJF' : 'FCFS';
        const badgeClass = algoritmo === 'SJF' ? 'badge-sjf' : 'badge-fcfs';
        
        return `
            <tr>
                <td style="color: #e74c3c; font-weight: 900;">R${id}</td>
                <td>Restaurante ${id}</td>
                <td style="color: #00d9ff;">${pos}</td>
                <td><span class="info-badge ${badgeClass}">${algoritmo}</span></td>
            </tr>
        `;
    }).join('');
}

// Actualiza tabla de casas
function updateCasasTable() {
    const tbody = document.getElementById('casasTableBody');
    
    if (!tbody || !map1Data.casas) return;
    
    const casas = Object.entries(map1Data.casas);
    
    if (casas.length === 0) {
        tbody.innerHTML = '<tr class="info-empty"><td colspan="4">Sin casas</td></tr>';
        return;
    }
    
    tbody.innerHTML = casas.map(([id, data]) => {
        const pos = `Av${data.av} - Ca${data.ca}`;
        
        let tienesPedidos = false;
        for (let order of activeOrders) {
            if (order.destination && order.destination.id == id && !order.entregado) {
                tienesPedidos = true;
                break;
            }
        }
        
        const badgeClass = tienesPedidos ? 'badge-ocupado' : 'badge-disponible';
        const badgeText = tienesPedidos ? 'Pedido activo' : 'Disponible';
        
        return `
            <tr>
                <td style="color: #3498db; font-weight: 900;">H${id}</td>
                <td>Casa ${id}</td>
                <td style="color: #00d9ff;">${pos}</td>
                <td><span class="info-badge ${badgeClass}">${badgeText}</span></td>
            </tr>
        `;
    }).join('');
}

// Actualiza todas las tablas
function updateAllInfoTables() {
    updateRestaurantesTable();
    updateCasasTable();
    updateRepartidoresTable();
}

// Actualizar cada segundo
setInterval(() => {
    updateAllInfoTables();
}, 1000);

// Inicializa contadores de platillos
window.addEventListener('load', () => {
    const initDishesData = setInterval(() => {
        if (typeof map1Data !== 'undefined' && 
            map1Data.restaurantes && 
            Object.keys(map1Data.restaurantes).length > 0 &&
            typeof restaurantDishesData !== 'undefined') {
            
            console.log('🍽️ Inicializando datos de platillos por restaurante');
            
            Object.keys(map1Data.restaurantes).forEach(restaurantId => {
                if (!restaurantDishesData.has(restaurantId)) {
                    restaurantDishesData.set(restaurantId, { total: 0, pending: 0 });
                    console.log(`📊 Restaurante R${restaurantId} inicializado: Total=0, Pendientes=0`);
                }
            });
            
            if (typeof updateDishesCharts !== 'undefined') {
                updateDishesCharts();
            }
            
            clearInterval(initDishesData);
            console.log('✅ Sistema de métricas de platillos listo');
        }
    }, 500);
    
    setTimeout(() => clearInterval(initDishesData), 10000);
});

// Completa datos de pedido automático
window.completeAutoOrder = function(orderNumber, restId, destId, dishCount) {
    console.log(`📦 Completando pedido automático ${orderNumber}: R${restId} → H${destId}`);
    
    const order = findOrderByReceipt(orderNumber);
    
    if (!order) {
        console.warn(`⚠️ No se encontró pedido ${orderNumber} para completar`);
        return;
    }
    
    // Datos del restaurante
    if (map1Data.restaurantes && map1Data.restaurantes[restId]) {
        const rest = map1Data.restaurantes[restId];
        order.restaurant = {
            id: restId,
            av: rest.av,
            ca: rest.ca
        };
        console.log(`🍽️ Restaurante asignado: R${restId} (Av${rest.av}-Ca${rest.ca})`);
    } else {
        console.warn(`⚠️ Restaurante R${restId} no encontrado en map1Data`);
    }
    
    // Datos de la casa
    if (map1Data.casas && map1Data.casas[destId]) {
        const house = map1Data.casas[destId];
        order.destination = {
            id: destId,
            av: house.av,
            ca: house.ca
        };
        console.log(`🏠 Destino asignado: H${destId} (Av${house.av}-Ca${house.ca})`);
    } else {
        console.warn(`⚠️ Casa H${destId} no encontrada en map1Data`);
    }
    
    // Info de platillos
    if (dishCount) {
        order.dishNames = [`${dishCount} platillo(s) - STM32`];
    }
    
    // Incrementar contador
    if (typeof incrementRestaurantDishes !== 'undefined') {
        incrementRestaurantDishes(restId);
        console.log(`📊 Platillo agregado a R${restId}`);
    }
    
    console.log(`✅ Pedido ${orderNumber} completado:`, order);
    
    displayActiveOrders();
    updateCancelOrdersTable();
};

// Procesa solicitud automática del STM32
window.processAutoOrderRequest = function(restId, destId, dishesStr) {
    console.log(`🤖 Pedido automático: R${restId} → H${destId}, platillos: ${dishesStr}`);
    
    if (!map1Data.restaurantes?.[restId] || !map1Data.casas?.[destId]) {
        console.error(`❌ Datos inválidos`);
        return;
    }
    
    const dishIds = dishesStr.split(',').map(d => parseInt(d.trim()));
    
    // Guardar datos para próximo ORDER_CREATED
    lastAutoOrderData = {
        restId: restId,
        destId: destId,
        dishes: dishIds,
        timestamp: Date.now()
    };
    
    console.log(`📝 Datos guardados para próximo ORDER_CREATED automático:`, lastAutoOrderData);
    
    const command = `PEDIDO_WEB,${restId},${destId},${dishIds.join(',')}`;
    
    if (window.ws?.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
            type: "send_to_stm32",
            payload: command
        }));
        
        console.log(`✅ Enviado: ${command}`);
        
        if (typeof incrementRestaurantDishes !== 'undefined') {
            incrementRestaurantDishes(restId);
        }
    } else {
        console.error('❌ WebSocket no conectado');
        lastAutoOrderData = null;
    }
};