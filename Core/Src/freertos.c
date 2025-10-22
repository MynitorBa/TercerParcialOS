/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "cmsis_os.h"
#include "usart.h"
#include "gpio.h"
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "semphr.h"
#include "event_groups.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

/* External ------------------------------------------------------------------*/
extern void SystemClock_Config(void);
extern UART_HandleTypeDef huart2;

/* Defines -------------------------------------------------------------------*/
#define MAX_GRID_SIZE 20
#define MAX_REPARTIDORES 10
#define MAX_PEDIDOS 50
#define MAX_RESTAURANTES 10
#define MAX_CASAS 20
#define MAX_PLATILLOS 10
#define MAX_MENU 6
#define INF 999999
#define MAX_PEDIDOS_POR_REPARTIDOR 3
#define MAX_COLA_RESTAURANTE 10

/* Event Group Bits ----------------------------------------------------------*/
#define EVENT_PEDIDO_LISTO (1 << 0)

/* Enumerations --------------------------------------------------------------*/
typedef enum {
    CREADO,
    PREPARANDO,
    LISTO,
    BUSCANDO_MOTORISTA,
    ACEPTADO,
    EN_CAMINO_RESTAURANTE,
    RECOGIDO,
    EN_CAMINO_DESTINO,
    ENTREGADO,
    CANCELADO
} EstadoPedido;

typedef enum {
    FCFS,  // First Come First Served
    SJF    // Shortest Job First
} AlgoritmoPreparacion;

typedef enum {
    DESOCUPADO,
    EN_CAMINO_A_RESTAURANTE,
    RECOGIENDO,
    EN_CAMINO_A_DESTINO,
    ENTREGANDO
} EstadoRepartidor;

/* Structures ----------------------------------------------------------------*/
typedef struct {
    int posx;
    int posy;
} Posicion;

typedef struct {
    char nombre[32];
    float tiempoPreparacion;
} Platillo;

typedef struct {
    int id;
    Posicion posxy;
    Posicion posxyUnificado;
    char direccion;
    char nombre[32];
    Platillo menu[MAX_MENU];
    int numPlatillos;
    int cantidadDeCambio;
    AlgoritmoPreparacion algoritmo;
    int colaPedidosCount;
    int colaPedidos[MAX_PEDIDOS];
} Restaurante;

typedef struct {
    int id;
    Posicion posxy;
    Posicion posxyUnificado;
    char direccion;
    char nombre[32];
} Casa;

typedef struct {
    int id;
    Posicion posRestaurante;
    Posicion posCasa;
    int idRestaurante;
    int idCasa;
    char numeroRecibo[20];
    EstadoPedido estado;
    float tiempoPreparacion;
    int asignado;
    int enPreparacion;
    int listo;
    int enReparto;
    int entregado;
    int repartidorId;
    int platillosCount;
    int platillos[MAX_PLATILLOS];
    uint32_t tiempoInicioPreparacion;
    int reintentosAsignacion;

    // Timestamps
    uint32_t t_creado;
    uint32_t t_inicioPrep;
    uint32_t t_finPrep;
    uint32_t t_asignado;
    uint32_t t_recogido;
    uint32_t t_entregado;

    int metricsSent;
} Pedido;

typedef struct {
    char nombre[32];
    float velocidad;
    Posicion posxy;
    Posicion posxyUnificado;
    int activo;
    int enRuta;
    Posicion destino;
    char tipoDestino[20];

    // Múltiples pedidos
    char pedidosAceptados[MAX_PEDIDOS_POR_REPARTIDOR][20];
    int numPedidosAceptados;
    int capacidadMaxima;
    int indicePedidoActual;

    // Control de desvíos
    int desvioMaximoPermitido;
    float factorDesvio;

    // Estadísticas
    int pedidosAceptadosPorRR;
    int pedidosRechazadosPorDesvio;
    int pedidosEntregados;

    EstadoRepartidor estado;
    int fase;

    uint32_t tiempoEspera;
    int bloqueado;

} Repartidor;

typedef struct {
    float promedioTotal;
    float promedioPreparacion;
    float promedioEspera;
    float promedioEntrega;

    float percentil50Total;
    float percentil95Total;

    float percentil50Prep;
    float percentil95Prep;

    int pedidosAnalizados;
} MetricasGlobales;

MetricasGlobales metricas;

typedef struct {
    int calles;
    int avenidas;
    int numRestaurantes;
    int numCasas;
    int numRepartidores;
    char grilla[MAX_GRID_SIZE][MAX_GRID_SIZE];
    char grillaMapa[MAX_GRID_SIZE][MAX_GRID_SIZE];
    char mapaUnificado[MAX_GRID_SIZE * 2][MAX_GRID_SIZE * 2];
    int tamanioUnificado;
    Restaurante listaRestaurantes[MAX_RESTAURANTES];
    Casa listaCasas[MAX_CASAS];
    Repartidor listaRepartidores[MAX_REPARTIDORES];
    Pedido listaPedidos[MAX_PEDIDOS];
    int numPedidos;
    int sistemaCorriendo;
} SistemaRepartidores;

typedef struct {
    Posicion pos;
    int g;
    int h;
    int f;
} NodoA;

/* Variables -----------------------------------------------------------------*/
QueueHandle_t queueRx;
QueueHandle_t queuePedidos;
QueueHandle_t queueButton;
QueueHandle_t queuePedidosListos;
uint8_t rxByte;

SistemaRepartidores sistema;
int sistemaInicializado = 0;
int contadorPedidos = 1;

SemaphoreHandle_t semCapacidadCola;
EventGroupHandle_t eventGroupPedidos;
SemaphoreHandle_t mutexSistema;
SemaphoreHandle_t mutexRepartidores[MAX_REPARTIDORES];
SemaphoreHandle_t mutexRestaurantes[MAX_RESTAURANTES];

int indiceMotoristaRR = 0;

/* Task handles --------------------------------------------------------------*/
osThreadId_t TaskTxHandle;
osThreadId_t TaskRxHandle;
osThreadId_t TaskRestaurantesHandle;
osThreadId_t TaskRepartidoresHandle;
osThreadId_t TaskAsignadorHandle;

/* Function prototypes -------------------------------------------------------*/
void StartTaskTx(void *argument);
void StartTaskRx(void *argument);
void StartTaskRestaurantes(void *argument);
void StartTaskRepartidores(void *argument);
void StartTaskAsignador(void *argument);
void inicializarSistema(int calles, int avenidas, int rest, int casas, int rep);
void calcularMetricasGlobales(void);
void enviarMetricasGlobales(void);
void crearMapaUnificado(void);
void actualizarPosicionesAlMapaUnificado(void);
void enviarMapaCompleto(void);
void enviarMapaCombinado(void);
void enviarEventoPedido(const char *evento, const char *numeroRecibo, const char *driver, const char *prepTime, int restaurantId, int destinationId);
void moverRepartidor(int idRep);
int calcularDistancia(Posicion a, Posicion b);
void asignarPedidoARepartidor(int pedidoId);
void crearRuta(int repId, Posicion origen, Posicion destino);
void regenerarMapa(void);
void crearPedidoAleatorio(void);
void procesarPedidosRestaurante(int idRest);
void floatToStr(float val, char *str, int maxLen);
Posicion calcularSiguientePasoAStar(Posicion inicio, Posicion destino);
int heuristica(Posicion a, Posicion b);
Pedido* buscarPedido(const char* numeroRecibo);
Posicion getPuntoAccesoRestaurante(int idRest);
Posicion getPuntoAccesoCasa(int idCasa);
Posicion obtenerDestinoActual(int idRep, Pedido* p);
int calcularDesvioRuta(int idRep, Pedido* nuevoPedido);
float calcularScoreCompleto(int idRep, Pedido* pedido, int desvio);
int verificarConfirmacion(float score, int desvio, int idRep);
void enviarEstadisticas(void);

/* Helper Functions ----------------------------------------------------------*/

// Convierte posición unificada a Avenida/Calle
void convertirUnificadoAAvCa(Posicion posUnificado, int *av, int *ca) {
    *av = posUnificado.posy + 1;
    *ca = (sistema.tamanioUnificado - posUnificado.posx);
}

// Convierte Avenida/Calle a posición unificada
Posicion convertirAvCaAUnificado(int av, int ca) {
    Posicion pos;
    pos.posy = av - 1;
    pos.posx = sistema.tamanioUnificado - ca;
    return pos;
}

// Convierte float a string con 2 decimales
void floatToStr(float val, char *str, int maxLen) {
    int intPart = (int)val;
    int fracPart = (int)((val - intPart) * 100);
    if (fracPart < 0) fracPart = -fracPart;
    snprintf(str, maxLen, "%d.%02d", intPart, fracPart);
}

// Distancia Manhattan entre dos posiciones
int calcularDistancia(Posicion a, Posicion b) {
    return abs(a.posx - b.posx) + abs(a.posy - b.posy);
}

// Envía datos por UART
void enviarPorUART(const char *data) {
    uint16_t len = strlen(data);
    HAL_UART_Transmit(&huart2, (uint8_t*)data, len, 200);
}

// Busca pedido por número de recibo
Pedido* buscarPedido(const char* numeroRecibo) {
    for (int i = 0; i < sistema.numPedidos; i++) {
        if (strcmp(sistema.listaPedidos[i].numeroRecibo, numeroRecibo) == 0) {
            return &sistema.listaPedidos[i];
        }
    }
    return NULL;
}

// Obtiene punto de acceso del restaurante
Posicion getPuntoAccesoRestaurante(int idRest) {
    Posicion punto = sistema.listaRestaurantes[idRest].posxyUnificado;
    char direccion = sistema.listaRestaurantes[idRest].direccion;

    switch(direccion) {
        case 'U': punto.posx -= 1; break;
        case 'D': punto.posx += 1; break;
        case 'L': punto.posy -= 1; break;
        case 'R': punto.posy += 1; break;
    }

    return punto;
}

// Obtiene punto de acceso de la casa
Posicion getPuntoAccesoCasa(int idCasa) {
    Posicion punto = sistema.listaCasas[idCasa].posxyUnificado;
    char direccion = sistema.listaCasas[idCasa].direccion;

    switch(direccion) {
        case 'u': punto.posx -= 1; break;
        case 'd': punto.posx += 1; break;
        case 'l': punto.posy -= 1; break;
        case 'r': punto.posy += 1; break;
    }

    return punto;
}

// Determina destino actual del repartidor
Posicion obtenerDestinoActual(int idRep, Pedido* p) {
    Repartidor* rep = &sistema.listaRepartidores[idRep];

    if (p == NULL) return rep->posxyUnificado;

    switch(rep->estado) {
        case EN_CAMINO_A_RESTAURANTE:
        case RECOGIENDO:
            return getPuntoAccesoRestaurante(p->idRestaurante);

        case EN_CAMINO_A_DESTINO:
        case ENTREGANDO:
            return getPuntoAccesoCasa(p->idCasa);

        default:
            return rep->posxyUnificado;
    }
}

// Calcula desvío de ruta con nuevo pedido
int calcularDesvioRuta(int idRep, Pedido* nuevoPedido) {
    Repartidor* rep = &sistema.listaRepartidores[idRep];

    if (rep->estado == DESOCUPADO || rep->numPedidosAceptados == 0) {
        return 0;
    }

    char* reciboActual = rep->pedidosAceptados[rep->indicePedidoActual];
    Pedido* pedidoActual = buscarPedido(reciboActual);

    if (pedidoActual == NULL || nuevoPedido == NULL) {
        return 999;
    }

    Posicion destino_actual = obtenerDestinoActual(idRep, pedidoActual);
    int distanciaOriginal = calcularDistancia(rep->posxyUnificado, destino_actual);

    Posicion puntoRecogidaNuevo = getPuntoAccesoRestaurante(nuevoPedido->idRestaurante);

    int distanciaConDesvio = calcularDistancia(rep->posxyUnificado, puntoRecogidaNuevo) +
                              calcularDistancia(puntoRecogidaNuevo, destino_actual);

    return distanciaConDesvio - distanciaOriginal;
}

// Calcula score de prioridad para asignación
float calcularScoreCompleto(int idRep, Pedido* pedido, int desvio) {
    Repartidor* rep = &sistema.listaRepartidores[idRep];

    Posicion puntoRecogida = getPuntoAccesoRestaurante(pedido->idRestaurante);
    int dist = calcularDistancia(rep->posxyUnificado, puntoRecogida);
    float score = 100.0f - (float)dist;

    score -= (float)rep->numPedidosAceptados * 10.0f;

    if (rep->numPedidosAceptados > 0) {
        char* reciboActual = rep->pedidosAceptados[rep->indicePedidoActual];
        Pedido* actual = buscarPedido(reciboActual);

        if (actual != NULL && actual->idRestaurante == pedido->idRestaurante) {
            score += 50.0f;
        }
        else if (desvio <= 3) {
            score += 20.0f;
        }
    }

    if (rep->estado == DESOCUPADO) {
        score += 5.0f;
    }

    if (desvio > rep->desvioMaximoPermitido) {
        score -= (float)desvio * 2.0f;
    }

    return score;
}

// Verifica si el repartidor acepta el pedido
int verificarConfirmacion(float score, int desvio, int idRep) {
    Repartidor* rep = &sistema.listaRepartidores[idRep];

    int random = rand() % 100;

    if (desvio > rep->desvioMaximoPermitido) {
        return (random < 5);
    }

    if (score >= 70.0f) {
        return 1;
    }

    if (score >= 50.0f) {
        return (random < 60);
    }

    if (score >= 30.0f) {
        return (random < 25);
    }

    return (random < 10);
}

/* Algoritmo A* --------------------------------------------------------------*/

// Heurística Manhattan para A*
int heuristica(Posicion a, Posicion b) {
    return abs(a.posx - b.posx) + abs(a.posy - b.posy);
}

// Calcula siguiente paso con A*
Posicion calcularSiguientePasoAStar(Posicion inicio, Posicion destino) {
    if (inicio.posx == destino.posx && inicio.posy == destino.posy) {
        return inicio;
    }

    int filas = sistema.tamanioUnificado;
    int columnas = sistema.tamanioUnificado;

    static int gscore[MAX_GRID_SIZE * 2][MAX_GRID_SIZE * 2];
    static int cerrado[MAX_GRID_SIZE * 2][MAX_GRID_SIZE * 2];
    static Posicion padre[MAX_GRID_SIZE * 2][MAX_GRID_SIZE * 2];

    for (int i = 0; i < filas; i++) {
        for (int j = 0; j < columnas; j++) {
            gscore[i][j] = INF;
            cerrado[i][j] = 0;
            padre[i][j].posx = -1;
            padre[i][j].posy = -1;
        }
    }

    NodoA openList[MAX_GRID_SIZE * MAX_GRID_SIZE];
    int openCount = 0;

    gscore[inicio.posx][inicio.posy] = 0;
    openList[openCount].pos = inicio;
    openList[openCount].g = 0;
    openList[openCount].h = heuristica(inicio, destino);
    openList[openCount].f = openList[openCount].g + openList[openCount].h;
    openCount++;

    const int dx[4] = {-1, 1, 0, 0};
    const int dy[4] = {0, 0, -1, 1};

    while (openCount > 0) {
        int minIdx = 0;
        for (int i = 1; i < openCount; i++) {
            if (openList[i].f < openList[minIdx].f) {
                minIdx = i;
            }
        }

        NodoA actual = openList[minIdx];

        for (int i = minIdx; i < openCount - 1; i++) {
            openList[i] = openList[i + 1];
        }
        openCount--;

        int x = actual.pos.posx;
        int y = actual.pos.posy;

        if (cerrado[x][y]) continue;
        cerrado[x][y] = 1;

        if (x == destino.posx && y == destino.posy) break;

        for (int k = 0; k < 4; k++) {
            int nx = x + dx[k];
            int ny = y + dy[k];

            if (nx < 0 || nx >= filas || ny < 0 || ny >= columnas) continue;
            if (sistema.mapaUnificado[nx][ny] != 'o' && sistema.mapaUnificado[nx][ny] != 'p') {
                if (!(nx == destino.posx && ny == destino.posy)) continue;
            }
            if (cerrado[nx][ny]) continue;

            int tentative_g = actual.g + 1;
            if (tentative_g < gscore[nx][ny]) {
                gscore[nx][ny] = tentative_g;
                padre[nx][ny] = actual.pos;

                int h = heuristica((Posicion){nx, ny}, destino);

                if (openCount < MAX_GRID_SIZE * MAX_GRID_SIZE) {
                    openList[openCount].pos.posx = nx;
                    openList[openCount].pos.posy = ny;
                    openList[openCount].g = tentative_g;
                    openList[openCount].h = h;
                    openList[openCount].f = tentative_g + h;
                    openCount++;
                }
            }
        }
    }

    if (padre[destino.posx][destino.posy].posx == -1) {
        return inicio;
    }

    Posicion paso = destino;
    while (!(padre[paso.posx][paso.posy].posx == inicio.posx &&
             padre[paso.posx][paso.posy].posy == inicio.posy)) {
        paso = padre[paso.posx][paso.posy];
        if (paso.posx == -1) return inicio;
    }

    return paso;
}

/* Sistema Functions ---------------------------------------------------------*/

// Crea mapa unificado combinando grilla y grillaMapa
void crearMapaUnificado(void) {
    sistema.tamanioUnificado = sistema.avenidas * 2 - 1;

    for (int i = 0; i < sistema.tamanioUnificado; i++) {
        for (int j = 0; j < sistema.tamanioUnificado; j++) {
            sistema.mapaUnificado[i][j] = 'o';
        }
    }

    for (int i = 0; i < sistema.avenidas; i++) {
        for (int j = 0; j < sistema.calles; j++) {
            sistema.mapaUnificado[i * 2][j * 2] = sistema.grillaMapa[i][j];
        }
    }

    for (int i = 0; i < sistema.avenidas - 1; i++) {
        for (int j = 0; j < sistema.calles - 1; j++) {
            sistema.mapaUnificado[i * 2 + 1][j * 2 + 1] = sistema.grilla[i][j];
        }
    }
}

// Actualiza posiciones al mapa unificado
void actualizarPosicionesAlMapaUnificado(void) {
    printf("{\"type\":\"info\",\"msg\":\"Actualizando posiciones al mapa unificado\"}\r\n");

    for (int r = 0; r < sistema.numRestaurantes; r++) {
        int viejaX = sistema.listaRestaurantes[r].posxy.posx;
        int viejaY = sistema.listaRestaurantes[r].posxy.posy;
        sistema.listaRestaurantes[r].posxyUnificado.posx = viejaX * 2 + 1;
        sistema.listaRestaurantes[r].posxyUnificado.posy = viejaY * 2 + 1;
    }

    for (int c = 0; c < sistema.numCasas; c++) {
        int viejaX = sistema.listaCasas[c].posxy.posx;
        int viejaY = sistema.listaCasas[c].posxy.posy;
        sistema.listaCasas[c].posxyUnificado.posx = viejaX * 2 + 1;
        sistema.listaCasas[c].posxyUnificado.posy = viejaY * 2 + 1;
    }

    for (int rep = 0; rep < sistema.numRepartidores; rep++) {
        int viejaX = sistema.listaRepartidores[rep].posxy.posx;
        int viejaY = sistema.listaRepartidores[rep].posxy.posy;
        sistema.listaRepartidores[rep].posxyUnificado.posx = viejaX * 2;
        sistema.listaRepartidores[rep].posxyUnificado.posy = viejaY * 2;
    }
}

// Limpia completamente el sistema
void limpiarSistemaCompleto(void) {
    printf("{\"type\":\"info\",\"msg\":\"LIMPIANDO SISTEMA COMPLETO...\"}\r\n");

    sistema.sistemaCorriendo = 0;
    vTaskDelay(pdMS_TO_TICKS(200));

    for (int i = 0; i < sistema.numPedidos; i++) {
        memset(&sistema.listaPedidos[i], 0, sizeof(Pedido));
    }
    sistema.numPedidos = 0;
    contadorPedidos = 1;

    for (int r = 0; r < sistema.numRestaurantes; r++) {
        if (xSemaphoreTake(mutexRestaurantes[r], pdMS_TO_TICKS(200)) == pdTRUE) {
            sistema.listaRestaurantes[r].colaPedidosCount = 0;
            for (int j = 0; j < MAX_COLA_RESTAURANTE; j++) {
                sistema.listaRestaurantes[r].colaPedidos[j] = 0;
            }
            xSemaphoreGive(mutexRestaurantes[r]);
        }
    }

    for (int i = 0; i < sistema.numRepartidores; i++) {
        if (xSemaphoreTake(mutexRepartidores[i], pdMS_TO_TICKS(200)) == pdTRUE) {
            Repartidor* rep = &sistema.listaRepartidores[i];

            rep->numPedidosAceptados = 0;
            rep->indicePedidoActual = 0;
            for (int j = 0; j < MAX_PEDIDOS_POR_REPARTIDOR; j++) {
                memset(rep->pedidosAceptados[j], 0, 20);
            }

            rep->estado = DESOCUPADO;
            rep->enRuta = 0;
            rep->fase = 0;
            rep->bloqueado = 0;
            rep->tiempoEspera = 0;
            rep->destino.posx = -1;
            rep->destino.posy = -1;
            strcpy(rep->tipoDestino, "");

            rep->pedidosAceptadosPorRR = 0;
            rep->pedidosRechazadosPorDesvio = 0;
            rep->pedidosEntregados = 0;

            xSemaphoreGive(mutexRepartidores[i]);
        }
    }

    xQueueReset(queuePedidos);
    xQueueReset(queuePedidosListos);

    while (xSemaphoreTake(semCapacidadCola, 0) == pdTRUE) {}
    for (int i = 0; i < MAX_COLA_RESTAURANTE; i++) {
        xSemaphoreGive(semCapacidadCola);
    }

    xEventGroupClearBits(eventGroupPedidos, 0xFFFFFF);
    memset(&metricas, 0, sizeof(MetricasGlobales));
    indiceMotoristaRR = 0;

    printf("{\"type\":\"info\",\"msg\":\"Sistema completamente limpio\"}\r\n");
}

// Regenera el mapa con nuevos restaurantes, casas y repartidores
void regenerarMapa(void) {
    printf("{\"type\":\"info\",\"msg\":\"GENERANDO MAPA...\"}\r\n");

    limpiarSistemaCompleto();

    printf("{\"type\":\"event\",\"ev\":\"SYSTEM_RESET\",\"order\":\"RESET\"}\r\n");
    vTaskDelay(pdMS_TO_TICKS(300));

    // Limpiar grillas
    for (int i = 0; i < MAX_GRID_SIZE; i++) {
        for (int j = 0; j < MAX_GRID_SIZE; j++) {
            sistema.grilla[i][j] = '0';
            sistema.grillaMapa[i][j] = 'o';
        }
    }
    for (int i = 0; i < MAX_GRID_SIZE * 2; i++) {
        for (int j = 0; j < MAX_GRID_SIZE * 2; j++) {
            sistema.mapaUnificado[i][j] = 'o';
        }
    }

    sistema.numRestaurantes = 0;
    sistema.numCasas = 0;
    sistema.numRepartidores = 0;

    // Generar cantidades aleatorias
    int numMotoristas = 3 + (rand() % 4);
    int numCasas = 10 + (rand() % 11);
    int numRestaurantes = 5 + (rand() % 4);

    printf("{\"type\":\"info\",\"msg\":\"Generando: %d motoristas, %d casas, %d restaurantes\"}\r\n",
           numMotoristas, numCasas, numRestaurantes);

    inicializarSistema(8, 8, numRestaurantes, numCasas, numMotoristas);

    printf("{\"type\":\"regenerate\",\"msg\":\"Recargando interfaz web...\"}\r\n");

    vTaskDelay(pdMS_TO_TICKS(1000));

    printf("{\"type\":\"system_reset\",\"msg\":\"Limpiando interfaz web\"}\r\n");
    vTaskDelay(pdMS_TO_TICKS(300));

    enviarMapaCompleto();
    enviarMapaCombinado();

    vTaskDelay(pdMS_TO_TICKS(500));
    sistema.sistemaCorriendo = 1;

    printf("{\"type\":\"info\",\"msg\":\"Mapa generado. Sistema iniciado\"}\r\n");

    // LED de confirmación
    for (int i = 0; i < 3; i++) {
        HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_SET);
        HAL_Delay(100);
        HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_RESET);
        HAL_Delay(100);
    }
    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_SET);
}

// Inicializa el sistema completo
void inicializarSistema(int calles, int avenidas, int rest, int casas, int rep) {
    sistema.calles = calles;
    sistema.avenidas = avenidas;
    sistema.numRestaurantes = 0;
    sistema.numCasas = 0;
    sistema.numRepartidores = rep;
    sistema.sistemaCorriendo = 0;
    sistema.numPedidos = 0;

    for (int i = 0; i < (avenidas - 1); i++) {
        for (int j = 0; j < (calles - 1); j++) {
            sistema.grilla[i][j] = '0';
        }
    }

    for (int i = 0; i < avenidas; i++) {
        for (int j = 0; j < calles; j++) {
            sistema.grillaMapa[i][j] = 'o';
        }
    }

    // Colocar restaurantes
    int restantesRest = rest;
    int numRestaurante = 0;
    while (restantesRest > 0 && sistema.numRestaurantes < MAX_RESTAURANTES) {
        int i = rand() % (avenidas - 1);
        int j = rand() % (calles - 1);

        if (sistema.grilla[i][j] == '0') {
            int dir = rand() % 4;
            char direccion;
            switch (dir) {
                case 0: direccion = 'U'; break;
                case 1: direccion = 'D'; break;
                case 2: direccion = 'L'; break;
                case 3: direccion = 'R'; break;
                default: direccion = 'U';
            }

            sistema.grilla[i][j] = direccion;

            sistema.listaRestaurantes[sistema.numRestaurantes].id = sistema.numRestaurantes;
            sistema.listaRestaurantes[sistema.numRestaurantes].posxy.posx = i;
            sistema.listaRestaurantes[sistema.numRestaurantes].posxy.posy = j;
            sistema.listaRestaurantes[sistema.numRestaurantes].direccion = direccion;

            snprintf(sistema.listaRestaurantes[sistema.numRestaurantes].nombre, 32,
                    "Restaurante no. %d", numRestaurante);

            // Generar menú
            int cantidadPlatillos = 3 + (rand() % 4);
            sistema.listaRestaurantes[sistema.numRestaurantes].numPlatillos = cantidadPlatillos;

            for (int p = 0; p < cantidadPlatillos && p < MAX_MENU; p++) {
                snprintf(sistema.listaRestaurantes[sistema.numRestaurantes].menu[p].nombre, 32,
                        "Platillo %d", p + 1);
                sistema.listaRestaurantes[sistema.numRestaurantes].menu[p].tiempoPreparacion =
                    20.0f + ((float)(rand() % 1000)) / 100.0f;
            }

            sistema.listaRestaurantes[sistema.numRestaurantes].cantidadDeCambio = 5 + (rand() % 5);
            sistema.listaRestaurantes[sistema.numRestaurantes].algoritmo = FCFS;
            sistema.listaRestaurantes[sistema.numRestaurantes].colaPedidosCount = 0;

            sistema.numRestaurantes++;
            numRestaurante++;
            restantesRest--;
        }
    }

    // Colocar casas
    int restantesCasas = casas;
    int numCasa = 0;
    while (restantesCasas > 0 && sistema.numCasas < MAX_CASAS) {
        int i = rand() % (avenidas - 1);
        int j = rand() % (calles - 1);

        if (sistema.grilla[i][j] == '0') {
            int dir = rand() % 4;
            char direccion;
            switch (dir) {
                case 0: direccion = 'u'; break;
                case 1: direccion = 'd'; break;
                case 2: direccion = 'l'; break;
                case 3: direccion = 'r'; break;
                default: direccion = 'u';
            }

            sistema.grilla[i][j] = direccion;

            sistema.listaCasas[sistema.numCasas].id = sistema.numCasas;
            sistema.listaCasas[sistema.numCasas].posxy.posx = i;
            sistema.listaCasas[sistema.numCasas].posxy.posy = j;
            sistema.listaCasas[sistema.numCasas].direccion = direccion;

            snprintf(sistema.listaCasas[sistema.numCasas].nombre, 32,
                    "Casa no. %d", numCasa);

            sistema.numCasas++;
            numCasa++;
            restantesCasas--;
        }
    }

    // Colocar motoristas
    for (int n = 0; n < rep && n < MAX_REPARTIDORES; n++) {
        snprintf(sistema.listaRepartidores[n].nombre, 32, "repartidor %d", n + 1);

        sistema.listaRepartidores[n].velocidad = 1.0f + ((float)(rand() % 400)) / 100.0f;
        sistema.listaRepartidores[n].activo = 1;
        sistema.listaRepartidores[n].enRuta = 0;
        sistema.listaRepartidores[n].estado = DESOCUPADO;
        sistema.listaRepartidores[n].fase = 0;

        sistema.listaRepartidores[n].numPedidosAceptados = 0;
        sistema.listaRepartidores[n].capacidadMaxima = MAX_PEDIDOS_POR_REPARTIDOR;
        sistema.listaRepartidores[n].indicePedidoActual = 0;
        sistema.listaRepartidores[n].desvioMaximoPermitido = 5;
        sistema.listaRepartidores[n].factorDesvio = 1.5f;
        sistema.listaRepartidores[n].pedidosAceptadosPorRR = 0;
        sistema.listaRepartidores[n].pedidosRechazadosPorDesvio = 0;
        sistema.listaRepartidores[n].pedidosEntregados = 0;
        sistema.listaRepartidores[n].bloqueado = 0;
        sistema.listaRepartidores[n].tiempoEspera = 0;
        strcpy(sistema.listaRepartidores[n].tipoDestino, "");

        // Buscar posición válida
        int i, j;
        int intentos = 0;
        do {
            i = rand() % avenidas;
            j = rand() % calles;
            intentos++;

            if (intentos > 100) {
                printf("{\"type\":\"warning\",\"msg\":\"No se encontró espacio para motorista %d\"}\r\n", n);
                break;
            }
        } while (sistema.grillaMapa[i][j] != 'o');

        if (intentos <= 100) {
            sistema.listaRepartidores[n].posxy.posx = i;
            sistema.listaRepartidores[n].posxy.posy = j;
            sistema.grillaMapa[i][j] = 'p';

            printf("{\"type\":\"info\",\"msg\":\"Motorista %d colocado en (%d,%d)\"}\r\n",
                   n + 1, i, j);
        }
    }

    crearMapaUnificado();
    actualizarPosicionesAlMapaUnificado();

    sistemaInicializado = 1;

    printf("{\"type\":\"info\",\"msg\":\"Sistema inicializado: %d rest, %d casas, %d motoristas\"}\r\n",
           sistema.numRestaurantes, sistema.numCasas, sistema.numRepartidores);
}

// Envía el mapa completo por UART
void enviarMapaCompleto(void) {
    printf("{\"type\":\"map\",\"calles\":%d,\"avenidas\":%d}\r\n",
           sistema.calles, sistema.avenidas);

    // Restaurantes
    for (int n = 0; n < sistema.numRestaurantes; n++) {
        int i = sistema.listaRestaurantes[n].posxy.posx;
        int j = sistema.listaRestaurantes[n].posxy.posy;

        int av = j + 1;
        int ca = (sistema.avenidas - 1) - i;

        printf("{\"type\":\"restaurante\",\"id\":%d,\"av\":%d,\"ca\":%d,\"dir\":\"%c\"}\r\n",
               n + 1, av, ca, sistema.listaRestaurantes[n].direccion);
    }

    // Menús
    for (int r = 0; r < sistema.numRestaurantes; r++) {
        for (int p = 0; p < sistema.listaRestaurantes[r].numPlatillos; p++) {
            char tiempoStr[16];
            floatToStr(sistema.listaRestaurantes[r].menu[p].tiempoPreparacion, tiempoStr, 16);

            printf("{\"type\":\"menu\",\"restaurantId\":%d,\"dishId\":%d,\"nombre\":\"%s\",\"tiempo\":\"%s\"}\r\n",
                   r + 1, p, sistema.listaRestaurantes[r].menu[p].nombre, tiempoStr);
        }
    }

    // Casas
    for (int n = 0; n < sistema.numCasas; n++) {
        int i = sistema.listaCasas[n].posxy.posx;
        int j = sistema.listaCasas[n].posxy.posy;

        int av = j + 1;
        int ca = (sistema.avenidas - 1) - i;

        printf("{\"type\":\"casa\",\"id\":%d,\"av\":%d,\"ca\":%d,\"dir\":\"%c\"}\r\n",
               n + 1, av, ca, sistema.listaCasas[n].direccion);
    }

    // Repartidores
    for (int i = 0; i < sistema.numRepartidores; i++) {
        int velInt = (int)(sistema.listaRepartidores[i].velocidad * 100);

        int av, ca;
        convertirUnificadoAAvCa(sistema.listaRepartidores[i].posxyUnificado, &av, &ca);

        printf("{\"type\":\"repartidor\",\"id\":%d,\"nombre\":\"%s\",\"av\":%d,\"ca\":%d,\"vel\":%d}\r\n",
               i, sistema.listaRepartidores[i].nombre, av, ca, velInt);
    }

    printf("{\"type\":\"info\",\"msg\":\"Mapa: %d rest, %d casas, %d reps\"}\r\n",
           sistema.numRestaurantes, sistema.numCasas, sistema.numRepartidores);
}

// Envía el mapa unificado línea por línea
void enviarMapaCombinado(void) {
    printf("{\"type\":\"mapa_combinado\",\"msg\":\"Mapa unificado %dx%d\"}\r\n",
           sistema.tamanioUnificado, sistema.tamanioUnificado);

    char linea[256];
    int pos;

    for (int i = 0; i < sistema.tamanioUnificado; i++) {
        pos = 0;
        for (int j = 0; j < sistema.tamanioUnificado; j++) {
            linea[pos++] = sistema.mapaUnificado[i][j];
            linea[pos++] = ' ';
        }
        linea[pos] = '\0';
        printf("MAPA: %s\r\n", linea);
    }
}

// Envía evento de pedido por UART
void enviarEventoPedido(const char *evento, const char *numeroRecibo, const char *driver, const char *prepTime, int restaurantId, int destinationId) {
    char buffer[256];
    int len = 0;

    if (driver && prepTime && restaurantId > 0 && destinationId > 0) {
        len = snprintf(buffer, sizeof(buffer),
            "{\"type\":\"event\",\"ev\":\"%s\",\"order\":\"%s\",\"driver\":\"%s\",\"prepTime\":\"%s\",\"restaurantId\":%d,\"destinationId\":%d}\r\n",
            evento, numeroRecibo, driver, prepTime, restaurantId, destinationId);
    } else if (driver) {
        len = snprintf(buffer, sizeof(buffer),
            "{\"type\":\"event\",\"ev\":\"%s\",\"order\":\"%s\",\"driver\":\"%s\"}\r\n",
            evento, numeroRecibo, driver);
    } else if (prepTime && restaurantId > 0 && destinationId > 0) {
        len = snprintf(buffer, sizeof(buffer),
            "{\"type\":\"event\",\"ev\":\"%s\",\"order\":\"%s\",\"prepTime\":\"%s\",\"restaurantId\":%d,\"destinationId\":%d}\r\n",
            evento, numeroRecibo, prepTime, restaurantId, destinationId);
    } else {
        len = snprintf(buffer, sizeof(buffer),
            "{\"type\":\"event\",\"ev\":\"%s\",\"order\":\"%s\"}\r\n",
            evento, numeroRecibo);
    }

    if (len > 0) {
        HAL_UART_Transmit(&huart2, (uint8_t*)buffer, len, 200);
    }
}

// Calcula y envía métricas de un pedido
void enviarMetricasPedido(Pedido *p) {
    if (p == NULL || p->metricsSent) return;

    p->metricsSent = 1;

    float t_queue_kitchen = 0.0f;
    float t_prep = 0.0f;
    float t_wait_driver = 0.0f;
    float t_drive = 0.0f;
    float t_total = 0.0f;

    if (p->t_inicioPrep > 0 && p->t_creado > 0 && p->t_inicioPrep > p->t_creado)
        t_queue_kitchen = (float)(p->t_inicioPrep - p->t_creado) / 1000.0f;

    if (p->t_finPrep > 0 && p->t_inicioPrep > 0 && p->t_finPrep > p->t_inicioPrep)
        t_prep = (float)(p->t_finPrep - p->t_inicioPrep) / 1000.0f;

    if (p->t_recogido > 0 && p->t_finPrep > 0 && p->t_recogido > p->t_finPrep)
        t_wait_driver = (float)(p->t_recogido - p->t_finPrep) / 1000.0f;

    if (p->t_entregado > 0 && p->t_recogido > 0 && p->t_entregado > p->t_recogido)
        t_drive = (float)(p->t_entregado - p->t_recogido) / 1000.0f;

    if (p->t_entregado > 0 && p->t_creado > 0 && p->t_entregado > p->t_creado)
        t_total = (float)(p->t_entregado - p->t_creado) / 1000.0f;

    // Filtrar valores imposibles
    if (t_queue_kitchen < 0.0f || t_queue_kitchen > 4000.0f) t_queue_kitchen = 0.0f;
    if (t_prep < 0.0f || t_prep > 4000.0f) t_prep = 0.0f;
    if (t_wait_driver < 0.0f || t_wait_driver > 4000.0f) t_wait_driver = 0.0f;
    if (t_drive < 0.0f || t_drive > 4000.0f) t_drive = 0.0f;
    if (t_total < 0.0f || t_total > 4000.0f) t_total = 0.0f;

    char qStr[16], pStr[16], wStr[16], dStr[16], totStr[16];
    floatToStr(t_queue_kitchen, qStr, sizeof(qStr));
    floatToStr(t_prep,         pStr, sizeof(pStr));
    floatToStr(t_wait_driver,  wStr, sizeof(wStr));
    floatToStr(t_drive,        dStr, sizeof(dStr));
    floatToStr(t_total,        totStr, sizeof(totStr));

    char buffer[256];
    int len = snprintf(buffer, sizeof(buffer),
        "{\"type\":\"metrics\",\"order\":\"%s\","
        "\"t_queue_kitchen\":\"%s\","
        "\"t_prep\":\"%s\","
        "\"t_wait_driver\":\"%s\","
        "\"t_drive\":\"%s\","
        "\"t_total\":\"%s\"}\r\n",
        p->numeroRecibo, qStr, pStr, wStr, dStr, totStr);

    if (len > 0 && len < (int)sizeof(buffer)) {
        HAL_UART_Transmit(&huart2, (uint8_t*)buffer, len, 200);
    }
}

// Envía estadísticas de repartidores
void enviarEstadisticas(void) {
    char buffer[512];
    int len;

    printf("\n========== ESTADISTICAS ROUND-ROBIN ==========\r\n");

    for (int i = 0; i < sistema.numRepartidores; i++) {
        if (xSemaphoreTake(mutexRepartidores[i], pdMS_TO_TICKS(100)) == pdTRUE) {
            Repartidor* rep = &sistema.listaRepartidores[i];

            int total = rep->pedidosAceptadosPorRR + rep->pedidosRechazadosPorDesvio;
            int tasaAceptacion = 0;
            if (total > 0) {
                tasaAceptacion = (rep->pedidosAceptadosPorRR * 100) / total;
            }

            len = snprintf(buffer, sizeof(buffer),
                "{\"type\":\"stats\",\"driver\":\"%s\",\"accepted\":%d,\"rejected\":%d,\"delivered\":%d,\"rate\":%d}\r\n",
                rep->nombre,
                rep->pedidosAceptadosPorRR,
                rep->pedidosRechazadosPorDesvio,
                rep->pedidosEntregados,
                tasaAceptacion);

            HAL_UART_Transmit(&huart2, (uint8_t*)buffer, len, 200);

            xSemaphoreGive(mutexRepartidores[i]);
        }
    }

    printf("==============================================\r\n");
}

// Quicksort para ordenar arrays
void quickSort(float arr[], int low, int high) {
    if (low < high) {
        float pivot = arr[high];
        int i = low - 1;

        for (int j = low; j < high; j++) {
            if (arr[j] < pivot) {
                i++;
                float temp = arr[i];
                arr[i] = arr[j];
                arr[j] = temp;
            }
        }

        float temp = arr[i + 1];
        arr[i + 1] = arr[high];
        arr[high] = temp;

        int pi = i + 1;
        quickSort(arr, low, pi - 1);
        quickSort(arr, pi + 1, high);
    }
}

// Calcula percentil de array ordenado
float calcularPercentil(float datos[], int n, int percentil) {
    if (n == 0) return 0.0f;

    static float temp[MAX_PEDIDOS];
    for (int i = 0; i < n; i++) {
        temp[i] = datos[i];
    }

    quickSort(temp, 0, n - 1);

    int index = (percentil * n) / 100;
    if (index >= n) index = n - 1;

    return temp[index];
}

// Calcula métricas globales del sistema
void calcularMetricasGlobales(void) {
    float tiemposTotal[MAX_PEDIDOS];
    float tiemposPrep[MAX_PEDIDOS];

    int countTotal = 0;
    int countPrep = 0;

    float sumaTotal = 0.0f;
    float sumaPrep = 0.0f;

    for (int i = 0; i < sistema.numPedidos; i++) {
        Pedido *p = &sistema.listaPedidos[i];

        if (p->entregado && p->t_entregado > 0 && p->t_creado > 0) {
            if (p->t_entregado > p->t_creado) {
                float t_total = (float)(p->t_entregado - p->t_creado) / 1000.0f;

                if (t_total > 0.0f && t_total < 4000.0f) {
                    tiemposTotal[countTotal] = t_total;
                    sumaTotal += t_total;
                    countTotal++;
                }
            }

            if (p->t_finPrep > 0 && p->t_inicioPrep > 0 && p->t_finPrep > p->t_inicioPrep) {
                float t_prep = (float)(p->t_finPrep - p->t_inicioPrep) / 1000.0f;

                if (t_prep > 0.0f && t_prep < 4000.0f) {
                    tiemposPrep[countPrep] = t_prep;
                    sumaPrep += t_prep;
                    countPrep++;
                }
            }
        }
    }

    metricas.promedioTotal = countTotal > 0 ? sumaTotal / countTotal : 0.0f;
    metricas.promedioPreparacion = countPrep > 0 ? sumaPrep / countPrep : 0.0f;
    metricas.promedioEspera = 0.0f;
    metricas.promedioEntrega = 0.0f;

    metricas.percentil50Total = calcularPercentil(tiemposTotal, countTotal, 50);
    metricas.percentil95Total = calcularPercentil(tiemposTotal, countTotal, 95);

    metricas.percentil50Prep = calcularPercentil(tiemposPrep, countPrep, 50);
    metricas.percentil95Prep = calcularPercentil(tiemposPrep, countPrep, 95);

    metricas.pedidosAnalizados = countTotal;

    printf("[Metricas] Calculadas: %d pedidos analizados\r\n", countTotal);
}

// Calcula información de ruta entre dos puntos
void crearRuta(int repId, Posicion origen, Posicion destino) {
    if (repId >= sistema.numRepartidores) return;

    int distX = abs(origen.posx - destino.posx);
    int distY = abs(origen.posy - destino.posy);
    int distTotal = distX + distY;

    printf("{\"type\":\"ruta\",\"rep\":%d,\"distX\":%d,\"distY\":%d,\"total\":%d}\r\n",
           repId, distX, distY, distTotal);
}

// Gestiona movimiento y estados de un repartidor
void moverRepartidor(int idRep) {
    if (idRep >= sistema.numRepartidores) return;

    if (xSemaphoreTake(mutexRepartidores[idRep], pdMS_TO_TICKS(10)) != pdTRUE) {
        return;
    }

    Repartidor *rep = &sistema.listaRepartidores[idRep];

    // Verificar si está esperando
    if (rep->bloqueado) {
        if (HAL_GetTick() >= rep->tiempoEspera) {
            rep->bloqueado = 0;

            if (rep->numPedidosAceptados > 0) {
                char* reciboActual = rep->pedidosAceptados[rep->indicePedidoActual];
                Pedido *pedido = buscarPedido(reciboActual);

                if (pedido != NULL) {
                    int av, ca;
                    convertirUnificadoAAvCa(rep->posxyUnificado, &av, &ca);

                    // Finalizar recogida
                    if (rep->fase == 0) {
                        pedido->enPreparacion = 0;
                        pedido->listo = 0;
                        pedido->enReparto = 1;
                        pedido->estado = RECOGIDO;
                        pedido->t_recogido = HAL_GetTick();

                        enviarEventoPedido("DRIVER_PICKED_UP", pedido->numeroRecibo, rep->nombre, NULL, 0, 0);

                        rep->estado = EN_CAMINO_A_DESTINO;
                        rep->destino = getPuntoAccesoCasa(pedido->idCasa);
                        strcpy(rep->tipoDestino, "CASA");
                        rep->fase = 1;

                        printf("{\"type\":\"info\",\"msg\":\"[%s] Pedido recogido. Yendo a entregar\"}\r\n", rep->nombre);
                    }
                    // Finalizar entrega
                    else if (rep->fase == 1) {
                        pedido->enReparto = 0;
                        pedido->entregado = 1;
                        pedido->estado = ENTREGADO;
                        pedido->t_entregado = HAL_GetTick();

                        enviarMetricasPedido(pedido);

                        enviarEventoPedido("DELIVERED", pedido->numeroRecibo, rep->nombre, NULL, 0, 0);
                        rep->pedidosEntregados++;
                        printf("{\"type\":\"info\",\"msg\":\"[%s] Pedido %s ENTREGADO (%d entregados total)\"}\r\n",
                               rep->nombre, pedido->numeroRecibo, rep->pedidosEntregados);

                        // Remover pedido
                        for (int i = rep->indicePedidoActual; i < rep->numPedidosAceptados - 1; i++) {
                            strcpy(rep->pedidosAceptados[i], rep->pedidosAceptados[i + 1]);
                        }
                        rep->numPedidosAceptados--;

                        // Verificar pedidos pendientes
                        if (rep->numPedidosAceptados > 0) {
                            if (rep->indicePedidoActual >= rep->numPedidosAceptados) {
                                rep->indicePedidoActual = 0;
                            }

                            char* siguienteRecibo = rep->pedidosAceptados[rep->indicePedidoActual];
                            Pedido* siguienteP = buscarPedido(siguienteRecibo);

                            if (siguienteP != NULL) {
                                if (siguienteP->estado == RECOGIDO) {
                                    rep->estado = EN_CAMINO_A_DESTINO;
                                    rep->destino = getPuntoAccesoCasa(siguienteP->idCasa);
                                    strcpy(rep->tipoDestino, "CASA");
                                    rep->fase = 1;
                                } else {
                                    rep->estado = EN_CAMINO_A_RESTAURANTE;
                                    rep->destino = getPuntoAccesoRestaurante(siguienteP->idRestaurante);
                                    strcpy(rep->tipoDestino, "RESTAURANTE");
                                    rep->fase = 0;
                                }
                            }
                        } else {
                            // Queda desocupado
                            rep->estado = DESOCUPADO;
                            rep->enRuta = 0;
                            rep->destino.posx = -1;
                            rep->destino.posy = -1;
                            strcpy(rep->tipoDestino, "");
                            rep->fase = 0;
                        }
                    }
                }
            }
        }
        xSemaphoreGive(mutexRepartidores[idRep]);
        return;
    }

    if (!rep->enRuta) {
        xSemaphoreGive(mutexRepartidores[idRep]);
        return;
    }

    // Mover una posición con A*
    sistema.mapaUnificado[rep->posxyUnificado.posx][rep->posxyUnificado.posy] = 'o';
    Posicion siguientePaso = calcularSiguientePasoAStar(rep->posxyUnificado, rep->destino);
    rep->posxyUnificado = siguientePaso;
    sistema.mapaUnificado[rep->posxyUnificado.posx][rep->posxyUnificado.posy] = 'p';

    // Enviar posición actualizada
    int av, ca;
    convertirUnificadoAAvCa(rep->posxyUnificado, &av, &ca);

    const char* estadoStr;
    switch(rep->estado) {
        case DESOCUPADO: estadoStr = "DESOCUPADO"; break;
        case EN_CAMINO_A_RESTAURANTE: estadoStr = "EN_CAMINO_A_RESTAURANTE"; break;
        case RECOGIENDO: estadoStr = "RECOGIENDO"; break;
        case EN_CAMINO_A_DESTINO: estadoStr = "EN_CAMINO_A_DESTINO"; break;
        case ENTREGANDO: estadoStr = "ENTREGANDO"; break;
        default: estadoStr = "DESCONOCIDO";
    }

    printf("{\"type\":\"mov\",\"rep\":%d,\"av\":%d,\"ca\":%d,\"estado\":\"%s\"}\r\n",
           idRep, av, ca, estadoStr);

    // Verificar llegada al destino
    if (rep->posxyUnificado.posx == rep->destino.posx &&
        rep->posxyUnificado.posy == rep->destino.posy) {

        if (rep->numPedidosAceptados > 0) {
            char* reciboActual = rep->pedidosAceptados[rep->indicePedidoActual];
            Pedido *pedido = buscarPedido(reciboActual);

            if (pedido != NULL) {
                // Llegó al restaurante
                if (rep->fase == 0) {
                    printf("{\"type\":\"info\",\"msg\":\"[%s] Llego al restaurante. Recogiendo...\"}\r\n", rep->nombre);
                    rep->estado = RECOGIENDO;
                    rep->bloqueado = 1;
                    rep->tiempoEspera = HAL_GetTick() + 3000;
                    printf("{\"type\":\"mov\",\"rep\":%d,\"av\":%d,\"ca\":%d,\"estado\":\"RECOGIENDO\"}\r\n",
                           idRep, av, ca);
                }
                // Llegó a la casa
                else if (rep->fase == 1) {
                    printf("{\"type\":\"info\",\"msg\":\"[%s] Llego a la casa. Entregando...\"}\r\n", rep->nombre);
                    rep->estado = ENTREGANDO;
                    rep->bloqueado = 1;
                    rep->tiempoEspera = HAL_GetTick() + 2000;
                    printf("{\"type\":\"mov\",\"rep\":%d,\"av\":%d,\"ca\":%d,\"estado\":\"ENTREGANDO\"}\r\n",
                           idRep, av, ca);
                }
            }
        }
    }

    xSemaphoreGive(mutexRepartidores[idRep]);
}

// Asigna pedido a repartidor con scoring y confirmaciones
void asignarPedidoARepartidor(int pedidoId) {
    if (pedidoId >= sistema.numPedidos) return;

    Pedido *pedido = &sistema.listaPedidos[pedidoId];

    if (pedido->asignado || !pedido->listo) return;

    printf("\n[Asignador Hibrido] ===== Procesando %s =====\r\n", pedido->numeroRecibo);

    typedef struct {
        int idx;
        float score;
        int desvio;
    } Candidato;

    Candidato candidatos[MAX_REPARTIDORES];
    int numCandidatos = 0;

    // Calcular scores
    for (int i = 0; i < sistema.numRepartidores; i++) {
        if (xSemaphoreTake(mutexRepartidores[i], pdMS_TO_TICKS(10)) == pdTRUE) {
            Repartidor* rep = &sistema.listaRepartidores[i];

            if (rep->numPedidosAceptados >= rep->capacidadMaxima) {
                xSemaphoreGive(mutexRepartidores[i]);
                continue;
            }

            int desvio = calcularDesvioRuta(i, pedido);
            float score = calcularScoreCompleto(i, pedido, desvio);

            candidatos[numCandidatos].idx = i;
            candidatos[numCandidatos].score = score;
            candidatos[numCandidatos].desvio = desvio;
            numCandidatos++;

            xSemaphoreGive(mutexRepartidores[i]);
        }
    }

    // Sin candidatos
    if (numCandidatos == 0) {
        pedido->reintentosAsignacion++;

        int espera = 3000;

        if (pedido->reintentosAsignacion > 5) {
            printf("[Asignador Hibrido] Pedido %s supero limite de intentos (%d)\r\n",
                   pedido->numeroRecibo, pedido->reintentosAsignacion);
            printf("Esperando 10s para liberar motoristas y reiniciando contador\r\n");

            pedido->reintentosAsignacion = 0;
            espera = 10000;
        }
        else {
            printf("[Asignador Hibrido] Ningun motorista con capacidad disponible\r\n");
            printf("Reintentando en 3s (intento %d/5)\r\n", pedido->reintentosAsignacion);
        }

        vTaskDelay(pdMS_TO_TICKS(espera));

        if (xSemaphoreTake(mutexSistema, pdMS_TO_TICKS(100)) == pdTRUE) {
            xEventGroupSetBits(eventGroupPedidos, EVENT_PEDIDO_LISTO);
            xSemaphoreGive(mutexSistema);
        }

        return;
    }

    // Ordenar candidatos por score
    for (int i = 0; i < numCandidatos - 1; i++) {
        for (int j = i + 1; j < numCandidatos; j++) {
            if (candidatos[j].score > candidatos[i].score ||
                (candidatos[j].score == candidatos[i].score && candidatos[j].desvio < candidatos[i].desvio)) {
                Candidato temp = candidatos[i];
                candidatos[i] = candidatos[j];
                candidatos[j] = temp;
            }
        }
    }

    // Mostrar candidatos
    printf("[Asignador Hibrido] Lista candidatos (mejor->peor):\r\n");
    for (int i = 0; i < numCandidatos; i++) {
        char scoreStr[16];
        floatToStr(candidatos[i].score, scoreStr, 16);

        if (xSemaphoreTake(mutexRepartidores[candidatos[i].idx], pdMS_TO_TICKS(5)) == pdTRUE) {
            printf("   %s | score=%s | desvio=%d | pedidos=%d\r\n",
                   sistema.listaRepartidores[candidatos[i].idx].nombre,
                   scoreStr,
                   candidatos[i].desvio,
                   sistema.listaRepartidores[candidatos[i].idx].numPedidosAceptados);
            xSemaphoreGive(mutexRepartidores[candidatos[i].idx]);
        }
    }

    // Preguntar confirmación
    int seleccionado = -1;
    float scoreSeleccion = 0.0f;
    int desvioSeleccion = 0;

    for (int i = 0; i < numCandidatos; i++) {
        int idx = candidatos[i].idx;

        if (xSemaphoreTake(mutexRepartidores[idx], pdMS_TO_TICKS(10)) == pdTRUE) {
            Repartidor* rep = &sistema.listaRepartidores[idx];

            if (rep->numPedidosAceptados >= rep->capacidadMaxima) {
                xSemaphoreGive(mutexRepartidores[idx]);
                continue;
            }

            int confirma = verificarConfirmacion(candidatos[i].score, candidatos[i].desvio, idx);

            printf("[Asignador Hibrido] Preguntando a %s -> %s\r\n",
                   rep->nombre,
                   confirma ? "CONFIRMA" : "RECHAZA");

            if (confirma) {
                strcpy(rep->pedidosAceptados[rep->numPedidosAceptados], pedido->numeroRecibo);
                rep->numPedidosAceptados++;
                rep->pedidosAceptadosPorRR++;

                if (rep->estado == DESOCUPADO) {
                    rep->estado = EN_CAMINO_A_RESTAURANTE;
                    rep->indicePedidoActual = 0;
                    rep->destino = getPuntoAccesoRestaurante(pedido->idRestaurante);
                    strcpy(rep->tipoDestino, "RESTAURANTE");
                    rep->enRuta = 1;
                    rep->fase = 0;
                }

                pedido->asignado = 1;
                pedido->repartidorId = idx;
                pedido->estado = ACEPTADO;
                pedido->reintentosAsignacion = 0;
                pedido->t_asignado = HAL_GetTick();

                seleccionado = idx;
                scoreSeleccion = candidatos[i].score;
                desvioSeleccion = candidatos[i].desvio;

                enviarEventoPedido("DRIVER_ASSIGNED", pedido->numeroRecibo, rep->nombre, NULL, 0, 0);

                xSemaphoreGive(mutexRepartidores[idx]);
                break;
            }
            else {
                rep->pedidosRechazadosPorDesvio++;
            }

            xSemaphoreGive(mutexRepartidores[idx]);
        }
    }

    // Fallback: asignación forzada
    if (seleccionado == -1) {
        int mejorIdx = -1;
        float mejorScore = -999999.0f;
        int mejorDesvio = 999999;

        for (int i = 0; i < numCandidatos; i++) {
            int idx = candidatos[i].idx;

            if (xSemaphoreTake(mutexRepartidores[idx], pdMS_TO_TICKS(10)) == pdTRUE) {
                Repartidor* rep = &sistema.listaRepartidores[idx];

                if (rep->numPedidosAceptados < rep->capacidadMaxima) {
                    mejorIdx = idx;
                    mejorScore = candidatos[i].score;
                    mejorDesvio = candidatos[i].desvio;
                    xSemaphoreGive(mutexRepartidores[idx]);
                    break;
                }

                xSemaphoreGive(mutexRepartidores[idx]);
            }
        }

        if (mejorIdx != -1) {
            if (xSemaphoreTake(mutexRepartidores[mejorIdx], pdMS_TO_TICKS(10)) == pdTRUE) {
                Repartidor* rep = &sistema.listaRepartidores[mejorIdx];

                strcpy(rep->pedidosAceptados[rep->numPedidosAceptados], pedido->numeroRecibo);
                rep->numPedidosAceptados++;
                rep->pedidosAceptadosPorRR++;

                if (rep->estado == DESOCUPADO) {
                    rep->estado = EN_CAMINO_A_RESTAURANTE;
                    rep->indicePedidoActual = 0;
                    rep->destino = getPuntoAccesoRestaurante(pedido->idRestaurante);
                    strcpy(rep->tipoDestino, "RESTAURANTE");
                    rep->enRuta = 1;
                    rep->fase = 0;
                }

                pedido->asignado = 1;
                pedido->repartidorId = mejorIdx;
                pedido->estado = ACEPTADO;
                pedido->reintentosAsignacion = 0;
                pedido->t_asignado = HAL_GetTick();

                seleccionado = mejorIdx;

                enviarEventoPedido("DRIVER_ASSIGNED", pedido->numeroRecibo, rep->nombre, NULL, 0, 0);

                char scoreStr[16];
                floatToStr(mejorScore, scoreStr, 16);
                printf("[Asignador Hibrido] Ningun motorista confirmo. Asignacion forzada a %s\r\n",
                       rep->nombre);
                printf("(score=%s, desvio=%d)\r\n\n", scoreStr, mejorDesvio);

                xSemaphoreGive(mutexRepartidores[mejorIdx]);
            }
        }
        else {
            pedido->reintentosAsignacion++;

            if (pedido->reintentosAsignacion <= 5) {
                printf("[Asignador Hibrido] Ningun motorista disponible\r\n");
                printf("Reintentando en 3s (intento %d/5)\r\n", pedido->reintentosAsignacion);

                vTaskDelay(pdMS_TO_TICKS(3000));

                if (xSemaphoreTake(mutexSistema, pdMS_TO_TICKS(100)) == pdTRUE) {
                    xEventGroupSetBits(eventGroupPedidos, EVENT_PEDIDO_LISTO);
                    xSemaphoreGive(mutexSistema);
                }
            }
            else {
                printf("[Asignador Hibrido] Pedido %s no pudo asignarse tras varios intentos\r\n",
                       pedido->numeroRecibo);
                printf("Marcado como BUSCANDO_MOTORISTA\r\n");
                pedido->estado = BUSCANDO_MOTORISTA;
            }

            return;
        }
    }

    // Asignación exitosa
    if (seleccionado >= 0) {
        indiceMotoristaRR = (seleccionado + 1) % sistema.numRepartidores;

        char scoreStr[16];
        floatToStr(scoreSeleccion, scoreStr, 16);

        printf("[Asignador Hibrido] ✓ Pedido asignado a %s\r\n",
               sistema.listaRepartidores[seleccionado].nombre);
        printf("(score=%s, desvio=%d)\r\n\n", scoreStr, desvioSeleccion);
    }
}

// Procesa cola de pedidos con FCFS o SJF
void procesarPedidosRestaurante(int idRest) {
    if (idRest >= sistema.numRestaurantes) return;

    Restaurante *rest = &sistema.listaRestaurantes[idRest];

    if (rest->colaPedidosCount == 0) {
        return;
    }

    int pedidoId = -1;

    // Seleccionar según algoritmo
    if (rest->colaPedidosCount <= rest->cantidadDeCambio) {
        // FCFS
        pedidoId = rest->colaPedidos[0];
        for (int i = 0; i < rest->colaPedidosCount - 1; i++) {
            rest->colaPedidos[i] = rest->colaPedidos[i + 1];
        }
        rest->colaPedidosCount--;
    } else {
        // SJF
        int indiceMin = 0;
        float minTiempo = sistema.listaPedidos[rest->colaPedidos[0]].tiempoPreparacion;

        for (int i = 1; i < rest->colaPedidosCount; i++) {
            float tiempo = sistema.listaPedidos[rest->colaPedidos[i]].tiempoPreparacion;
            if (tiempo < minTiempo) {
                minTiempo = tiempo;
                indiceMin = i;
            }
        }

        pedidoId = rest->colaPedidos[indiceMin];
        for (int i = indiceMin; i < rest->colaPedidosCount - 1; i++) {
            rest->colaPedidos[i] = rest->colaPedidos[i + 1];
        }
        rest->colaPedidosCount--;
    }

    // Iniciar preparación
    if (pedidoId >= 0 && pedidoId < sistema.numPedidos) {
        Pedido *p = &sistema.listaPedidos[pedidoId];

        p->estado = PREPARANDO;
        p->enPreparacion = 1;
        p->listo = 0;
        p->idRestaurante = idRest;

        uint32_t tickNow = HAL_GetTick();

        if (p->t_creado == 0) {
            p->t_creado = tickNow;
        }

        p->tiempoInicioPreparacion = tickNow;
        p->t_inicioPrep = tickNow;

        if (p->t_finPrep == 0) p->t_finPrep = 0;
        if (p->t_recogido == 0) p->t_recogido = 0;
        if (p->t_entregado == 0) p->t_entregado = 0;

        char tiempoStr[16];
        floatToStr(p->tiempoPreparacion, tiempoStr, sizeof(tiempoStr));

        printf("{\"type\":\"info\",\"msg\":\"[%s] Preparando %s (%s seg)\"}\r\n",
               rest->nombre, p->numeroRecibo, tiempoStr);

        enviarEventoPedido("ORDER_PREPARING", p->numeroRecibo, NULL, NULL, 0, 0);
    }
}

// Crea pedido aleatorio y lo agrega a cola
void crearPedidoAleatorio(void) {
    if (sistema.numPedidos >= MAX_PEDIDOS) {
        printf("{\"type\":\"warning\",\"msg\":\"Sistema lleno (%d/%d pedidos)\"}\r\n",
               sistema.numPedidos, MAX_PEDIDOS);
        return;
    }

    if (sistema.numRestaurantes == 0 || sistema.numCasas == 0) {
        printf("{\"type\":\"warning\",\"msg\":\"No hay restaurantes o casas\"}\r\n");
        return;
    }

    int idxRest = rand() % sistema.numRestaurantes;
    int idxCasa = rand() % sistema.numCasas;

    Pedido nuevoPedido;
    nuevoPedido.id = sistema.numPedidos;
    nuevoPedido.idRestaurante = idxRest;
    nuevoPedido.posRestaurante = sistema.listaRestaurantes[idxRest].posxyUnificado;
    nuevoPedido.idCasa = idxCasa;
    nuevoPedido.posCasa = sistema.listaCasas[idxCasa].posxyUnificado;

    snprintf(nuevoPedido.numeroRecibo, 20, "PED-%d", contadorPedidos++);

    nuevoPedido.asignado = 0;
    nuevoPedido.enPreparacion = 0;
    nuevoPedido.listo = 0;
    nuevoPedido.enReparto = 0;
    nuevoPedido.entregado = 0;
    nuevoPedido.repartidorId = -1;
    nuevoPedido.estado = CREADO;
    nuevoPedido.t_creado     = HAL_GetTick();
    nuevoPedido.t_inicioPrep = 0;
    nuevoPedido.t_finPrep    = 0;
    nuevoPedido.t_asignado   = 0;
    nuevoPedido.t_recogido   = 0;
    nuevoPedido.t_entregado  = 0;
    nuevoPedido.metricsSent  = 0;

    nuevoPedido.platillosCount = 1 + (rand() % 3);
    float tiempoTotal = 0.0f;
    for (int i = 0; i < nuevoPedido.platillosCount; i++) {
        int idxPlatillo = rand() % sistema.listaRestaurantes[idxRest].numPlatillos;
        nuevoPedido.platillos[i] = idxPlatillo;
        tiempoTotal += sistema.listaRestaurantes[idxRest].menu[idxPlatillo].tiempoPreparacion;
    }
    nuevoPedido.tiempoPreparacion = tiempoTotal;
    nuevoPedido.tiempoInicioPreparacion = 0;
    nuevoPedido.reintentosAsignacion = 0;

    sistema.listaPedidos[sistema.numPedidos] = nuevoPedido;

    char tiempoStr[16];
    floatToStr(tiempoTotal, tiempoStr, 16);
    enviarEventoPedido("ORDER_CREATED", nuevoPedido.numeroRecibo, NULL, tiempoStr, idxRest + 1, idxCasa + 1);

    // Agregar a cola del restaurante
    if (xSemaphoreTake(mutexRestaurantes[idxRest], pdMS_TO_TICKS(100)) == pdTRUE) {
        Restaurante *rest = &sistema.listaRestaurantes[idxRest];

        if (rest->colaPedidosCount < MAX_PEDIDOS) {
            rest->colaPedidos[rest->colaPedidosCount] = sistema.numPedidos;
            rest->colaPedidosCount++;
        }

        xSemaphoreGive(mutexRestaurantes[idxRest]);
    }

    xQueueSend(queuePedidos, &sistema.numPedidos, 0);
    sistema.numPedidos++;

    printf("{\"type\":\"info\",\"msg\":\"Pedido %s creado (en cola del restaurante)\"}\r\n",
           nuevoPedido.numeroRecibo);
}

// Envía solicitud de pedido automático a la web
void solicitarPedidoAutomaticoAWeb(void) {
    if (sistema.numRestaurantes == 0 || sistema.numCasas == 0) {
        return;
    }

    int idxRest = rand() % sistema.numRestaurantes;
    int idxCasa = rand() % sistema.numCasas;

    int cantidadPlatillos = 1 + (rand() % 3);

    char platillosStr[64] = "";
    int offset = 0;

    for (int i = 0; i < cantidadPlatillos; i++) {
        int idxPlatillo = rand() % sistema.listaRestaurantes[idxRest].numPlatillos;

        if (i > 0) {
            offset += snprintf(platillosStr + offset, sizeof(platillosStr) - offset, ",");
        }
        offset += snprintf(platillosStr + offset, sizeof(platillosStr) - offset, "%d", idxPlatillo);
    }

    // Solo enviar - la web procesa todo
    printf("{\"type\":\"auto_order_request\",\"restId\":%d,\"destId\":%d,\"dishes\":\"%s\"}\r\n",
           idxRest + 1, idxCasa + 1, platillosStr);
}

// Inicializa FreeRTOS con tareas, colas y semáforos
void MX_FREERTOS_Init(void)
{
    srand(HAL_GetTick());

    // Colas
    queueRx = xQueueCreate(64, sizeof(uint8_t));
    queuePedidos = xQueueCreate(32, sizeof(int));
    queueButton = xQueueCreate(8, sizeof(uint32_t));
    queuePedidosListos = xQueueCreate(32, sizeof(int));

    semCapacidadCola = xSemaphoreCreateCounting(MAX_COLA_RESTAURANTE, MAX_COLA_RESTAURANTE);

    eventGroupPedidos = xEventGroupCreate();
    mutexSistema = xSemaphoreCreateMutex();

    for (int i = 0; i < MAX_REPARTIDORES; i++) {
        mutexRepartidores[i] = xSemaphoreCreateMutex();
    }

    for (int i = 0; i < MAX_RESTAURANTES; i++) {
        mutexRestaurantes[i] = xSemaphoreCreateMutex();
    }

    // Tarea transmisión
    const osThreadAttr_t taskTx_attributes = {
        .name = "TaskTx",
        .priority = (osPriority_t) osPriorityNormal,
        .stack_size = 512 * 4
    };
    TaskTxHandle = osThreadNew(StartTaskTx, NULL, &taskTx_attributes);

    // Tarea recepción
    const osThreadAttr_t taskRx_attributes = {
        .name = "TaskRx",
        .priority = (osPriority_t) osPriorityBelowNormal,
        .stack_size = 512 * 4
    };
    TaskRxHandle = osThreadNew(StartTaskRx, NULL, &taskRx_attributes);

    // Tarea restaurantes
    const osThreadAttr_t taskRest_attributes = {
        .name = "TaskRest",
        .priority = (osPriority_t) osPriorityAboveNormal,
        .stack_size = 512 * 4
    };
    TaskRestaurantesHandle = osThreadNew(StartTaskRestaurantes, NULL, &taskRest_attributes);

    // Tarea repartidores
    const osThreadAttr_t taskRep_attributes = {
        .name = "TaskRep",
        .priority = (osPriority_t) osPriorityAboveNormal,
        .stack_size = 512 * 4
    };
    TaskRepartidoresHandle = osThreadNew(StartTaskRepartidores, NULL, &taskRep_attributes);

    // Tarea asignación
    const osThreadAttr_t taskAsig_attributes = {
        .name = "TaskAsig",
        .priority = (osPriority_t) osPriorityHigh,
        .stack_size = 512 * 4
    };
    TaskAsignadorHandle = osThreadNew(StartTaskAsignador, NULL, &taskAsig_attributes);

    if (huart2.Instance == NULL) {
        printf("{\"type\":\"error\",\"msg\":\"UART2 NO inicializado!\"}\r\n");
    } else {
        printf("{\"type\":\"info\",\"msg\":\"UART2 OK, iniciando recepcion...\"}\r\n");
    }

    HAL_UART_Receive_IT(&huart2, &rxByte, 1);

    printf("{\"type\":\"info\",\"msg\":\"STM32 FreeRTOS Iniciado\"}\r\n");
    printf("{\"type\":\"info\",\"msg\":\"Presiona el boton para generar el mapa\"}\r\n");
    sistemaInicializado = 0;
    sistema.sistemaCorriendo = 0;

    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_RESET);
}

// Tarea de asignación con event groups
void StartTaskAsignador(void *argument)
{
    printf("[Asignador Hibrido] Tarea iniciada\r\n");

    for(;;)
    {
        if (sistema.sistemaCorriendo && sistemaInicializado) {
            EventBits_t bits = xEventGroupWaitBits(
                eventGroupPedidos,
                EVENT_PEDIDO_LISTO,
                pdTRUE,
                pdFALSE,
                pdMS_TO_TICKS(500));

            if (bits & EVENT_PEDIDO_LISTO) {
                for (int p = 0; p < sistema.numPedidos; p++) {
                    Pedido *pedido = &sistema.listaPedidos[p];

                    if (pedido->listo && !pedido->asignado) {
                        asignarPedidoARepartidor(p);
                        vTaskDelay(pdMS_TO_TICKS(100));
                    }
                }
            }
        }
        else {
            vTaskDelay(pdMS_TO_TICKS(500));
        }
    }
}

// Tarea de restaurantes y preparación
void StartTaskRestaurantes(void *argument)
{
    uint32_t lastCheck = 0;

    for(;;)
    {
        if (sistema.sistemaCorriendo && sistemaInicializado) {

            if ((HAL_GetTick() - lastCheck) > 1000) {
                lastCheck = HAL_GetTick();

                // Revisar pedidos en preparación
                for (int p = 0; p < sistema.numPedidos; p++) {
                    if (sistema.listaPedidos[p].enPreparacion && !sistema.listaPedidos[p].listo) {
                        uint32_t tiempoTranscurridoMs = HAL_GetTick() - sistema.listaPedidos[p].tiempoInicioPreparacion;
                        float tiempoTranscurridoSeg = (float)tiempoTranscurridoMs / 1000.0f;

                        if (tiempoTranscurridoSeg >= sistema.listaPedidos[p].tiempoPreparacion) {
                            sistema.listaPedidos[p].listo = 1;
                            sistema.listaPedidos[p].enPreparacion = 0;
                            sistema.listaPedidos[p].estado = LISTO;
                            sistema.listaPedidos[p].t_finPrep = HAL_GetTick();

                            enviarEventoPedido("ORDER_READY", sistema.listaPedidos[p].numeroRecibo, NULL, NULL, 0, 0);

                            xSemaphoreGive(semCapacidadCola);
                            xEventGroupSetBits(eventGroupPedidos, EVENT_PEDIDO_LISTO);
                        }
                    }
                }

                // Procesar colas de restaurantes
                for (int idRest = 0; idRest < sistema.numRestaurantes; idRest++) {

                    if (xSemaphoreTake(mutexRestaurantes[idRest], pdMS_TO_TICKS(50)) == pdTRUE) {
                        Restaurante *rest = &sistema.listaRestaurantes[idRest];

                        // Notificar cambios
                        static int last_queue[MAX_RESTAURANTES] = {-1,-1,-1,-1,-1,-1,-1,-1,-1,-1};

                        if (last_queue[idRest] != rest->colaPedidosCount) {
                            const char* algoritmo = (rest->colaPedidosCount > rest->cantidadDeCambio) ? "SJF" : "FCFS";
                            const char* estado = (rest->colaPedidosCount > rest->cantidadDeCambio) ? "CARGADO" : "NORMAL";

                            printf("{\"type\":\"restaurant_status\",\"id\":%d,\"algorithm\":\"%s\",\"status\":\"%s\",\"queue\":%d,\"threshold\":%d}\r\n",
                                   idRest + 1, algoritmo, estado, rest->colaPedidosCount, rest->cantidadDeCambio);

                            last_queue[idRest] = rest->colaPedidosCount;
                        }

                        if (rest->colaPedidosCount > 0) {
                            int yaPreparando = 0;

                            for (int p = 0; p < sistema.numPedidos; p++) {
                                if (sistema.listaPedidos[p].idRestaurante == idRest &&
                                    sistema.listaPedidos[p].enPreparacion &&
                                    !sistema.listaPedidos[p].listo) {
                                    yaPreparando = 1;
                                    break;
                                }
                            }

                            if (!yaPreparando) {
                                if (xSemaphoreTake(semCapacidadCola, 0) == pdTRUE) {
                                    procesarPedidosRestaurante(idRest);
                                }
                            }
                        }

                        xSemaphoreGive(mutexRestaurantes[idRest]);
                    }
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

// Notifica estado del restaurante
void notificarEstadoRestaurante(int idRest) {
    Restaurante *rest = &sistema.listaRestaurantes[idRest];

    const char* algoritmo = (rest->colaPedidosCount > rest->cantidadDeCambio) ? "SJF" : "FCFS";
    const char* estado = (rest->colaPedidosCount > rest->cantidadDeCambio) ? "CARGADO" : "NORMAL";

    printf("{\"type\":\"restaurant_status\",\"id\":%d,\"algorithm\":\"%s\",\"status\":\"%s\",\"queue\":%d,\"threshold\":%d}\r\n",
           idRest + 1, algoritmo, estado, rest->colaPedidosCount, rest->cantidadDeCambio);
}

// Maneja overflow de HAL_GetTick
static inline uint32_t diff_ms(uint32_t later, uint32_t earlier) {
    return later - earlier;
}

// Tarea de transmisión y estadísticas
void StartTaskTx(void *argument)
{
    int pedidoId;
    uint32_t buttonMsg;
    uint32_t lastStats = 0;
    uint32_t lastGlobalMetrics = 0;
    uint32_t lastAutoOrderRequest = 0;

    for(;;)
    {
        uint32_t tick = HAL_GetTick();

        // Botón
        if(xQueueReceive(queueButton, &buttonMsg, 0) == pdPASS)
        {
            printf("{\"type\":\"info\",\"msg\":\"Boton B1 presionado\"}\r\n");
            regenerarMapa();
        }

        // Pedidos
        if (sistema.sistemaCorriendo && xQueueReceive(queuePedidos, &pedidoId, 0) == pdPASS)
        {
            vTaskDelay(pdMS_TO_TICKS(10));
        }

        // Solicitar pedido automático cada 20-30 seg
        if (sistema.sistemaCorriendo && sistemaInicializado) {
            uint32_t intervalo = 20000 + (rand() % 10000);

            if ((tick - lastAutoOrderRequest) > intervalo) {
                lastAutoOrderRequest = tick;
                solicitarPedidoAutomaticoAWeb();
            }
        }

        // Estadísticas cada 10 seg
        if ((tick - lastStats) > 10000) {
            lastStats = tick;
            enviarEstadisticas();
        }

        // Métricas globales cada 15 seg
        if ((tick - lastGlobalMetrics) > 15000) {
            lastGlobalMetrics = tick;
            enviarMetricasGlobales();
        }

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

// Calcula y envía métricas globales
void enviarMetricasGlobales(void) {
    char buffer[512];
    int len;

    calcularMetricasGlobales();

    char avgTotalStr[16], avgPrepStr[16], avgEsperaStr[16], avgEntregaStr[16];
    char p50TotalStr[16], p95TotalStr[16], p50PrepStr[16], p95PrepStr[16];

    floatToStr(metricas.promedioTotal, avgTotalStr, 16);
    floatToStr(metricas.promedioPreparacion, avgPrepStr, 16);
    floatToStr(metricas.promedioEspera, avgEsperaStr, 16);
    floatToStr(metricas.promedioEntrega, avgEntregaStr, 16);

    floatToStr(metricas.percentil50Total, p50TotalStr, 16);
    floatToStr(metricas.percentil95Total, p95TotalStr, 16);
    floatToStr(metricas.percentil50Prep, p50PrepStr, 16);
    floatToStr(metricas.percentil95Prep, p95PrepStr, 16);

    len = snprintf(buffer, sizeof(buffer),
        "{\"type\":\"global_metrics\","
        "\"avg_total\":\"%s\","
        "\"avg_prep\":\"%s\","
        "\"avg_wait\":\"%s\","
        "\"avg_delivery\":\"%s\","
        "\"p50_total\":\"%s\","
        "\"p95_total\":\"%s\","
        "\"p50_prep\":\"%s\","
        "\"p95_prep\":\"%s\","
        "\"analyzed\":%d}\r\n",
        avgTotalStr, avgPrepStr, avgEsperaStr, avgEntregaStr,
        p50TotalStr, p95TotalStr, p50PrepStr, p95PrepStr,
        metricas.pedidosAnalizados);

    if (len > 0) {
        HAL_UART_Transmit(&huart2, (uint8_t*)buffer, len, 500);
    }

    printf("========== METRICAS GLOBALES ==========\r\n");
    printf("Promedio Total:      %s seg\r\n", avgTotalStr);
    printf("Promedio Prep:       %s seg\r\n", avgPrepStr);
    printf("Promedio Espera:     %s seg\r\n", avgEsperaStr);
    printf("Promedio Entrega:    %s seg\r\n", avgEntregaStr);
    printf("Percentil 50 Total:  %s seg\r\n", p50TotalStr);
    printf("Percentil 95 Total:  %s seg\r\n", p95TotalStr);
    printf("Percentil 50 Prep:   %s seg\r\n", p50PrepStr);
    printf("Percentil 95 Prep:   %s seg\r\n", p95PrepStr);
    printf("Pedidos Analizados:  %d\r\n", metricas.pedidosAnalizados);
    printf("=======================================\r\n");
}

// Cancela pedido y actualiza estados
void cancelarPedido(const char* numeroRecibo) {
    printf("\n[Cancelador] ===== Cancelando pedido %s =====\r\n", numeroRecibo);

    Pedido* pedido = buscarPedido(numeroRecibo);
    if (pedido == NULL) {
        printf("[Cancelador] Pedido %s NO ENCONTRADO\r\n", numeroRecibo);
        enviarEventoPedido("CANCEL_FAILED", numeroRecibo, NULL, NULL, 0, 0);
        return;
    }

    int idRestaurante = pedido->idRestaurante;
    int idRepartidor = pedido->repartidorId;

    printf("[Cancelador] Pedido encontrado - Estado: %d\r\n", pedido->estado);
    printf("[Cancelador] Asignado a repartidor: %d\r\n", idRepartidor);
    printf("[Cancelador] Estados - Asignado: %d | EnPreparacion: %d | Listo: %d | EnReparto: %d\r\n",
           pedido->asignado, pedido->enPreparacion, pedido->listo, pedido->enReparto);

    // Remover de cola si aún no se preparó
    if (pedido->estado == CREADO) {
        if (xSemaphoreTake(mutexRestaurantes[idRestaurante], pdMS_TO_TICKS(100)) == pdTRUE) {
            Restaurante *rest = &sistema.listaRestaurantes[idRestaurante];

            int encontrado = -1;
            for (int i = 0; i < rest->colaPedidosCount; i++) {
                if (rest->colaPedidos[i] == pedido->id) {
                    encontrado = i;
                    break;
                }
            }

            if (encontrado != -1) {
                for (int i = encontrado; i < rest->colaPedidosCount - 1; i++) {
                    rest->colaPedidos[i] = rest->colaPedidos[i + 1];
                }
                rest->colaPedidosCount--;

                printf("[Cancelador] Pedido removido de cola del restaurante (posición %d)\r\n", encontrado);
                printf("[Cancelador] Nueva cola: %d pedidos\r\n", rest->colaPedidosCount);

                xSemaphoreGive(semCapacidadCola);
            }

            xSemaphoreGive(mutexRestaurantes[idRestaurante]);
        }
    }

    // Remover del repartidor
    if (pedido->asignado && idRepartidor >= 0 && idRepartidor < sistema.numRepartidores) {
        if (xSemaphoreTake(mutexRepartidores[idRepartidor], pdMS_TO_TICKS(100)) == pdTRUE) {
            Repartidor* rep = &sistema.listaRepartidores[idRepartidor];

            // No cancelar si está entregando
            if (rep->estado == ENTREGANDO && rep->bloqueado) {
                printf("[Cancelador] NO SE PUEDE CANCELAR - Repartidor está entregando en la casa\r\n");
                printf("[Cancelador] El pedido será entregado en unos segundos\r\n");

                xSemaphoreGive(mutexRepartidores[idRepartidor]);

                enviarEventoPedido("CANCEL_REJECTED", numeroRecibo, NULL, NULL, 0, 0);
                printf("{\"type\":\"warning\",\"msg\":\"Cancelación rechazada: El pedido está siendo entregado\"}\r\n");
                return;
            }

            int encontrado = -1;
            for (int i = 0; i < rep->numPedidosAceptados; i++) {
                if (strcmp(rep->pedidosAceptados[i], numeroRecibo) == 0) {
                    encontrado = i;
                    break;
                }
            }

            if (encontrado != -1) {
                printf("[Cancelador] Pedido encontrado en repartidor (índice %d de %d)\r\n",
                       encontrado, rep->numPedidosAceptados);

                // Pedido actual
                if (encontrado == rep->indicePedidoActual) {
                    printf("[Cancelador] Era el pedido ACTUAL del repartidor\r\n");
                    printf("[Cancelador] Estado del repartidor: %d | Bloqueado: %d\r\n",
                           rep->estado, rep->bloqueado);

                    if (rep->bloqueado) {
                        printf("[Cancelador] Desbloqueando repartidor (estaba esperando)\r\n");
                        rep->bloqueado = 0;
                        rep->tiempoEspera = 0;
                    }

                    for (int i = encontrado; i < rep->numPedidosAceptados - 1; i++) {
                        strcpy(rep->pedidosAceptados[i], rep->pedidosAceptados[i + 1]);
                    }
                    rep->numPedidosAceptados--;

                    printf("[Cancelador] Pedido removido. Repartidor ahora tiene %d pedidos\r\n",
                           rep->numPedidosAceptados);

                    int av, ca;
                    convertirUnificadoAAvCa(rep->posxyUnificado, &av, &ca);

                    // Hay más pedidos
                    if (rep->numPedidosAceptados > 0) {
                        if (rep->indicePedidoActual >= rep->numPedidosAceptados) {
                            rep->indicePedidoActual = 0;
                        }

                        char* siguienteRecibo = rep->pedidosAceptados[rep->indicePedidoActual];
                        Pedido* siguienteP = buscarPedido(siguienteRecibo);

                        if (siguienteP != NULL) {
                            printf("[Cancelador] Cambiando a siguiente pedido %s\r\n", siguienteRecibo);

                            if (siguienteP->estado == RECOGIDO) {
                                rep->estado = EN_CAMINO_A_DESTINO;
                                rep->destino = getPuntoAccesoCasa(siguienteP->idCasa);
                                strcpy(rep->tipoDestino, "CASA");
                                rep->fase = 1;
                            } else {
                                rep->estado = EN_CAMINO_A_RESTAURANTE;
                                rep->destino = getPuntoAccesoRestaurante(siguienteP->idRestaurante);
                                strcpy(rep->tipoDestino, "RESTAURANTE");
                                rep->fase = 0;
                            }

                            rep->enRuta = 1;

                            printf("{\"type\":\"mov\",\"rep\":%d,\"av\":%d,\"ca\":%d,\"estado\":\"EN_RUTA_SIGUIENTE\"}\r\n",
                                   idRepartidor, av, ca);
                        }
                    } else {
                        // Desocupado
                        printf("[Cancelador] Repartidor ahora DESOCUPADO (sin más pedidos)\r\n");
                        rep->estado = DESOCUPADO;
                        rep->enRuta = 0;
                        rep->destino.posx = -1;
                        rep->destino.posy = -1;
                        strcpy(rep->tipoDestino, "");
                        rep->fase = 0;

                        printf("{\"type\":\"mov\",\"rep\":%d,\"av\":%d,\"ca\":%d,\"estado\":\"DESOCUPADO\"}\r\n",
                                idRepartidor, av, ca);
                    }
                }
                // Pedido en cola
                else {
                    printf("[Cancelador] Era pedido en cola (no actual), removiendo\r\n");

                    for (int i = encontrado; i < rep->numPedidosAceptados - 1; i++) {
                        strcpy(rep->pedidosAceptados[i], rep->pedidosAceptados[i + 1]);
                    }
                    rep->numPedidosAceptados--;

                    if (encontrado < rep->indicePedidoActual) {
                        rep->indicePedidoActual--;
                    }

                    printf("[Cancelador] Pedido removido. Repartidor ahora tiene %d pedidos\r\n",
                           rep->numPedidosAceptados);
                }
            } else {
                printf("[Cancelador] Pedido NO encontrado en repartidor (pero estaba asignado)\r\n");
            }

            xSemaphoreGive(mutexRepartidores[idRepartidor]);
        }
    }

    // Marcar como cancelado
    pedido->estado = CANCELADO;
    pedido->asignado = 0;
    pedido->enPreparacion = 0;
    pedido->listo = 0;
    pedido->enReparto = 0;
    pedido->entregado = 0;
    pedido->repartidorId = -1;

    printf("[Cancelador] Pedido marcado como CANCELADO\r\n");

    enviarEventoPedido("CANCELLED", numeroRecibo, NULL, NULL, 0, 0);

    printf("[Cancelador] ===== Cancelación completada =====\n\r\n");
}

// Procesa cancelación desde web
void procesarCancelacionWeb(const char* numeroRecibo) {
    printf("{\"type\":\"info\",\"msg\":\"[WEB] Solicitando cancelación de %s\"}\r\n", numeroRecibo);

    cancelarPedido(numeroRecibo);

    printf("{\"type\":\"success\",\"msg\":\"Pedido %s cancelado exitosamente\"}\r\n", numeroRecibo);
}

// Tarea de recepción de comandos por UART
void StartTaskRx(void *argument)
{
    char line[256];
    int index = 0;
    uint8_t ch;

    for(;;)
    {
        if (xQueueReceive(queueRx, &ch, pdMS_TO_TICKS(100)) == pdPASS)
        {
            if (ch == '\n' || ch == '\r')
            {
                line[index] = '\0';

                if (strlen(line) > 0)
                {
                    // Comando START
                    if (strstr(line, "START"))
                    {
                        sistema.sistemaCorriendo = 1;
                        printf("{\"type\":\"info\",\"msg\":\"Sistema iniciado\"}\r\n");
                        HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_SET);
                    }
                    // Comando STOP
                    else if (strstr(line, "STOP"))
                    {
                        sistema.sistemaCorriendo = 0;
                        printf("{\"type\":\"info\",\"msg\":\"Sistema detenido\"}\r\n");
                        HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_RESET);
                    }
                    // Comando MAP
                    else if (strstr(line, "MAP"))
                    {
                        if (sistemaInicializado) {
                            enviarMapaCompleto();
                            enviarMapaCombinado();
                        } else {
                            printf("{\"type\":\"warning\",\"msg\":\"Sistema no inicializado. Presiona el boton primero\"}\r\n");
                        }
                    }
                    // Comando REGEN
                    else if (strstr(line, "REGEN"))
                    {
                        uint32_t msg = 1;
                        xQueueSend(queueButton, &msg, 0);
                    }
                    // Comando STATS
                    else if (strstr(line, "STATS"))
                    {
                        enviarEstadisticas();
                    }
                    // Comando METRICS
                    else if (strstr(line, "METRICS"))
                    {
                        enviarMetricasGlobales();
                    }
                    // Comando CANCELAR_PEDIDO
                    else if (strstr(line, "CANCELAR_PEDIDO"))
                    {
                        char numeroRecibo[20];
                        char cleanLine[256];
                        int cleanIdx = 0;

                        // Limpiar espacios
                        for(int i = 0; i < strlen(line); i++) {
                            if(line[i] != ' ' && line[i] != '\r' && line[i] != '\n' && line[i] != '\t') {
                                cleanLine[cleanIdx++] = line[i];
                            }
                        }
                        cleanLine[cleanIdx] = '\0';

                        printf("{\"type\":\"debug\",\"msg\":\"Línea limpia: %s\"}\r\n", cleanLine);

                        // Parsear: CANCELAR_PEDIDO,numeroRecibo
                        char *ptr = cleanLine;
                        ptr = strchr(ptr, ',');

                        if(ptr) {
                            ptr++;
                            int idx = 0;
                            while(*ptr && *ptr != '\0' && idx < sizeof(numeroRecibo) - 1) {
                                numeroRecibo[idx++] = *ptr++;
                            }
                            numeroRecibo[idx] = '\0';

                            printf("{\"type\":\"debug\",\"msg\":\"Recibo parseado: %s\"}\r\n", numeroRecibo);

                            if(strlen(numeroRecibo) > 0) {
                                procesarCancelacionWeb(numeroRecibo);
                            } else {
                                printf("{\"type\":\"error\",\"msg\":\"Numero de recibo vacio\"}\r\n");
                            }
                        } else {
                            printf("{\"type\":\"error\",\"msg\":\"Formato invalido CANCELAR_PEDIDO (sin coma)\"}\r\n");
                        }
                    }
                    // Comando PEDIDO_WEB
                    else if (strstr(line, "PEDIDO_WEB"))
                    {
                        int restId = -1, casaId = -1;
                        int platillos[MAX_PLATILLOS];
                        int platillosCount = 0;

                        char cleanLine[256];
                        int cleanIdx = 0;
                        for(int i = 0; i < strlen(line); i++) {
                            if(line[i] != ' ' && line[i] != '\r' && line[i] != '\n' && line[i] != '\t') {
                                cleanLine[cleanIdx++] = line[i];
                            }
                        }
                        cleanLine[cleanIdx] = '\0';

                        // Parsear: PEDIDO_WEB,restId,casaId,platillo1,platillo2,...
                        char *ptr = cleanLine;
                        ptr = strchr(ptr, ',');
                        if(!ptr) {
                            printf("{\"type\":\"error\",\"msg\":\"Formato invalido\"}\r\n");
                            goto pedido_web_end;
                        }
                        ptr++;

                        restId = atoi(ptr) - 1;
                        ptr = strchr(ptr, ',');
                        if(!ptr) {
                            printf("{\"type\":\"error\",\"msg\":\"Falta casa\"}\r\n");
                            goto pedido_web_end;
                        }
                        ptr++;

                        casaId = atoi(ptr) - 1;
                        ptr = strchr(ptr, ',');
                        if(!ptr) {
                            printf("{\"type\":\"error\",\"msg\":\"Faltan platillos\"}\r\n");
                            goto pedido_web_end;
                        }
                        ptr++;

                        while(*ptr && platillosCount < MAX_PLATILLOS) {
                            platillos[platillosCount++] = atoi(ptr);
                            ptr = strchr(ptr, ',');
                            if(!ptr) break;
                            ptr++;
                        }

                        // Validar datos
                        if (restId < 0 || restId >= sistema.numRestaurantes) {
                            printf("{\"type\":\"error\",\"msg\":\"Restaurante invalido: %d\"}\r\n", restId + 1);
                            goto pedido_web_end;
                        }

                        if (casaId < 0 || casaId >= sistema.numCasas) {
                            printf("{\"type\":\"error\",\"msg\":\"Casa invalida: %d\"}\r\n", casaId + 1);
                            goto pedido_web_end;
                        }

                        if (platillosCount == 0) {
                            printf("{\"type\":\"error\",\"msg\":\"Sin platillos\"}\r\n");
                            goto pedido_web_end;
                        }

                        if (sistema.numPedidos >= MAX_PEDIDOS) {
                            printf("{\"type\":\"error\",\"msg\":\"Sistema lleno (%d/%d pedidos)\"}\r\n",
                                   sistema.numPedidos, MAX_PEDIDOS);
                            goto pedido_web_end;
                        }

                        // Crear pedido
                        Pedido nuevoPedido;

                        memset(&nuevoPedido, 0, sizeof(Pedido));

                        nuevoPedido.id = sistema.numPedidos;
                        nuevoPedido.idRestaurante = restId;
                        nuevoPedido.idCasa = casaId;
                        nuevoPedido.posRestaurante = sistema.listaRestaurantes[restId].posxyUnificado;
                        nuevoPedido.posCasa = sistema.listaCasas[casaId].posxyUnificado;

                        snprintf(nuevoPedido.numeroRecibo, 20, "PED-%d", contadorPedidos++);

                        nuevoPedido.t_creado = HAL_GetTick();
                        nuevoPedido.t_inicioPrep = 0;
                        nuevoPedido.t_finPrep = 0;
                        nuevoPedido.t_asignado = 0;
                        nuevoPedido.t_recogido = 0;
                        nuevoPedido.t_entregado = 0;
                        nuevoPedido.metricsSent = 0;

                        nuevoPedido.asignado = 0;
                        nuevoPedido.enPreparacion = 0;
                        nuevoPedido.listo = 0;
                        nuevoPedido.enReparto = 0;
                        nuevoPedido.entregado = 0;
                        nuevoPedido.repartidorId = -1;
                        nuevoPedido.estado = CREADO;
                        nuevoPedido.platillosCount = platillosCount;

                        float tiempoTotal = 0.0f;
                        for (int i = 0; i < platillosCount; i++) {
                            nuevoPedido.platillos[i] = platillos[i];
                            if (platillos[i] < sistema.listaRestaurantes[restId].numPlatillos) {
                                tiempoTotal += sistema.listaRestaurantes[restId].menu[platillos[i]].tiempoPreparacion;
                            }
                        }
                        nuevoPedido.tiempoPreparacion = tiempoTotal;
                        nuevoPedido.tiempoInicioPreparacion = 0;
                        nuevoPedido.reintentosAsignacion = 0;

                        sistema.listaPedidos[sistema.numPedidos] = nuevoPedido;

                        char tiempoStr[16];
                        floatToStr(tiempoTotal, tiempoStr, 16);

                        enviarEventoPedido("ORDER_CREATED", nuevoPedido.numeroRecibo, NULL, tiempoStr, restId + 1, casaId + 1);

                        // Agregar a cola del restaurante
                        if (xSemaphoreTake(mutexRestaurantes[restId], pdMS_TO_TICKS(100)) == pdTRUE) {
                            Restaurante *rest = &sistema.listaRestaurantes[restId];

                            if (rest->colaPedidosCount < MAX_PEDIDOS) {
                                rest->colaPedidos[rest->colaPedidosCount] = sistema.numPedidos;
                                rest->colaPedidosCount++;
                            }

                            xSemaphoreGive(mutexRestaurantes[restId]);
                        }

                        xQueueSend(queuePedidos, &sistema.numPedidos, 0);
                        sistema.numPedidos++;

                        printf("{\"type\":\"success\",\"msg\":\"Pedido %s creado (en cola del restaurante)\"}\r\n",
                               nuevoPedido.numeroRecibo);

                        pedido_web_end:
                        ;
                    }
                    // Comando PEDIDO
                    else if (strstr(line, "PEDIDO"))
                    {
                        crearPedidoAleatorio();
                    }
                    // Comando INFO
                    else if (strstr(line, "INFO"))
                    {
                        printf("{\"type\":\"info\",\"msg\":\"Pedidos: %d, Rest: %d, Casas: %d, Reps: %d\"}\r\n",
                               sistema.numPedidos, sistema.numRestaurantes,
                               sistema.numCasas, sistema.numRepartidores);
                    }
                    // Comando HELP
                    else if (strstr(line, "HELP"))
                    {
                        printf("{\"type\":\"info\",\"msg\":\"Comandos: START STOP MAP REGEN PEDIDO STATS METRICS INFO CANCELAR_PEDIDO HELP\"}\r\n");
                    }
                }

                index = 0;
            }
            else if (index < sizeof(line) - 1)
            {
                line[index++] = ch;
            }
        }
    }
}

// Tarea de movimiento de repartidores
void StartTaskRepartidores(void *argument)
{
    uint32_t lastMove = 0;

    for(;;)
    {
        if (sistema.sistemaCorriendo && sistemaInicializado) {

            if ((HAL_GetTick() - lastMove) > 500) {
                lastMove = HAL_GetTick();

                for (int i = 0; i < sistema.numRepartidores; i++) {
                    if (xSemaphoreTake(mutexRepartidores[i], pdMS_TO_TICKS(10)) == pdTRUE) {
                        Repartidor *rep = &sistema.listaRepartidores[i];

                        if (rep->enRuta) {
                            xSemaphoreGive(mutexRepartidores[i]);
                            moverRepartidor(i);
                        }
                        else if (rep->numPedidosAceptados == 0 && rep->estado == DESOCUPADO) {
                            // Movimiento aleatorio
                            int x = rep->posxyUnificado.posx;
                            int y = rep->posxyUnificado.posy;

                            Posicion movimientos[4];
                            int numMovimientos = 0;

                            // Verificar 4 direcciones
                            if (x - 1 >= 0 && sistema.mapaUnificado[x - 1][y] == 'o') {
                                movimientos[numMovimientos].posx = x - 1;
                                movimientos[numMovimientos].posy = y;
                                numMovimientos++;
                            }
                            if (x + 1 < sistema.tamanioUnificado && sistema.mapaUnificado[x + 1][y] == 'o') {
                                movimientos[numMovimientos].posx = x + 1;
                                movimientos[numMovimientos].posy = y;
                                numMovimientos++;
                            }
                            if (y - 1 >= 0 && sistema.mapaUnificado[x][y - 1] == 'o') {
                                movimientos[numMovimientos].posx = x;
                                movimientos[numMovimientos].posy = y - 1;
                                numMovimientos++;
                            }
                            if (y + 1 < sistema.tamanioUnificado && sistema.mapaUnificado[x][y + 1] == 'o') {
                                movimientos[numMovimientos].posx = x;
                                movimientos[numMovimientos].posy = y + 1;
                                numMovimientos++;
                            }

                            if (numMovimientos > 0) {
                                int indiceAleatorio = rand() % numMovimientos;

                                sistema.mapaUnificado[rep->posxyUnificado.posx][rep->posxyUnificado.posy] = 'o';

                                rep->posxyUnificado.posx = movimientos[indiceAleatorio].posx;
                                rep->posxyUnificado.posy = movimientos[indiceAleatorio].posy;

                                sistema.mapaUnificado[rep->posxyUnificado.posx][rep->posxyUnificado.posy] = 'p';

                                int av, ca;
                                convertirUnificadoAAvCa(rep->posxyUnificado, &av, &ca);

                                printf("{\"type\":\"mov\",\"rep\":%d,\"av\":%d,\"ca\":%d,\"estado\":\"DESOCUPADO\"}\r\n",
                                       i, av, ca);
                            }

                            xSemaphoreGive(mutexRepartidores[i]);
                        }
                        else {
                            xSemaphoreGive(mutexRepartidores[i]);
                        }
                    }
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

// Callback de UART cuando se recibe un byte
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;

    if (huart->Instance == USART2)
    {
        xQueueSendFromISR(queueRx, &rxByte, &xHigherPriorityTaskWoken);
        HAL_UART_Receive_IT(&huart2, &rxByte, 1);
        portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
    }
}

// Manejador de interrupción del botón
void EXTI15_10_IRQHandler(void)
{
    if(__HAL_GPIO_EXTI_GET_IT(GPIO_PIN_13) != RESET)
    {
        __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_13);

        static uint32_t lastTime = 0;
        uint32_t currentTime = HAL_GetTick();

        // Anti-rebote 500ms
        if(currentTime - lastTime > 500)
        {
            uint32_t msg = 1;
            BaseType_t xHigherPriorityTaskWoken = pdFALSE;
            xQueueSendFromISR(queueButton, &msg, &xHigherPriorityTaskWoken);
            portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
            lastTime = currentTime;
        }
    }
}

// Hook de error malloc
void vApplicationMallocFailedHook(void)
{
    printf("{\"type\":\"error\",\"msg\":\"Malloc Failed\"}\r\n");
    taskDISABLE_INTERRUPTS();
    for(;;);
}

// Hook de error stack overflow
void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcTaskName)
{
    printf("{\"type\":\"error\",\"msg\":\"Stack Overflow: %s\"}\r\n", pcTaskName);
    taskDISABLE_INTERRUPTS();
    for(;;);
}
