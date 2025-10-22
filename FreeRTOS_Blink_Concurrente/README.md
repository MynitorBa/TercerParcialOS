COMO CORRER EL PROYECTO:

Para ejecutar el proyecto, la parte correspondiente al STM32 utiliza FreeRTOS, por lo que es necesario colocar el código dentro del archivo freertos.c y realizar el Build del proyecto antes de ejecutarlo en la placa. Esto pondrá en funcionamiento las tareas encargadas de la gestión de pedidos, comunicación UART y sincronización del sistema.

Por otro lado, para ejecutar la aplicación web, se deben instalar las librerías necesarias desde la terminal de Node.js utilizando los siguientes comandos:

npm install express serialport cors ws
npm install express serialport cors


Una vez instaladas, se debe ejecutar el servidor con el comando:

nodemon serial.js


Posteriormente, desde el IDE Visual Studio Code, se puede utilizar la opción “Show Preview” para visualizar la página, o bien abrirla directamente en el navegador para una experiencia más completa. Desde ahí, se establece la comunicación con la placa STM32 mediante la Web Serial API, permitiendo observar en tiempo real la creación, preparación, asignación y entrega de pedidos dentro del sistema.
