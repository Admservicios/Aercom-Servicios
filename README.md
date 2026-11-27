# Aercom Servicios

Aplicación interna para seguir los casos del área de Servicios desde el pedido hasta el cierre. La ficha muestra qué pasó, qué queda pendiente, quién tiene la próxima acción y desde cuándo.

## Alcance y criterios de aceptación

- Casos, Nuevo caso y Detalle del caso, con listado compacto, búsqueda visible y acciones desde la ficha.
- Alta y selección de clientes Abonados o Terceros. Cliente y asunto bastan para abrir un caso. Equipo y responsable son opcionales.
- Múltiples acciones independientes con responsable, estado y fecha opcional. El recorrido admite análisis, cotización, aprobación, pedido, visita, resultado, referencia de factura y cierre.
- Selección de nombre al entrar, opción para cambiarlo y cambios con nombre y fecha. SQLite en el servidor conserva los datos y el historial al reiniciar.
- Listado y ficha se actualizan en segundos. Los formularios conservan la edición y el servidor detecta cambios concurrentes antes de sobrescribir.
- Dos sesiones con nombres distintos verifican el recorrido. Una crea y asigna el caso, la otra registra un resultado y la primera ve el cambio con autor.
- La base de uso comienza vacía de clientes y casos. Las pruebas usan una base temporal independiente.
- Sistemas puede ponerla en marcha, respaldarla y habilitar su acceso interno desde Chrome.

Agenda, avisos, contratos y listados comerciales quedan para la siguiente etapa.

## Desarrollo local

Requiere Node.js 24 LTS con npm. Usa SQLite integrado en Node y no requiere instalar paquetes. Ejecutá los comandos desde la raíz del repositorio.

```bash
npm test
npm start
```

Abrí `http://127.0.0.1:3100` desde Chrome en el mismo equipo. La pantalla inicial muestra los nombres del equipo. Sistemas agrega cada nombre con el siguiente comando, usando el mismo `AERCOM_DB` que usa el servicio.

```bash
umask 077
npm run person -- "Nombre Apellido"
```

La base predeterminada es `data/aercom.sqlite`. Se crea sin nombres, clientes ni casos precargados. `npm test` trabaja exclusivamente con bases temporales separadas. Al abrir una base de la versión anterior, el servicio conserva los nombres, las asignaciones y el historial. Las sesiones anteriores se reemplazan al elegir un nombre.

## Uso

1. Tocá tu nombre para entrar. Arriba vas a ver el nombre activo y **Cambiar nombre**. El nombre seleccionado queda guardado con cada cambio. Cualquiera con acceso al sitio puede elegir un nombre de la lista, por lo que el historial refleja la selección y no una identidad verificada.
2. En **Nuevo caso**, seleccioná un cliente o usá **Dar de alta un cliente** para guardarlo como Abonado o Tercero. Ingresá el asunto y guardá. Podés editar el equipo y responsable desde la ficha.
3. En **Detalle del caso**, registrá cada acción con su propio responsable, estado y fecha prevista si corresponde. Para completarla, abrí **Editar acción** y seleccioná **Completada**. Al registrar una factura completada, ingresá su referencia en el detalle.
4. La próxima acción es la primera en curso o, si todavía no hay ninguna en curso, la primera pendiente, en orden de alta. El tiempo se cuenta desde que se registró la acción o se asignó al responsable actual. Si todavía no hay acciones pendientes, la ficha muestra el responsable del caso y cuándo se lo asignó, si está definido.
5. Para cerrar el caso, registrá o completá una acción de tipo **Cierre** después de completar las demás. La ficha cerrada conserva las acciones y el historial para consulta.
6. El listado y la ficha activa consultan el servidor cada 2,5 segundos. Un editor abierto conserva su contenido. Si alguien guardó sobre el mismo caso o acción desde que lo abriste, el servidor rechaza tu guardado y muestra un aviso. Copiá el borrador si querés conservarlo, cerrá el editor y volvé a abrirlo sobre los datos actuales.

## Instalación para Sistemas

1. Preparar un servidor interno con Node.js 24 LTS y una cuenta de servicio dedicada. Colocar el código en un directorio de aplicaciones y la base en un volumen **local persistente** con acceso de escritura para esa cuenta. Todos los usuarios acceden al mismo servicio por HTTPS.
2. Configurar el servicio para que arranque con el sistema. El siguiente ejemplo usa systemd en Linux. Adaptar las rutas y la cuenta al servidor asignado.

```ini
[Unit]
Description=Aercom Servicios
After=network.target

[Service]
User=aercom-servicios
WorkingDirectory=/opt/aercom-servicios
Environment=AERCOM_DB=/var/lib/aercom-servicios/aercom.sqlite
Environment=AERCOM_HOST=127.0.0.1
Environment=AERCOM_PORT=3100
Environment=AERCOM_SECURE_COOKIE=1
StateDirectory=aercom-servicios
StateDirectoryMode=0700
UMask=0077
ExecStart=/usr/bin/node /opt/aercom-servicios/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

3. Crear y habilitar la unidad correspondiente. Cargar los nombres del equipo con el comando anterior bajo la cuenta de servicio, usando el mismo `AERCOM_DB`. Con systemd, iniciar primero la unidad para que cree el directorio de estado.
4. Configurar el proxy HTTPS interno para que reenvíe el sitio completo a `http://127.0.0.1:3100` en el mismo servidor. Sistemas debe definir el nombre DNS interno, instalar un certificado que los equipos reconozcan y limitar el acceso a la red interna o VPN autorizada. La cookie marcada como segura requiere que el equipo ingrese por HTTPS.
5. Antes de distribuir el enlace, abrirlo en Chrome desde un puesto del equipo y comprobar la selección de nombre, el alta y la actualización entre dos sesiones en una instancia de prueba. Verificar el arranque automático, permisos del volumen y restauración del respaldo. Los comandos de servicio, DNS, certificado y conectividad quedan sujetos a validación en el servidor de Aercom.

### Respaldo y restauración

Programar la siguiente operación con la cuenta del servicio y la misma variable `AERCOM_DB`, desde el directorio de la aplicación. Usar un directorio de respaldos previamente creado, con permisos restringidos y una política de retención. El comando toma una instantánea consistente aunque haya escrituras activas y falla si el destino ya existe.

```bash
npm run backup -- "/ruta/respaldos/aercom-$(date +%F-%H%M%S).sqlite"
```

Para probar una recuperación, copiar el respaldo a una ruta SQLite distinta, iniciar una instancia aislada apuntando a esa ruta y verificar los nombres, los casos y el historial. Para restaurar producción, detener el servicio, conservar juntos la base anterior y sus archivos `-wal` y `-shm` si existen, copiar el respaldo verificado a la ruta de `AERCOM_DB` con dueño y permisos de la cuenta de servicio, y volver a iniciar. Verificar un caso y su historial antes de restablecer el acceso del equipo.
