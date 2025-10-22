// SERVIDOR BRIDGE STM32 - WEBSOCKET
// Conecta el STM32 con clientes web via WebSocket

const express = require("express");
const { SerialPort } = require("serialport");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos
app.use(express.static(__dirname));

const portName = "COM5";
const baudRate = 115200;

let serial = null;
let wss = null;
let isConnected = false;
let buffer = "";

// Abre el puerto serial y configura eventos
function initSerial() {
    serial = new SerialPort({ path: portName, baudRate: baudRate });

    serial.on("open", () => {
        console.log(`Puerto ${portName} conectado`);
        isConnected = true;
        broadcastToClients({ type: "serial_connected", status: true });
    });

    serial.on("error", (err) => {
        console.log("Error serial:", err.message);
        isConnected = false;
    });

    serial.on("close", () => {
        console.log("Puerto cerrado");
        isConnected = false;
    });

    // Lee datos del STM32 línea por línea
    serial.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        
        lines.forEach(line => {
            const text = line.trim();
            if (text.length > 0) {
                console.log("RX STM32:", text);
                
                // Filtra métricas del sistema
                try {
                    const json = JSON.parse(text);
                    if (json.type === 'metric') return;
                } catch (e) {}
                
                // Envía datos a clientes web
                broadcastToClients({ type: "stm32_data", data: text });
            }
        });
    });
}

// Crea servidor WebSocket en puerto 8081
function initWebSocket() {
    wss = new WebSocketServer({ port: 8081 });

    wss.on("connection", (ws) => {
        console.log("Cliente web conectado");
        ws.send(JSON.stringify({ type: "serial_connected", status: isConnected }));

        // Recibe comandos del cliente
        ws.on("message", (msg) => {
            try {
                const data = JSON.parse(msg);
                if (data.type === "send_to_stm32") {
                    sendToSTM32(data.payload);
                }
            } catch (e) {
                console.log("Error:", e.message);
            }
        });

        ws.on("close", () => console.log("Cliente desconectado"));
    });
}

// Escribe datos al STM32
function sendToSTM32(data) {
    if (!serial || !isConnected) {
        console.log("Serial no conectado");
        return;
    }

    const dataToSend = data.endsWith('\r\n') ? data : data + "\r\n";

    serial.write(dataToSend, (err) => {
        if (err) {
            console.log("Error TX:", err.message);
        } else {
            console.log("TX:", dataToSend.trim());
        }
    });
}

// Envía mensaje a todos los clientes conectados
function broadcastToClients(message) {
    if (!wss) return;
    const messageStr = JSON.stringify(message);
    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(messageStr);
        }
    });
}

// HTTP: enviar datos al STM32
app.post("/api/send", (req, res) => {
    const { data } = req.body;
    if (!data) return res.status(400).json({ error: "Falta 'data'" });
    sendToSTM32(data);
    res.json({ ok: true, sent: data });
});

// HTTP: estado del servidor
app.get("/api/status", (req, res) => {
    res.json({ 
        connected: isConnected, 
        port: portName,
        clients: wss ? wss.clients.size : 0
    });
});

// Inicia servidor
initSerial();
initWebSocket();

const HTTP_PORT = 3000;
app.listen(HTTP_PORT);

// Cierra conexiones al salir
process.on("SIGINT", () => {
    console.log("\nCerrando...");
    if (serial && isConnected) serial.close();
    if (wss) wss.close();
    process.exit(0);
});