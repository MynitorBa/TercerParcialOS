COMO CORRER EL PROYECTO:

El repositorio cuenta con dos carpetas, en la de "APLICACIÓN WEB" se encuentra todos los archivos necesarios para la app web, por otro lado dentro de "FreeRTOS_Blink_Concurrente" se encuentra todo el proyecto de la placa STM32, donde el archivo más importante es el de freertos.c, para correr el archivo de la placa se debe importar el proyecto en STM32CubeIDE (El de "FreeRTOS_Blink_Concurrente"). Para correrlo primeramente se debe ir al proyecto dentro del IDE, darle clic derecho para luego clickear Build Project, luego se debe dar Debug As, con la configuración predeterminada que utilice su placa, y debería dar Switch, tras esto, se tiene que correr el porgrama normalmente.

Por otro lado, para ejecutar la aplicación web, se deben instalar las librerías necesarias desde la terminal de Node.js utilizando los siguientes comandos:

npm install express serialport cors ws
npm install express serialport cors


Una vez instaladas, se debe ejecutar el servidor con el comando:

nodemon serial.js


Posteriormente, desde el IDE Visual Studio Code, se puede utilizar la opción “Show Preview” para visualizar la página, o bien abrirla directamente en el navegador para una experiencia más completa. Desde ahí, se establece la comunicación con la placa STM32 mediante la Web Serial API, permitiendo observar en tiempo real la creación, preparación, asignación y entrega de pedidos dentro del sistema.
